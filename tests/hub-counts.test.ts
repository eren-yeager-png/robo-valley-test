// The public Contribute hub numbers (GET /api/contributions/sectors): what counts, what never leaks, the "under 5 contributors" rule,
// the edited-published-item rule, headers, rate limit and failures. Real SQL on the in-process database (tests/helpers.ts).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });

import { GET, OPTIONS } from "../src/app/api/contributions/sectors/route";
import * as routeModule from "../src/app/api/contributions/sectors/route";
import { MIN_PUBLIC_CONTRIBUTORS, SECTOR_COUNTS_SQL, publicSectorCounts } from "../src/lib/contributionHub";
import { SERVICE_CACHE_CONTROL } from "../src/lib/serviceCache";
import { pool } from "../src/lib/db";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const raw = () => testDb().raw;
const q = (sql: string, p: unknown[] = []) => raw().query(sql, p as never);
const req = (ip = "7.7.7.7", extra: Record<string, string> = {}) => new Request("http://localhost/api/contributions/sectors", { headers: { "x-forwarded-for": ip, ...extra } });
const get = async (ip?: string) => { const r = await GET(req(ip)); return { r, body: await r.json() }; };
const secId = async (slug: string) => Number(((await q("SELECT id FROM sectors WHERE slug = $1", [slug])).rows[0] as any).id);
const agri = (b: any) => b.sectors.find((s: any) => s.slug === "agriculture-dairy");

let seq = 0;
const people: string[] = [];
async function person() { const u = await seedUser({ email: `person${++seq}@example.com`, role: "ST", fullName: `Person Number ${seq}` }); people.push(String(u.id)); return String(u.id); }
/** Makes a contribution in the given sectors with the given status ("published", "pending_review", "changes_requested" or "draft"). */
async function make(userId: string, sectors: string[], status: string, opts: { demo?: boolean; title?: string } = {}) {
  const title = opts.title ?? `Contribution title ${++seq}`;
  const id = Number(((await q("INSERT INTO contributions (user_id, type, title, body, is_demo) VALUES ($1,'problem',$2,'A private body that must never appear in the hub numbers.',$3) RETURNING id", [userId, title, !!opts.demo])).rows[0] as any).id);
  for (const s of sectors) await q("INSERT INTO contribution_scopes (contribution_id, sector_id) VALUES ($1,$2)", [id, await secId(s)]);
  if (status !== "draft") await q("UPDATE contributions SET status = $2::varchar, submitted_at = now(), published_at = CASE WHEN $2::varchar = 'published' THEN now() END WHERE id = $1", [id, status]);
  return { id, title };
}

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await q("DELETE FROM api_rate_limits");
  await q("INSERT INTO sectors (slug, name, sort_order) VALUES ('education', 'Education', 20) ON CONFLICT (slug) DO NOTHING");
  await q("INSERT INTO sectors (slug, name, sort_order, is_demo) VALUES ('healthcare-demo', 'Healthcare Demo', 30, true) ON CONFLICT (slug) DO NOTHING");
  await q("INSERT INTO sectors (slug, name, sort_order, is_active) VALUES ('retired-sector', 'Retired Sector', 40, false) ON CONFLICT (slug) DO NOTHING");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); testDb().failOn(undefined); });

describe("what counts", () => {
  it("only published, non-demo contributions: not drafts, pending, changes requested or demo ones", async () => {
    const a = await person(), b = await person();
    await make(a, ["agriculture-dairy"], "published");
    await make(b, ["agriculture-dairy"], "published");
    await make(a, ["agriculture-dairy"], "pending_review");
    await make(a, ["agriculture-dairy"], "changes_requested");
    await make(a, ["agriculture-dairy"], "draft");
    await make(b, ["agriculture-dairy"], "published", { demo: true });
    const { body } = await get();
    expect(agri(body).contributions).toBe(2);
  });

  it("a contribution filed under two sectors counts once in each", async () => {
    const a = await person();
    await make(a, ["agriculture-dairy", "education"], "published");
    const { body } = await get();
    expect(agri(body).contributions).toBe(1);
    expect(body.sectors.find((s: any) => s.slug === "education").contributions).toBe(1);
  });

  it("shows only active, real sectors, in their order (not demo sectors, not retired ones)", async () => {
    const { body } = await get();
    expect(body.sectors.map((s: any) => s.slug)).toEqual(["agriculture-dairy", "education"]);
  });

  it("a sector with nothing published says it is empty (the hub shows 'Be the first to contribute')", async () => {
    const a = await person();
    await make(a, ["education"], "pending_review");
    const { body } = await get();
    expect(body.sectors.find((s: any) => s.slug === "education")).toEqual({ slug: "education", name: "Education", contributions: 0, contributors: null, empty: true });
  });

  it("an edited published item leaves the numbers until it is approved again", async () => {
    const a = await person();
    const c = await make(a, ["agriculture-dairy"], "published");
    expect(agri((await get()).body).contributions).toBe(1);
    await q("UPDATE contributions SET status = 'pending_review', published_at = NULL WHERE id = $1", [c.id]); // an edit sends it back to review
    expect(agri((await get("8.8.8.8")).body).contributions).toBe(0);
    await q("UPDATE contributions SET status = 'published', published_at = now() WHERE id = $1", [c.id]); // a moderator approves it again
    expect(agri((await get("9.9.9.9")).body).contributions).toBe(1);
  });
});

