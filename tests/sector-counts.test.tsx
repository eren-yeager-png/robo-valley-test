// Admin "Contributions by sector": the numbers, who may see them, the queue filters its links use, and the page.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";
import { createSessionToken } from "../src/lib/session";

const m = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "rv_session" && m.cookie ? { name: n, value: m.cookie } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error("REDIRECT:" + to); }, useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

import { pool } from "../src/lib/db";
import { GET } from "../src/app/api/admin/sector-counts/route";
import SectorCountsPage from "../src/app/admin/sectors/page";
import { sectorStatusCounts } from "../src/lib/sectorCounts";
import { listQueue } from "../src/lib/contributionReview";
import { ADMIN_NAV } from "../src/app/admin/_components/nav";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
const tokenFor = (id: number | string, role: string) => createSessionToken({ id: String(id), role }, false, Date.now(), { SESSION_SECRET: SECRET } as never).token;
const signInAs = (id: number | string | null, role = "ST") => { m.cookie = id === null ? undefined : tokenFor(id, role); };
let ipn = 0;
const call = async (headers: Record<string, string> = {}) => {
  const r = await GET(new Request("http://localhost/api/admin/sector-counts", { headers: { host: "localhost", "x-forwarded-for": `40.0.0.${++ipn % 250}`, ...headers } }));
  return { r, b: (await r.json()) as any };
};

let seq = 0, author = 0, admin = 0;
const mk = async (title: string, status: string, sectors: string[], o: { demo?: boolean } = {}) => {
  // The database refuses a non-draft item without a sector, so: insert as a draft, add the sectors, then move it to its status.
  const id = Number(((await q(
    "INSERT INTO contributions (user_id, type, title, body, is_demo) VALUES ($1,'problem',$2,'A description that is long enough to be valid.',$3) RETURNING id",
    [author, title, !!o.demo])).rows[0] as { id: number }).id);
  for (const s of sectors) await q("INSERT INTO contribution_scopes (contribution_id, sector_id) SELECT $1, id FROM sectors WHERE slug = $2", [id, s]);
  if (status !== "draft") await q("UPDATE contributions SET status = $2::varchar, submitted_at = now(), published_at = CASE WHEN $2::varchar = 'published' THEN now() ELSE NULL END WHERE id = $1", [id, status]);
  return id;
};
const verify = (id: number) => q("INSERT INTO contribution_reviews (contribution_id, reviewer_id, action) VALUES ($1,$2,'verify')", [id, admin]);

/** The same set of contributions in every test (see the table in the first test). */
async function seedAll() {
  await q("INSERT INTO sectors (slug, name, sort_order) VALUES ('education','Education',20), ('healthcare','Healthcare',30) ON CONFLICT DO NOTHING");
  author = Number((await seedUser({ email: `author${++seq}@example.com`, role: "ST", fullName: "Author" })).id);
  admin = Number((await seedUser({ email: `boss${++seq}@example.com`, role: "admin", fullName: "Boss" })).id);
  await mk("Draft in agriculture", "draft", ["agriculture-dairy"]);
  await mk("Submitted in agriculture", "pending_review", ["agriculture-dairy"]);
  await verify(await mk("Verified in agriculture and education", "pending_review", ["agriculture-dairy", "education"]));
  await mk("Submitted in education", "pending_review", ["education"]);
  await mk("Changes wanted in healthcare", "changes_requested", ["healthcare"]);
  await mk("Published in agriculture and education", "published", ["agriculture-dairy", "education"]);
  await mk("Rejected in education", "rejected", ["education"]);
  await mk("Taken down in healthcare", "unpublished", ["healthcare"]);
  await mk("Removed in agriculture", "removed", ["agriculture-dairy"]);
  await mk("Demo published in agriculture", "published", ["agriculture-dairy"], { demo: true });
  await mk("Draft with no sector yet", "draft", []);
}

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  m.cookie = undefined;
  await q("DELETE FROM api_rate_limits");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); testDb().failOn(undefined); });

const pick = (r: Record<string, any>) => ({ draft: r.draft, submitted: r.submitted, verified: r.verified, changesRequested: r.changesRequested, published: r.published, rejected: r.rejected, unpublished: r.unpublished, total: r.total });

