// Structured directory categories (portal PR2): what the form may send, saving with the item (one transaction), replacing on edit, the
// folded copy kept in the description, older items read back for Edit, and the member's Edit + resubmit round trip (back to New).
// In-process database with the real migrations and the real routes; no real database.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
const who: { id: string | null } = { id: null };
vi.mock("../src/lib/currentUser", () => ({
  getCurrentUser: async () => (who.id ? { id: who.id, fullName: "Someone", email: "s@example.com", role: "ST" } : null),
  firstNameOf: () => "Someone",
}));

import { DIRECTORY_CATEGORIES, LINK_TYPES, readDirectory, splitFold } from "../src/lib/directoryCategories";
import * as create from "../src/app/api/contributions/route";
import * as one from "../src/app/api/contributions/[id]/route";
import * as submitRoute from "../src/app/api/contributions/[id]/submit/route";
import { decide, getForReview } from "../src/lib/contributionReview";
import { displayStatus, roundFacts } from "../src/lib/reviewStatus";

const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
let seq = 0, ipn = 0;
const ip = () => `33.${Math.floor(++ipn / 250)}.${ipn % 250}.1`;
async function user(role: string, moderator = false) { const u = await seedUser({ email: `s${++seq}@example.com`, role, fullName: `Person${seq} Name` }); if (moderator) await q("UPDATE users SET is_moderator = true WHERE id = $1", [u.id]); return Number(u.id); }
const as = (id: number) => { who.id = String(id); };
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const req = (method: string, body?: unknown) => new Request("http://localhost/x", { method, headers: { "x-forwarded-for": ip(), "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const DIR = [
  { category: "Projects", remarks: "Tested for six weeks.", links: [{ type: "Website", url: "https://example.org/milker", gist: "The build log" }, { type: "Video", url: "https://example.org/v", gist: "A short video" }] },
  { category: "Labs & Makerspaces", remarks: "", links: [] },
];
/** the description exactly as plugin 0.1.5 folds it */
const fold = (text: string, dir = DIR) => [text, "", "Directory categories: " + dir.map((d) => d.category).join(", "),
  ...dir.flatMap((d) => [...(d.remarks ? [`[${d.category}] Remarks: ${d.remarks}`] : []), ...d.links.map((l, i) => `[${d.category}] Link ${i + 1} (${l.type}): ${l.url} - ${l.gist}`)])].join("\n");
const draft = (over: Record<string, unknown> = {}) => ({ type: "resource", sectors: ["agriculture-dairy"], title: `Solar milking robot ${++seq}`, description: fold("A student team built a small solar milking unit."), directory: DIR, role: "Teacher / lab in-charge", district: "", ...over });
const rows = async (id: number) => ({
  cats: (await q("SELECT category, remarks, position FROM contribution_categories WHERE contribution_id=$1 ORDER BY position", [id])).rows as any[],
  links: (await q("SELECT category, position, link_type, url, gist FROM contribution_category_links WHERE contribution_id=$1 ORDER BY category, position", [id])).rows as any[],
});

beforeEach(async () => { vi.spyOn(console, "error").mockImplementation(() => undefined); await q("DELETE FROM api_rate_limits"); });
afterEach(() => { vi.restoreAllMocks(); });

describe("what the form may send", () => {
  it("accepts the form's own categories and link types; absent means 'leave as it is'", () => {
    expect(readDirectory(undefined)).toEqual({ present: false });
    expect(readDirectory(DIR)).toEqual({ present: true, ok: true, value: DIR });
    expect(readDirectory([])).toEqual({ present: true, ok: true, value: [] });
    expect(DIRECTORY_CATEGORIES).toHaveLength(7); expect(LINK_TYPES).toHaveLength(11);
  });
  it("refuses anything else, with a plain message", () => {
    const bad = (v: unknown) => { const r = readDirectory(v); return r.present && !r.ok ? (r as { message: string }).message : "ACCEPTED"; };
    expect(bad("Projects")).toMatch(/could not be read/);
    expect(bad([{ category: "Shops" }])).toMatch(/from the list/);
    expect(bad([{ category: "Projects" }, { category: "Projects" }])).toMatch(/once/);
    expect(bad([{ category: "Projects", links: [{ type: "Brochure", url: "https://x.org", gist: "g" }] }])).toMatch(/type/);
    expect(bad([{ category: "Projects", links: [{ type: "Website", url: "javascript:alert(1)", gist: "g" }] }])).toMatch(/https:/);
    expect(bad([{ category: "Projects", links: [{ type: "Website", url: "https://x.org/a b", gist: "g" }] }])).toMatch(/https:/);
    expect(bad([{ category: "Projects", links: [{ type: "Website", url: "https://x.org", gist: "" }] }])).toMatch(/what each link/);
    expect(bad([{ category: "Projects", links: [{ type: "Website", url: "https://x.org", gist: "x".repeat(181) }] }])).toMatch(/180/);
    expect(bad([{ category: "Projects", links: Array.from({ length: 6 }, () => ({ type: "Website", url: "https://x.org", gist: "g" })) }])).toMatch(/up to 5/);
    expect(bad([{ category: "Projects", remarks: "x".repeat(2001) }])).toMatch(/2000/);
    expect(bad(Array.from({ length: 8 }, () => ({ category: "Projects" })))).toMatch(/Too many/);
  });
  it("splitFold reads the plugin's folded text back; anything else is left alone", () => {
    expect(splitFold(fold("My own words."))).toEqual({ text: "My own words.", entries: DIR });
    expect(splitFold("Just words, no fold.")).toEqual({ text: "Just words, no fold.", entries: null });
    expect(splitFold("Words.\n\nDirectory categories: Shops").entries).toBeNull(); // not one of the form's categories
    expect(splitFold("Words.\n\nDirectory categories: Projects\nsomething typed by hand").entries).toBeNull();
    expect(splitFold("Words.\n\nDirectory categories: Projects\n[Events] Remarks: wrong category").entries).toBeNull();
  });
});

describe("saving with the item", () => {
  it("a new draft stores the categories, remarks and links in the member's order, and the folded copy stays in the description", async () => {
    const m = await user("TC"); as(m);
    const r = await create.POST(req("POST", draft()));
    expect(r.status).toBe(201);
    const id = Number((await r.json()).id);
    const { cats, links } = await rows(id);
    expect(cats.map((c) => [c.category, c.remarks, c.position])).toEqual([["Projects", "Tested for six weeks.", 1], ["Labs & Makerspaces", null, 2]]);
    expect(links.map((l) => [l.category, l.position, l.link_type, l.url, l.gist])).toEqual([["Projects", 1, "Website", "https://example.org/milker", "The build log"], ["Projects", 2, "Video", "https://example.org/v", "A short video"]]);
    expect(String(((await q("SELECT body FROM contributions WHERE id=$1", [id])).rows[0] as any).body)).toContain("Directory categories: Projects, Labs & Makerspaces");
  });
  it("an edit replaces them; an older form that sends no directory leaves them as they are", async () => {
    const m = await user("TC"); as(m);
    const id = Number((await (await create.POST(req("POST", draft()))).json()).id);
    const next = [{ category: "Events", remarks: "Next batch in December.", links: [] }];
    expect((await one.PATCH(req("PATCH", draft({ description: fold("A student team built a small solar milking unit.", next), directory: next })), ctx(id))).status).toBe(200);
    expect((await rows(id)).cats.map((c) => c.category)).toEqual(["Events"]);
    expect((await rows(id)).links).toEqual([]);
    const { directory: _d, ...older } = draft();
    expect((await one.PATCH(req("PATCH", older), ctx(id))).status).toBe(200);
    expect((await rows(id)).cats.map((c) => c.category)).toEqual(["Events"]);
  });
  it("a bad directory is refused (400, fieldErrors.directory) and nothing is stored", async () => {
    const m = await user("TC"); as(m);
    const r = await create.POST(req("POST", draft({ directory: [{ category: "Shops" }] })));
    expect(r.status).toBe(400);
    expect((await r.json()).fieldErrors.directory).toMatch(/from the list/);
    expect(Number(((await q("SELECT count(*)::int n FROM contributions")).rows[0] as any).n)).toBe(0);
  });
  it("if saving the categories fails, the whole save is rolled back (one transaction)", async () => {
    const m = await user("TC"); as(m);
    testDb().failOn((sql) => (/INSERT INTO contribution_category_links/.test(sql) ? new Error("disk full") : undefined));
    const r = await create.POST(req("POST", draft()));
    testDb().failOn(undefined);
    expect(r.status).toBe(500);
    expect(Number(((await q("SELECT count(*)::int n FROM contributions")).rows[0] as any).n)).toBe(0);
    expect(Number(((await q("SELECT count(*)::int n FROM contribution_categories")).rows[0] as any).n)).toBe(0);
  });
});

describe("reading back", () => {
  it("your own item comes back with the categories and your words without the fold (for Edit); an older item's fold is read too", async () => {
    const m = await user("TC"); as(m);
    const id = Number((await (await create.POST(req("POST", draft()))).json()).id);
    const own = await (await one.GET(req("GET"), ctx(id))).json();
    expect(own.contribution.description).toBe("A student team built a small solar milking unit.");
    expect(own.contribution.directory).toEqual(DIR);
    const older = Number(((await q("INSERT INTO contributions (user_id, type, title, body) VALUES ($1,'resource','Sent before PR2',$2) RETURNING id", [m, fold("Older words.", [{ category: "Events", remarks: "In December.", links: [] }])])).rows[0] as any).id);
    const o = await (await one.GET(req("GET"), ctx(older))).json();
    expect(o.contribution.description).toBe("Older words.");
    expect(o.contribution.directory).toEqual([{ category: "Events", remarks: "In December.", links: [] }]);
  });
  it("reviewers: structured categories and the description without the fold; an older item keeps its description as it is", async () => {
    const m = await user("TC"), mod = await user("TC", true); as(m);
    const id = Number((await (await create.POST(req("POST", draft()))).json()).id);
    await submitRoute.POST(req("POST"), ctx(id));
    const item = (await getForReview(testDb().pool as never, mod, id))!;
    expect(item.categories).toEqual(DIR);
    expect(item.description).toBe("A student team built a small solar milking unit.");
    const older = Number(((await q("INSERT INTO contributions (user_id, type, title, body) VALUES ($1,'resource','Sent before PR2 too',$2) RETURNING id", [m, fold("Older words.")])).rows[0] as any).id);
    await q("INSERT INTO contribution_scopes (contribution_id, sector_id) SELECT $1, id FROM sectors WHERE slug='agriculture-dairy'", [older]);
    await q("UPDATE contributions SET status='pending_review', submitted_at=now() WHERE id=$1", [older]);
    const o = (await getForReview(testDb().pool as never, mod, older))!;
    expect(o.categories).toBeNull();
    expect(o.description).toContain("Directory categories: Projects");
  });
});

describe("the member's Edit after changes are requested", () => {
  it("edit and resubmit: back to pending_review, shown as New again, with the new categories", async () => {
    const m = await user("TC"), mod = await user("TC", true); as(m);
    const id = Number((await (await create.POST(req("POST", draft()))).json()).id);
    expect((await submitRoute.POST(req("POST"), ctx(id))).status).toBe(200);
    await q("INSERT INTO contribution_views (contribution_id, viewer_id) VALUES ($1,$2)", [id, mod]); // a moderator opened it
    const d = await decide(testDb().pool as never, mod, id, "request_changes", "Please add the district.");
    expect(d.ok).toBe(true);
    await q("SELECT pg_sleep(0.01)");
    as(m);
    const next = [{ category: "Training & Workshops", remarks: "", links: [{ type: "Website", url: "https://example.org/t", gist: "Dates and fees" }] }];
    expect((await one.PATCH(req("PATCH", draft({ title: "Solar milking robot, Guntur", description: fold("A student team built a small solar milking unit in Guntur.", next), directory: next })), ctx(id))).status).toBe(200);
    const s = await submitRoute.POST(req("POST"), ctx(id));
    expect(s.status).toBe(200); expect((await s.json()).status).toBe("pending_review");
    const facts = (await roundFacts(testDb().pool as never, [id])).get(id);
    expect(displayStatus("pending_review", facts)).toBe("new"); // the earlier view belongs to the last round
    expect((await rows(id)).cats.map((c) => c.category)).toEqual(["Training & Workshops"]);
  });
});
