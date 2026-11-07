// Find a Service rate limit, operations side: the kill switch (SERVICE_RATE_LIMIT_ENABLED) and the admin-only, aggregate-only self-check.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";
import { createSessionToken } from "../src/lib/session";

const m = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "rv_session" && m.cookie ? { name: n, value: m.cookie } : undefined) }),
}));

import { GET as search } from "../src/app/api/services/search/route";
import { GET as categories } from "../src/app/api/services/categories/route";
import { GET as check } from "../src/app/api/admin/rate-limit-check/route";
import { hashAddress, hitRateLimit, rateLimitEnabled, rateLimitSummary } from "../src/lib/apiRateLimit";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const sql = async (q: string, p?: unknown[]) => (await testDb().raw.query(q, p as never)).rows as any[];
const req = (path: string, ip: string) => new Request("http://localhost" + path, { headers: { "x-forwarded-for": ip } });
const T0 = Date.now();

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  for (const fn of ["log", "error", "warn", "info"] as const) vi.spyOn(console, fn).mockImplementation(() => {});
  await testDb().raw.exec("DELETE FROM api_rate_limits");
  m.cookie = undefined;
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("kill switch SERVICE_RATE_LIMIT_ENABLED", () => {
  it("is ON when unset, empty or any other value", () => {
    for (const v of [undefined, "", "true", "1", "on", "yes", "banana"]) expect(rateLimitEnabled({ SERVICE_RATE_LIMIT_ENABLED: v } as never)).toBe(true);
  });
  it.each(["false", "FALSE", "0", "off", "no", "disabled", " false "])("is OFF for %j", (v) => {
    expect(rateLimitEnabled({ SERVICE_RATE_LIMIT_ENABLED: v } as never)).toBe(false);
  });
  it("when OFF, 100 searches and 40 category calls from one address all succeed and nothing is counted", async () => {
    vi.stubEnv("SERVICE_RATE_LIMIT_ENABLED", "false");
    for (let i = 0; i < 100; i++) expect((await search(req("/api/services/search?location=Guntur", "7.7.7.7"))).status).toBe(200);
    for (let i = 0; i < 40; i++) expect((await categories(req("/api/services/categories", "7.7.7.7"))).status).toBe(200);
    expect(await sql("SELECT 1 FROM api_rate_limits")).toHaveLength(0);
  });
  it("switching it back ON restores the limit (read on every request)", async () => {
    vi.stubEnv("SERVICE_RATE_LIMIT_ENABLED", "false");
    expect((await categories(req("/api/services/categories", "7.7.7.7"))).status).toBe(200);
    vi.stubEnv("SERVICE_RATE_LIMIT_ENABLED", "true");
    for (let i = 0; i < 30; i++) await categories(req("/api/services/categories", "7.7.7.7"));
    expect((await categories(req("/api/services/categories", "7.7.7.7"))).status).toBe(429);
  });
});

describe("self-check summary (aggregates only)", () => {
  it("says 'no data' for an empty table", async () => {
    expect(await rateLimitSummary(testDb().raw as never)).toMatchObject({ verdict: "no data", scopes: {} });
  });
  it("looks normal with many different visitors", async () => {
    for (let i = 0; i < 30; i++) for (let k = 0; k < 5; k++) await hitRateLimit(`10.0.0.${i}`, "search", { now: T0 });
    const s = await rateLimitSummary(testDb().raw as never);
    expect(s.verdict).toBe("looks normal");
    expect(s.scopes.search).toMatchObject({ distinctVisitors: 30, totalHits: 150, maxHitsOneVisitorLastHour: 5 });
  });
  it("flags it when one key holds almost all hits (the wrong-address signal)", async () => {
    for (let k = 0; k < 190; k++) await hitRateLimit("10.0.0.1", "search", { now: T0, limit: 1000 });
    for (let i = 2; i < 6; i++) await hitRateLimit(`10.0.0.${i}`, "search", { now: T0 });
    const s = await rateLimitSummary(testDb().raw as never);
    expect(s.verdict).toBe("CHECK: one visitor holds almost all hits");
    expect(s.scopes.search.topVisitorShare).toBeGreaterThan(0.9);
  });
  it("never contains a key, a hash or an address", async () => {
    await hitRateLimit("203.0.113.9", "search", { now: T0 });
    const text = JSON.stringify(await rateLimitSummary(testDb().raw as never));
    expect(text).not.toContain("203.0.113.9");
    expect(text).not.toContain(hashAddress("203.0.113.9"));
  });
  it("counts only the last hour", async () => {
    await sql("INSERT INTO api_rate_limits (key, window_start, hits) VALUES ('search:old', now() - interval '3 hours', 500)");
    expect((await rateLimitSummary(testDb().raw as never)).verdict).toBe("no data");
  });
});

describe("GET /api/admin/rate-limit-check", () => {
  it("refuses a visitor with no session", async () => {
    const res = await check(new Request("http://localhost/api/admin/rate-limit-check"));
    expect([401, 403]).toContain(res.status);
    expect(JSON.stringify(await res.json())).not.toContain("distinctVisitors");
  });
  it("refuses a non-admin member", async () => {
    const u = await seedUser({ email: "member@example.com", role: "ST" });
    m.cookie = createSessionToken({ id: u.id, role: "ST" }, false, Date.now(), { SESSION_SECRET: SECRET } as never).token;
    expect([401, 403]).toContain((await check(new Request("http://localhost/api/admin/rate-limit-check"))).status);
  });
  it("gives an admin the aggregates, no-store", async () => {
    const a = await seedUser({ email: "ai@symbiosystech.com", role: "admin" });
    m.cookie = createSessionToken({ id: a.id, role: "admin" }, false, Date.now(), { SESSION_SECRET: SECRET } as never).token;
    await hitRateLimit("1.2.3.4", "search", { now: T0 });
    const res = await check(new Request("http://localhost/api/admin/rate-limit-check"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const b = await res.json();
    expect(b).toMatchObject({ success: true, enabled: true, scopes: { search: { distinctVisitors: 1, totalHits: 1 } } });
    expect(JSON.stringify(b)).not.toContain("1.2.3.4");
  });
});
