// Find a Service: cache headers on the public reads (lib/serviceCache.ts), how they sit with the rate limiter, and the "about a minute" note on confirm.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";
import { windowRoom } from "./helpers/rateWindow";
import { createSessionToken } from "../src/lib/session";

const m = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "rv_session" && m.cookie ? { name: n, value: m.cookie } : undefined) }),
}));

import { GET as search } from "../src/app/api/services/search/route";
import { GET as categories } from "../src/app/api/services/categories/route";
import { POST as upload } from "../src/app/api/services/upload/route";
import { POST as confirm } from "../src/app/api/services/upload/confirm/route";
import { NEW_DATA_DELAY_NOTE, SERVICE_CACHE_CONTROL } from "../src/lib/serviceCache";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const sql = async (q: string) => (await testDb().raw.query(q)).rows as any[];
const req = (path: string, ip = "7.7.7.7", extra: Record<string, string> = {}) => new Request("http://localhost" + path, { headers: { "x-forwarded-for": ip, ...extra } });
const cc = (r: Response) => r.headers.get("Cache-Control") ?? "";

beforeEach(async () => {
  await windowRoom(); // these tests count real requests up to a limit: keep them inside one rate-limit window (see helpers/rateWindow.ts)
  vi.stubEnv("SESSION_SECRET", SECRET);
  for (const fn of ["log", "error", "warn", "info"] as const) vi.spyOn(console, fn).mockImplementation(() => {});
  await testDb().raw.exec("DELETE FROM api_rate_limits");
  m.cookie = undefined;
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("successful reads may be cached for 60 s (+30 s stale)", () => {
  it("the policy is exactly s-maxage=60, stale-while-revalidate=30, public", () => {
    expect(SERVICE_CACHE_CONTROL).toBe("public, s-maxage=60, stale-while-revalidate=30");
  });
  it("search 200", async () => {
    const r = await search(req("/api/services/search?location=Guntur"));
    expect(r.status).toBe(200);
    expect(cc(r)).toBe(SERVICE_CACHE_CONTROL);
    expect(r.headers.get("Set-Cookie")).toBeNull();
    expect(r.headers.get("Vary")).toMatch(/Origin/i); // an answer made for one site origin is not served to another
  });
  it("categories 200", async () => {
    const r = await categories(req("/api/services/categories"));
    expect(r.status).toBe(200);
    expect(cc(r)).toBe(SERVICE_CACHE_CONTROL);
    expect(r.headers.get("Vary")).toMatch(/Origin/i);
  });
});

describe("errors are never cached", () => {
  const never = (r: Response) => { expect(cc(r)).toBe("no-store"); expect(cc(r)).not.toMatch(/s-maxage|public|stale/); };
  it("400 (bad search)", async () => { const r = await search(req("/api/services/search?pincode=12")); expect(r.status).toBe(400); never(r); });
  it("429 (search and categories)", async () => {
    for (let i = 0; i < 60; i++) await search(req("/api/services/search?location=Guntur", "8.8.8.8"));
    const a = await search(req("/api/services/search?location=Guntur", "8.8.8.8")); expect(a.status).toBe(429); never(a);
    for (let i = 0; i < 30; i++) await categories(req("/api/services/categories", "8.8.8.8"));
    const b = await categories(req("/api/services/categories", "8.8.8.8")); expect(b.status).toBe(429); never(b);
  });
  it("500 (database problem) for search and categories", async () => {
    await testDb().raw.exec("ALTER TABLE service_datasets RENAME TO service_datasets_x");
    try {
      const a = await search(req("/api/services/search?location=Guntur", "6.6.6.6")); expect(a.status).toBe(500); never(a);
      const b = await categories(req("/api/services/categories", "6.6.6.6")); expect(b.status).toBe(500); never(b);
    } finally { await testDb().raw.exec("ALTER TABLE service_datasets_x RENAME TO service_datasets"); }
  });
});

describe("how the cache and the limiter interact", () => {
  it("the function has no cache of its own: two identical requests that reach it are both counted", async () => {
    await search(req("/api/services/search?location=Guntur", "5.5.5.5"));
    await search(req("/api/services/search?location=Guntur", "5.5.5.5"));
    expect((await sql("SELECT sum(hits)::int n FROM api_rate_limits"))[0].n).toBe(2);
    // A request answered by the CDN never reaches this code, so it is not counted: only cache misses use up a visitor's allowance.
    // (That is the point of the cache, and it cannot be simulated in a unit test: see the PR for the live check.)
  });
  it("a changed query string is a different cache entry AND still counts against the limiter (varying the URL does not bypass it)", async () => {
    for (let i = 0; i < 60; i++) expect((await search(req(`/api/services/search?location=Guntur&x=${i}`, "4.4.4.4"))).status).toBe(200);
    expect((await search(req("/api/services/search?location=Guntur&x=999", "4.4.4.4"))).status).toBe(429);
  });
});

describe("the admin is told about the delay", () => {
  it("the confirm answer says about a minute", async () => {
    const admin = await seedUser({ email: "ai@symbiosystech.com", role: "admin" });
    m.cookie = createSessionToken({ id: admin.id, role: "admin" }, false, Date.now(), { SESSION_SECRET: SECRET } as never).token;
    const fd = new FormData();
    fd.set("file", new File(["School Name,State,District,Pincode,UDISE Code\nAtl One,Andhra Pradesh,Guntur,522005,1\n"], "d.csv", { type: "text/csv" }));
    fd.set("category", "atl-labs");
    const up = await (await upload(new Request("http://localhost/api/services/upload", { method: "POST", body: fd }))).json();
    expect(up.success, JSON.stringify(up)).toBe(true);
    const res = await confirm(new Request("http://localhost/api/services/upload/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ datasetId: up.datasetId }) }));
    expect(res.status).toBe(200);
    expect((await res.json()).message).toBe(`The new data is now live for everyone. ${NEW_DATA_DELAY_NOTE}`);
    expect(NEW_DATA_DELAY_NOTE).toBe("It may take about a minute to appear on the website.");
  });
  it("the admin form and the upload widget say it too (and the page JSON carries the same widget text)", () => {
    expect(readFileSync(resolve("src/app/admin/_components/UploadForm.tsx"), "utf8")).toContain(NEW_DATA_DELAY_NOTE);
    const w = readFileSync(resolve("frontend/elementor/find-a-service-510/widgets/04-upload-button.a51f0e2.html"), "utf8");
    expect(w).toContain(NEW_DATA_DELAY_NOTE);
    const json = JSON.parse(readFileSync(resolve("frontend/elementor/find-a-service-510/find-a-service-510.elementor.json"), "utf8"));
    const htmls: string[] = [];
    (function walk(n: any[]) { for (const e of n) { if (e.widgetType === "html") htmls.push(e.settings.html); if (e.elements) walk(e.elements); } })(json.content);
    expect(htmls).toContain(w);
  });
});