describe("the contributor count is hidden under 5", () => {
  it("is null for 4 different people and shown for 5, however many items each wrote", async () => {
    expect(MIN_PUBLIC_CONTRIBUTORS).toBe(5);
    const four = [await person(), await person(), await person(), await person()];
    for (const p of four) { await make(p, ["agriculture-dairy"], "published"); await make(p, ["agriculture-dairy"], "published"); }
    let a = agri((await get()).body);
    expect(a.contributions).toBe(8);
    expect(a.contributors).toBeNull(); // 8 items, but only 4 people
    await make(await person(), ["agriculture-dairy"], "published");
    a = agri((await get("8.8.8.8")).body);
    expect(a.contributions).toBe(9);
    expect(a.contributors).toBe(5);
  });

  it("is decided per sector", async () => {
    const five = [await person(), await person(), await person(), await person(), await person()];
    for (const p of five) await make(p, ["agriculture-dairy"], "published");
    await make(five[0], ["education"], "published");
    const { body } = await get();
    expect(agri(body).contributors).toBe(5);
    expect(body.sectors.find((s: any) => s.slug === "education").contributors).toBeNull();
  });

  it("only people with a published item count (a person with only a draft or pending item does not)", async () => {
    const five = [await person(), await person(), await person(), await person(), await person()];
    for (const p of five.slice(0, 4)) await make(p, ["agriculture-dairy"], "published");
    await make(five[4], ["agriculture-dairy"], "pending_review");
    expect(agri((await get()).body).contributors).toBeNull();
  });
});

describe("privacy: aggregates only", () => {
  it("never contains a title, body, name, email or id of any contribution or person, published or not", async () => {
    const a = await person();
    const t1 = await make(a, ["agriculture-dairy"], "published", { title: "Secret published title" });
    const t2 = await make(a, ["agriculture-dairy"], "pending_review", { title: "Secret pending title" });
    const t3 = await make(a, ["agriculture-dairy"], "draft", { title: "Secret draft title" });
    const { r, body } = await get();
    const text = JSON.stringify(body) + JSON.stringify([...r.headers.entries()]);
    for (const s of [t1.title, t2.title, t3.title, "private body", "person1@example.com", "Person Number", "@example.com", String(t1.id) + '"', "author", "contact"]) expect(text.toLowerCase()).not.toContain(s.toLowerCase());
    for (const s of body.sectors) expect(Object.keys(s).sort()).toEqual(["contributions", "contributors", "empty", "name", "slug"]);
    expect(Object.keys(body).sort()).toEqual(["sectors", "success"]);
  });

  it("the query selects only the sector, and two counts: no personal or content column", () => {
    const select = SECTOR_COUNTS_SQL.slice(0, SECTOR_COUNTS_SQL.indexOf(" FROM "));
    expect(select).toBe("SELECT s.slug, s.name, count(DISTINCT c.id)::int AS contributions, count(DISTINCT c.user_id)::int AS contributors");
    expect(SECTOR_COUNTS_SQL).not.toMatch(/\btitle\b|\bbody\b|full_name|email|phone|contribution_contacts|contribution_photos/i);
  });

  it("the route does not import anything that reads contact details or photos, and reads no session", () => {
    const src = readFileSync(resolve("src/app/api/contributions/sectors/route.ts"), "utf8") + readFileSync(resolve("src/lib/contributionHub.ts"), "utf8");
    expect(src).not.toMatch(/contributionContacts|contributionPhotos|requireAdmin|cookies\(|session/i);
  });
});

describe("headers, methods and the rate limit", () => {
  it("a successful answer may be cached for a minute and carries CORS for the site", async () => {
    const r = await GET(req("7.7.7.7", { origin: "https://techytree.in" }));
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe(SERVICE_CACHE_CONTROL);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("https://techytree.in");
    expect(r.headers.get("Vary")).toMatch(/Origin/i);
    expect(r.headers.get("Set-Cookie")).toBeNull();
  });
  it("answers the browser's pre-flight, and offers no other method", async () => {
    expect((await OPTIONS(new Request("http://localhost/x", { method: "OPTIONS", headers: { origin: "https://techytree.in" } }))).status).toBe(204);
    expect(Object.keys(routeModule).sort()).toEqual(["GET", "OPTIONS", "dynamic", "runtime"]);
  });
  it("30 requests a minute per visitor, then 429 with Retry-After, never cached; other visitors are unaffected", async () => {
    for (let i = 0; i < 30; i++) expect((await GET(req("5.5.5.5"))).status).toBe(200);
    const r = await GET(req("5.5.5.5", { origin: "https://techytree.in" }));
    expect(r.status).toBe(429);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(Number(r.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("https://techytree.in");
    expect((await GET(req("6.6.6.6"))).status).toBe(200);
  });
  it("the kill switch turns the limit off here too", async () => {
    vi.stubEnv("SERVICE_RATE_LIMIT_ENABLED", "false");
    for (let i = 0; i < 35; i++) expect((await GET(req("4.4.4.4"))).status).toBe(200);
  });
});

describe("failures are never cached", () => {
  it("503 before migration 012 is applied", async () => {
    testDb().failOn((sql) => (/FROM sectors/.test(sql) ? Object.assign(new Error('relation "sectors" does not exist'), { code: "42P01" }) : undefined));
    const r = await GET(req());
    expect(r.status).toBe(503);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect((await r.json()).error).toBe("NOT_SET_UP");
  });
  it("500 for any other database problem, with nothing from the data in the log", async () => {
    testDb().failOn((sql) => (/FROM sectors/.test(sql) ? Object.assign(new Error("connection reset"), { code: "08006" }) : undefined));
    const r = await GET(req());
    expect(r.status).toBe(500);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(JSON.stringify((console.error as any).mock.calls)).toBe(JSON.stringify([["hub counts failed: server error"]]));
  });
});

describe("publicSectorCounts", () => {
  it("matches what the route returns", async () => {
    const a = await person();
    await make(a, ["agriculture-dairy"], "published");
    expect(await publicSectorCounts(pool as never)).toEqual((await get()).body.sectors);
  });
});