describe("the numbers", () => {
  it("counts each contribution once in every sector it belongs to; the sum counts a two-sector item twice, the unique row once", async () => {
    await seedAll();
    const c = await sectorStatusCounts(testDb().raw as never);
    const by = Object.fromEntries(c.sectors.map((s) => [s.slug, pick(s)]));
    expect(by["agriculture-dairy"]).toEqual({ draft: 1, submitted: 1, verified: 1, changesRequested: 0, published: 1, rejected: 0, unpublished: 0, total: 4 });
    expect(by.education).toEqual({ draft: 0, submitted: 1, verified: 1, changesRequested: 0, published: 1, rejected: 1, unpublished: 0, total: 4 });
    expect(by.healthcare).toEqual({ draft: 0, submitted: 0, verified: 0, changesRequested: 1, published: 0, rejected: 0, unpublished: 1, total: 2 });
    expect(pick(c.sum)).toEqual({ draft: 1, submitted: 2, verified: 2, changesRequested: 1, published: 2, rejected: 1, unpublished: 1, total: 10 });
    expect(pick(c.unique)).toEqual({ draft: 1, submitted: 2, verified: 1, changesRequested: 1, published: 1, rejected: 1, unpublished: 1, total: 8 });
    expect(c.sum.total).toBe(c.unique.total + 2); // the two items that are in two sectors
    expect(c.withoutSector).toBe(1);
  });

  it("removed and demo items are never counted; the published figure matches the public sector count", async () => {
    await seedAll();
    const c = await sectorStatusCounts(testDb().raw as never);
    const agri = c.sectors.find((s) => s.slug === "agriculture-dairy")!;
    expect(agri.total).toBe(4); // not 6: the removed item and the demo item are left out
    const pub = (await q("SELECT s.slug, count(*)::int n FROM contribution_scopes cs JOIN sectors s ON s.id = cs.sector_id JOIN contributions c ON c.id = cs.contribution_id WHERE c.status = 'published' AND NOT c.is_demo GROUP BY s.slug")).rows as { slug: string; n: number }[];
    for (const p of pub) expect(c.sectors.find((s) => s.slug === p.slug)!.published).toBe(p.n);
  });

  it("a sector nobody has contributed to is listed with zeros, and no data at all gives zeros and no error", async () => {
    const c = await sectorStatusCounts(testDb().raw as never);
    expect(c.sectors.length).toBeGreaterThanOrEqual(1);
    for (const s of c.sectors) expect(pick(s)).toEqual({ draft: 0, submitted: 0, verified: 0, changesRequested: 0, published: 0, rejected: 0, unpublished: 0, total: 0 });
    expect(pick(c.sum).total).toBe(0);
    expect(c.withoutSector).toBe(0);
  });

  it("without the audit table nothing can be verified: it still answers, with Verified at 0", async () => {
    await seedAll();
    testDb().failOn((sql) => (/contribution_reviews/.test(sql) ? Object.assign(new Error("relation does not exist"), { code: "42P01" }) : undefined));
    const c = await sectorStatusCounts(pool as never); // the pool is where failOn applies
    expect(c.sum.verified).toBe(0);
    expect(c.sum.submitted).toBe(4); // verified ones count as submitted when there is no record of a verify
    expect(c.sum.total).toBe(10);
  });
});

