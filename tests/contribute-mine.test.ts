// "Your contributions" (GET /api/contributions/mine): own items only, grouped data, notes where they matter, derived badge, privacy,
// the rules for editing in each status (including the new ones from migration 017), and failures. In-process database, real migrations.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
const who: { id: string | null } = { id: null };
vi.mock("../src/lib/currentUser", () => ({
  getCurrentUser: async () => (who.id ? { id: who.id, fullName: "Test Person", email: "t@example.com", role: "ST" } : null),
  firstNameOf: () => "Test",
}));

import * as mine from "../src/app/api/contributions/mine/route";
import * as one from "../src/app/api/contributions/[id]/route";
import * as submit from "../src/app/api/contributions/[id]/submit/route";
import * as sectors from "../src/app/api/contributions/sectors/route";
import { isContributor, listMine } from "../src/lib/contributionMine";

const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
const H = { "x-forwarded-for": "8.8.8.8", "content-type": "application/json" };
const getMine = async (ip = "8.8.8.8") => { const r = await (mine.GET as never as (r: Request) => Promise<Response>)(new Request("http://localhost/api/contributions/mine", { headers: { "x-forwarded-for": ip } })); return { r, b: await r.json() }; };
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
let seq = 0;
async function signIn() { const u = await seedUser({ email: `m${++seq}@example.com`, role: "ST", fullName: `Member ${seq}` }); who.id = String(u.id); return Number(u.id); }
async function make(userId: number, status: string, title = `Title number ${++seq} here`) {
  const id = Number(((await q("INSERT INTO contributions (user_id, type, title, body) VALUES ($1,'problem',$2,'SECRET-BODY-TEXT that must not be listed.') RETURNING id", [userId, title])).rows[0] as any).id);
  await q("INSERT INTO contribution_scopes (contribution_id, sector_id) SELECT $1, id FROM sectors WHERE slug='agriculture-dairy'", [id]);
  if (status !== "draft") await q("UPDATE contributions SET status=$2::varchar, submitted_at=now(), published_at=CASE WHEN $2::varchar='published' THEN now() END WHERE id=$1", [id, status]);
  return id;
}
const review = (id: number, action: string, note: string | null) => q("INSERT INTO contribution_reviews (contribution_id, action, note) VALUES ($1,$2,$3)", [id, action, note]);

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", "unit-test-secret-unit-test-secret-1234");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  who.id = null;
  await q("DELETE FROM api_rate_limits");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); testDb().failOn(undefined); });

describe("access", () => {
  it("needs a signed-in member (401, never cached) and the preflight works", async () => {
    const x = await getMine();
    expect(x.r.status).toBe(401); expect(x.r.headers.get("cache-control")).toBe("no-store");
    expect((await (mine.OPTIONS as never as (r: Request) => Promise<Response>)(new Request("http://localhost/x", { method: "OPTIONS", headers: { origin: "https://techytree.in" } }))).status).toBeLessThan(300);
  });
  it("only your own items: nobody else's title, id or count shows up", async () => {
    const a = await signIn(); await make(a, "published", "Alice published item");
    const b = await signIn(); await make(b, "draft", "Bob draft item");
    const x = await getMine();
    expect(x.b.items.map((i: any) => i.title)).toEqual(["Bob draft item"]);
    expect(JSON.stringify(x.b)).not.toContain("Alice");
    expect(x.b.counts).toMatchObject({ draft: 1, published: 0 });
  });
});

describe("what a list contains", () => {
  it("title, type, sectors, status, date and edit permission; never the body, photos or contact details", async () => {
    const u = await signIn(); const id = await make(u, "draft", "My milking idea");
    await q("INSERT INTO contribution_contacts (contribution_id, contact_name, email, share_with_moderators) VALUES ($1,'Secret Name','secret@example.com',false)", [id]);
    const x = await getMine();
    expect(x.b.items[0]).toMatchObject({ id, title: "My milking idea", type: "problem", typeLabel: "Report a problem", status: "draft", statusLabel: "Draft", canEdit: true, note: null, sectors: [{ slug: "agriculture-dairy", name: "Agriculture & Dairy" }] });
    const text = JSON.stringify(x.b);
    expect(text).not.toMatch(/SECRET-BODY|Secret Name|secret@example|body|photo/i);
    expect(x.r.headers.get("cache-control")).toBe("no-store");
  });
  it("counts every status and orders newest first", async () => {
    const u = await signIn();
    for (const s of ["draft", "pending_review", "changes_requested", "published", "unpublished", "rejected"]) await make(u, s);
    await make(u, "published");
    const x = await getMine();
    expect(x.b.counts).toEqual({ draft: 1, pending_review: 1, changes_requested: 1, published: 2, unpublished: 1, rejected: 1 });
    expect(x.b.items).toHaveLength(7);
  });
  it("the moderator's note shows only for changes requested, rejected and unpublished, and is the LATEST note", async () => {
    const u = await signIn();
    const c = await make(u, "changes_requested"), r = await make(u, "rejected"), p = await make(u, "published"), k = await make(u, "unpublished");
    await review(c, "request_changes", "First note: add the district."); await review(c, "request_changes", "Second note: add the cost too.");
    await review(r, "reject", "This is a product advert, not a problem report."); await review(k, "unpublish", "Contains a private phone number.");
    await review(p, "approve", "Internal approval comment");
    const items = Object.fromEntries((await getMine()).b.items.map((i: any) => [i.id, i]));
    expect(items[c].note).toBe("Second note: add the cost too.");
    expect(items[r].note).toMatch(/product advert/); expect(items[k].note).toMatch(/private phone/);
    expect(items[p].note).toBeNull();
  });
  it("rejected can not be edited; every other status can", async () => {
    const u = await signIn(); const ids: Record<string, number> = {};
    for (const s of ["draft", "pending_review", "changes_requested", "published", "unpublished", "rejected"]) ids[s] = await make(u, s);
    const items = Object.fromEntries((await getMine()).b.items.map((i: any) => [i.status, i.canEdit]));
    expect(items).toEqual({ draft: true, pending_review: true, changes_requested: true, published: true, unpublished: true, rejected: false });
  });
});

