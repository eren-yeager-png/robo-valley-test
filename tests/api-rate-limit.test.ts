// Find a Service API rate limit (migration 011, src/lib/apiRateLimit.ts): the one-minute window, separate visitors, the friendly
// 429 (never cacheable, Retry-After), fail-open, privacy (only a hash is stored) and the two public routes. Real SQL on PGlite.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testDb } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });

import { GET as search } from "../src/app/api/services/search/route";
import { GET as categories } from "../src/app/api/services/categories/route";
import { hashAddress, hitRateLimit, maybeCleanupRateLimits, rateLimitedResponse, SERVICE_RATE_LIMITS, RATE_WINDOW_SECONDS } from "../src/lib/apiRateLimit";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const sql = async (q: string, p?: unknown[]) => (await testDb().raw.query(q, p as never)).rows as any[];
const T0 = Date.parse("2026-11-06T10:00:10.000Z"); // 10 seconds into a minute
const req = (path: string, ip: string, extra: Record<string, string> = {}) =>
  new Request("http://localhost" + path, { headers: { "x-forwarded-for": ip, ...extra } });

beforeEach(async () => {
  await testDb().raw.exec("DELETE FROM api_rate_limits").catch(() => {});
  vi.stubEnv("SESSION_SECRET", SECRET);
  for (const fn of ["log", "error", "warn", "info"] as const) vi.spyOn(console, fn).mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("the numbers live in one place", () => {
  it("search 60 and categories 30 per minute", () => {
    expect(SERVICE_RATE_LIMITS).toEqual({ search: 60, categories: 30 });
    expect(RATE_WINDOW_SECONDS).toBe(60);
  });
});

describe("the fixed one-minute window", () => {
  it("allows exactly `limit` requests, then blocks with the seconds left in the window", async () => {
    for (let i = 1; i <= 3; i++) expect((await hitRateLimit("1.1.1.1", "search", { now: T0, limit: 3 })).allowed).toBe(true);
    expect(await hitRateLimit("1.1.1.1", "search", { now: T0, limit: 3 })).toEqual({ allowed: false, retryAfterSeconds: 50 }); // window ends at :00
    expect((await hitRateLimit("1.1.1.1", "search", { now: T0 + 30_000, limit: 3 })).retryAfterSeconds).toBe(20);
  });
  it("starts a fresh count when the next window begins", async () => {
    for (let i = 0; i < 4; i++) await hitRateLimit("1.1.1.1", "search", { now: T0, limit: 3 });
    expect((await hitRateLimit("1.1.1.1", "search", { now: T0 + 50_000, limit: 3 })).allowed).toBe(true);
  });
  it("keeps visitors independent", async () => {
    for (let i = 0; i < 4; i++) await hitRateLimit("1.1.1.1", "search", { now: T0, limit: 3 });
    expect((await hitRateLimit("1.1.1.1", "search", { now: T0, limit: 3 })).allowed).toBe(false);
    expect((await hitRateLimit("2.2.2.2", "search", { now: T0, limit: 3 })).allowed).toBe(true);
  });
  it("counts search and categories separately for the same visitor", async () => {
    for (let i = 0; i < 4; i++) await hitRateLimit("1.1.1.1", "search", { now: T0, limit: 3 });
    expect((await hitRateLimit("1.1.1.1", "categories", { now: T0, limit: 3 })).allowed).toBe(true);
  });
  it("counts parallel requests exactly (no one slips through)", async () => {
    const r = await Promise.all(Array.from({ length: 10 }, () => hitRateLimit("3.3.3.3", "search", { now: T0, limit: 4 })));
    expect(r.filter((x) => x.allowed)).toHaveLength(4);
  });
});

describe("privacy", () => {
  it("stores a keyed hash, never the address", async () => {
    await hitRateLimit("203.0.113.77", "search", { now: T0 });
    const rows = await sql("SELECT key, hits FROM api_rate_limits");
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("search:" + hashAddress("203.0.113.77"));
    expect(JSON.stringify(rows)).not.toContain("203.0.113.77");
    expect(hashAddress("203.0.113.77")).toMatch(/^[0-9a-f]{32}$/);
    expect(hashAddress("203.0.113.77", { SESSION_SECRET: "another-secret-another-secret-123456" } as never)).not.toBe(hashAddress("203.0.113.77"));
  });
});

describe("fail open", () => {
  it("allows the request when the database cannot be reached", async () => {
    const broken = { query: async () => { throw new Error("connection refused"); } };
    expect(await hitRateLimit("1.1.1.1", "search", { db: broken, limit: 0 })).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });
  it("a missing table does not break the search or categories routes", async () => {
    await testDb().raw.exec("DROP TABLE api_rate_limits");
    expect((await search(req("/api/services/search?location=Guntur", "9.9.9.9"))).status).toBe(200);
    expect((await categories(req("/api/services/categories", "9.9.9.9"))).status).toBe(200);
    await testDb().raw.exec(readFileSync(resolve("db/migrations/011_api_rate_limits.sql"), "utf8").replace(/DO \$\$[\s\S]*?END \$\$;/, "")); // put the table back for the next tests
  });
});

describe("tidy-up", () => {
  it("deletes windows older than an hour and keeps recent ones", async () => {
    await sql("INSERT INTO api_rate_limits (key, window_start, hits) VALUES ('search:old', now() - interval '3 hours', 5), ('search:new', now(), 1)");
    await maybeCleanupRateLimits(testDb().raw as never, () => 0.5); // the dice say no
    expect(await sql("SELECT 1 FROM api_rate_limits")).toHaveLength(2);
    await maybeCleanupRateLimits(testDb().raw as never, () => 0);
    expect((await sql("SELECT key FROM api_rate_limits")).map((r) => r.key)).toEqual(["search:new"]);
  });
});

describe("the 429 answer", () => {
  it("is friendly, tells how long to wait and can never be cached", async () => {
    const res = rateLimitedResponse(42);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ success: false, error: "RATE_LIMITED", message: "Lots of people are searching right now. Please try again in 42 seconds.", retryAfter: 42 });
    expect((await rateLimitedResponse(1).json()).message).toBe("Lots of people are searching right now. Please try again in 1 second.");
  });
});