describe("who may read it (API)", () => {
  it("a visitor gets 401 and nothing in the body", async () => {
    await seedAll(); signInAs(null);
    const x = await call();
    expect(x.r.status).toBe(401);
    expect(x.r.headers.get("cache-control")).toMatch(/no-store/);
    expect(JSON.stringify(x.b)).not.toMatch(/agriculture|published|sectors/i);
  });
  it("a signed-in member gets 403", async () => {
    await seedAll(); signInAs(author, "ST");
    const x = await call();
    expect(x.r.status).toBe(403);
    expect(x.r.headers.get("cache-control")).toMatch(/no-store/);
    expect(x.b.sectors).toBeUndefined();
  });
  it("a moderator (a flag, not a role) gets 403 too: counts are for administrators", async () => {
    await seedAll();
    const mod = Number((await seedUser({ email: `mod${++seq}@example.com`, role: "TC", fullName: "Mod" })).id);
    await q("UPDATE users SET is_moderator = true WHERE id = $1", [mod]);
    signInAs(mod, "TC");
    const x = await call();
    expect(x.r.status).toBe(403);
    expect(x.b.sectors).toBeUndefined();
  });
  it("a token that CLAIMS admin for a non-admin account is still 403 (the role comes from the database)", async () => {
    await seedAll(); signInAs(author, "admin");
    expect((await call()).r.status).toBe(403);
  });
  it("an administrator gets the counts, not cached", async () => {
    await seedAll(); signInAs(admin, "admin");
    const x = await call();
    expect(x.r.status).toBe(200);
    expect(x.r.headers.get("cache-control")).toMatch(/no-store/);
    expect(x.b.success).toBe(true);
    expect(pick(x.b.unique).total).toBe(8);
    expect(x.b.sectors.map((s: { slug: string }) => s.slug)).toEqual(["agriculture-dairy", "education", "healthcare"]);
  });
  it("a browser request from another website is refused even for an administrator", async () => {
    await seedAll(); signInAs(admin, "admin");
    expect((await call({ origin: "https://evil.example" })).r.status).toBe(403);
  });
  it("when the database fails: 500, a fixed message, no details", async () => {
    signInAs(admin, "admin"); await seedAll();
    testDb().failOn((sql) => (/FROM sectors/.test(sql) ? new Error("secret detail: password=hunter2") : undefined));
    const x = await call();
    expect(x.r.status).toBe(500);
    expect(JSON.stringify(x.b)).not.toMatch(/hunter2|secret/);
    expect(x.b.message).toMatch(/could not be read/i);
  });
});

describe("the Moderation list filters the counts link to", () => {
  const titles = async (status: string, f: Parameters<typeof listQueue>[2]) => (await listQueue(testDb().raw as never, status, f)).map((i) => i.title).sort();
  it("one sector", async () => {
    await seedAll();
    expect(await titles("pending_review", { sector: "education" })).toEqual(["Submitted in education", "Verified in agriculture and education"]);
    expect(await titles("published", { sector: "healthcare" })).toEqual([]);
    expect(await titles("published", { sector: "agriculture-dairy" })).toEqual(["Published in agriculture and education"]); // the demo one is not listed
  });
  it("verified only, and not-verified only, which together are the whole pending list", async () => {
    await seedAll();
    const yes = await titles("pending_review", { verified: true }), no = await titles("pending_review", { verified: false }), all = await titles("pending_review", {});
    expect(yes).toEqual(["Verified in agriculture and education"]);
    expect(no).toEqual(["Submitted in agriculture", "Submitted in education"]);
    expect([...yes, ...no].sort()).toEqual(all);
  });
  it("sector and verified together; an unknown or hostile sector value is only ever a parameter", async () => {
    await seedAll();
    expect(await titles("pending_review", { sector: "agriculture-dairy", verified: false })).toEqual(["Submitted in agriculture"]);
    expect(await titles("pending_review", { sector: "x'; DROP TABLE contributions; --" })).toEqual([]);
    expect((await q("SELECT count(*)::int n FROM contributions")).rows[0]).toMatchObject({ n: 11 });
  });
  it("every number the page links to has a list of exactly that size", async () => {
    await seedAll();
    const c = await sectorStatusCounts(testDb().raw as never);
    const statusOf: Record<string, [string, boolean | null]> = { submitted: ["pending_review", false], verified: ["pending_review", true], changesRequested: ["changes_requested", null], published: ["published", null], rejected: ["rejected", null], unpublished: ["unpublished", null] };
    for (const s of c.sectors) for (const [k, [st, v]] of Object.entries(statusOf)) {
      expect((await listQueue(testDb().raw as never, st, { sector: s.slug, verified: v })).length, `${s.slug} ${k}`).toBe((s as any)[k]);
    }
    for (const [k, [st, v]] of Object.entries(statusOf)) expect((await listQueue(testDb().raw as never, st, { verified: v })).length, `unique ${k}`).toBe((c.unique as any)[k]);
  });
});