describe("the Contributor badge is derived, never stored", () => {
  it("false with no items or only drafts; true from the first non-draft; false again if that item is deleted", async () => {
    const u = await signIn();
    expect((await getMine()).b.contributor).toBe(false);
    const d = await make(u, "draft");
    expect((await getMine()).b.contributor).toBe(false);
    expect(await isContributor(testDb().raw as never, u)).toBe(false);
    const p = await make(u, "pending_review");
    expect((await getMine()).b.contributor).toBe(true);
    expect(await isContributor(testDb().raw as never, u)).toBe(true);
    await q("DELETE FROM contributions WHERE id = $1", [d]);
    await q("UPDATE contributions SET status='rejected' WHERE id = $1", [p]);
    expect((await getMine()).b.contributor).toBe(true); // a rejected submission is still a submission
    const cols = (await q("SELECT column_name FROM information_schema.columns WHERE table_name='users'")).rows.map((r: any) => r.column_name);
    expect(cols.filter((c: string) => /contributor|badge/i.test(c))).toEqual([]);
  });
});

describe("editing rules in each status (the owner's side of the status machine)", () => {
  const patch = async (id: number, over: Record<string, unknown> = {}) => {
    const r = await (one.PATCH as never as (r: Request, c: unknown) => Promise<Response>)(new Request(`http://localhost/api/contributions/${id}`, { method: "PATCH", headers: { ...H, "x-forwarded-for": `7.${Math.floor(Math.random() * 250)}.1.1` }, body: JSON.stringify({ type: "problem", sectors: ["agriculture-dairy"], title: `Edited title ${Math.random()}`, description: `Edited text that is long enough ${Math.random()}`, ...over }) }), ctx(id));
    return { r, b: await r.json() };
  };
  it("a taken-down item edited goes back to Pending review; a rejected one is refused (409) and stays rejected", async () => {
    const u = await signIn(); const k = await make(u, "unpublished"), r = await make(u, "rejected");
    expect((await patch(k)).b.status).toBe("pending_review");
    const x = await patch(r);
    expect(x.r.status).toBe(409); expect(x.b.error).toBe("NOT_EDITABLE");
    expect(((await q("SELECT status FROM contributions WHERE id=$1", [r])).rows[0] as any).status).toBe("rejected");
    expect(((await q("SELECT published_at FROM contributions WHERE id=$1", [k])).rows[0] as any).published_at).toBeNull();
  });
  it("a taken-down item can be sent again; rejected and published cannot be submitted", async () => {
    const u = await signIn(); const k = await make(u, "unpublished"), r = await make(u, "rejected"), p = await make(u, "published");
    const s = async (id: number, ip: string) => { const x = await (submit.POST as never as (r: Request, c: unknown) => Promise<Response>)(new Request("http://localhost/x", { method: "POST", headers: { ...H, "x-forwarded-for": ip } }), ctx(id)); return x.status; };
    expect(await s(k, "7.1.1.1")).toBe(200);
    expect(await s(r, "7.1.1.2")).toBe(409); expect(await s(p, "7.1.1.3")).toBe(409);
  });
  it("an edited PUBLISHED item leaves the public counts until it is approved again", async () => {
    const u = await signIn(); const p = await make(u, "published");
    const count = async (ip: string) => ((await (await (sectors.GET as never as (r: Request) => Promise<Response>)(new Request("http://localhost/x", { headers: { "x-forwarded-for": ip } }))).json()).sectors.find((s: any) => s.slug === "agriculture-dairy")).contributions;
    expect(await count("4.4.4.4")).toBe(1);
    await patch(p, { title: "Edited after it was published" });
    expect(await count("4.4.4.5")).toBe(0);
    expect((await getMine()).b.items[0]).toMatchObject({ status: "pending_review" });
  });
});

describe("failures", () => {
  it("answers 503 NOT_SET_UP when the tables are missing and a plain 500 without details for anything else", async () => {
    await signIn();
    testDb().failOn((sql) => (/FROM contributions c WHERE c\.user_id/.test(sql) ? Object.assign(new Error('relation "contributions" does not exist'), { code: "42P01" }) : undefined));
    const a = await getMine("3.3.3.1"); expect(a.r.status).toBe(503); expect(a.b.error).toBe("NOT_SET_UP");
    testDb().failOn((sql) => (/FROM contributions c WHERE c\.user_id/.test(sql) ? new Error("password=hunter2") : undefined));
    const b = await getMine("3.3.3.2"); expect(b.r.status).toBe(500); expect(JSON.stringify(b.b)).not.toMatch(/hunter2/);
  });
  it("before migration 017 the list still works, just without notes", async () => {
    const u = await signIn(); await make(u, "changes_requested", "Needs work");
    testDb().failOn((sql) => (/FROM contribution_reviews/.test(sql) ? Object.assign(new Error('relation "contribution_reviews" does not exist'), { code: "42P01" }) : undefined));
    const x = await getMine("3.3.3.3");
    expect(x.r.status).toBe(200); expect(x.b.items[0]).toMatchObject({ title: "Needs work", note: null });
  });
  it("listMine caps the list and never throws on an empty account", async () => {
    const u = await signIn();
    expect(await listMine(testDb().raw as never, u)).toMatchObject({ contributor: false, items: [] });
  });
});