describe("the public routes", () => {
  it("search: the 61st request in a minute from one address gets 429, others are unaffected", async () => {
    for (let i = 0; i < 60; i++) expect((await search(req("/api/services/search?location=Guntur", "7.7.7.7"))).status).toBe(200);
    const res = await search(req("/api/services/search?location=Guntur", "7.7.7.7", { origin: "https://techytree.in" }));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(Number(res.headers.get("Retry-After"))).toBeLessThanOrEqual(60);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://techytree.in"); // the widget can read the message
    expect((await res.json()).error).toBe("RATE_LIMITED");
    expect((await search(req("/api/services/search?location=Guntur", "8.8.8.8"))).status).toBe(200);
  });
  it("categories: the 31st request gets 429", async () => {
    for (let i = 0; i < 30; i++) expect((await categories(req("/api/services/categories", "7.7.7.7"))).status).toBe(200);
    const res = await categories(req("/api/services/categories", "7.7.7.7"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
  it("a normal search is unchanged (200, success body; cacheable since PR 2)", async () => {
    const res = await search(req("/api/services/search?location=Guntur", "5.5.5.5"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=60, stale-while-revalidate=30");
    expect((await res.json()).success).toBe(true);
  });
  it("a bad request still gets its 400", async () => {
    expect((await search(req("/api/services/search?pincode=12", "6.6.6.6"))).status).toBe(400);
  });
});

describe("migration 011", () => {
  it("is additive and idempotent, with a rollback that only drops its own table", () => {
    const up = readFileSync(resolve("db/migrations/011_api_rate_limits.sql"), "utf8"), down = readFileSync(resolve("db/rollback/011_down.sql"), "utf8");
    expect(up).toContain("CREATE TABLE IF NOT EXISTS api_rate_limits");
    expect(up).toContain("rv.expected_db");
    expect(up).not.toMatch(/\n\s*(DROP|DELETE FROM|ALTER|TRUNCATE)\b/i);
    expect(down).toContain("DROP TABLE IF EXISTS api_rate_limits");
    expect(down.match(/DROP TABLE/g)).toHaveLength(1);
  });
});