describe("the page", () => {
  const html = async () => renderToStaticMarkup((await SectorCountsPage()) as React.ReactElement);
  it("shows every sector with its counts, a sum row and a unique row, and explains the difference", async () => {
    await seedAll(); signInAs(admin, "admin");
    const h = await html();
    for (const w of ["Agriculture", "Education", "Healthcare", "Total of the sector rows", "Unique contributions", "counted once in each of them", "Drafts are private"]) expect(h).toContain(w);
    for (const col of ["Draft", "Submitted", "Verified", "Changes requested", "Approved / published", "Rejected", "Unpublished", "Total"]) expect(h).toContain(col);
    expect(h).toMatch(/1 contribution has no sector yet and is in no row/);
  });
  it("links each non-zero count to that sector's list in the Admin Portal; zeros, drafts and the two total rows are plain numbers", async () => {
    await seedAll(); signInAs(admin, "admin");
    const h = await html();
    expect(h).toContain('href="/moderation/sector/education?tab=published"');
    expect(h).toContain('href="/moderation/sector/agriculture-dairy?tab=all&amp;verified=1"');
    expect(h).toContain('href="/moderation/sector/education?tab=all&amp;verified=0"');
    expect(h).toContain('href="/moderation/sector/education?tab=rejected"');
    expect(h).not.toContain("/moderation/sector/agriculture-dairy?tab=rejected"); // agriculture has no rejected item: just a 0
    expect(h).not.toMatch(/href="\/moderation\?/); // nothing points at the old single-page queue any more
    const totals = h.slice(h.indexOf("Total of the sector rows"));
    expect(totals).not.toContain("<a "); // the sum and unique rows span sectors: no links
  });
  it("is for administrators: a visitor is sent to sign in, a member to their dashboard, a moderator to their dashboard", async () => {
    await seedAll();
    signInAs(null); await expect(html()).rejects.toThrow("REDIRECT:/login");
    signInAs(author, "ST"); await expect(html()).rejects.toThrow("REDIRECT:/dashboard");
    const mod = Number((await seedUser({ email: `mod${++seq}@example.com`, role: "TC", fullName: "Mod" })).id);
    await q("UPDATE users SET is_moderator = true WHERE id = $1", [mod]);
    signInAs(mod, "TC"); await expect(html()).rejects.toThrow("REDIRECT:/dashboard");
  });
  it("a database failure shows an error notice, not a crash or details", async () => {
    signInAs(admin ? admin : 0, "admin");
    await seedAll(); signInAs(admin, "admin");
    testDb().failOn((sql) => (/FROM sectors/.test(sql) ? new Error("secret detail") : undefined));
    const h = await html();
    expect(h).toContain("could not be loaded");
    expect(h).not.toContain("secret detail");
  });
  it("a missing table says the migrations are needed (not 'the database did not answer'), and the log names the table", async () => {
    admin = Number((await seedUser({ email: `boss${++seq}@example.com`, role: "admin", fullName: "Boss" })).id); signInAs(admin, "admin");
    testDb().failOn((sql) => (/FROM sectors/.test(sql) ? Object.assign(new Error('relation "contribution_scopes" does not exist'), { code: "42P01" }) : undefined));
    const h = await html();
    expect(h).toContain("Contributions are not set up on this database yet"); expect(h).toContain("migrations 012 to 019");
    expect(h).not.toContain("did not answer"); expect(h).not.toContain("contribution_scopes"); // the page stays plain; the cause is in the log
    expect((console.error as any).mock.calls.map((c: unknown[]) => c[0])).toContain('admin sector counts: database error 42P01 (relation "contribution_scopes" does not exist)');
    testDb().failOn((sql) => (/FROM sectors/.test(sql) ? Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), { code: "ECONNREFUSED" }) : undefined));
    const down = await html();
    expect(down).toContain("The database did not answer"); expect(down).not.toContain("10.0.0.1");
  });
  it("loads with zero contributions: says 'No contributions yet' (not an error) and still lists every sector at 0", async () => {
    admin = Number((await seedUser({ email: `boss${++seq}@example.com`, role: "admin", fullName: "Boss" })).id); signInAs(admin, "admin");
    const h = await html();
    expect(h).toContain("No contributions yet"); expect(h).not.toContain("could not be loaded");
    expect(h).toContain("Agriculture"); expect(h).not.toContain("<a ");
    await seedAll();
    expect(await html()).not.toContain("No contributions yet");
  });
  it("is in the admin navigation", () => {
    expect(ADMIN_NAV.some((n) => n.href === "/admin/sectors")).toBe(true);
  });
});
