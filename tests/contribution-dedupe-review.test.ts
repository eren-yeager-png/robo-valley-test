// Duplicate prevention and the admin-only decisions (PR B): moderators review but never approve, publish, unpublish or remove; verify
// and remove; likely duplicates shown and re-checked at approval; the database safeguard (migration 018) answered as a friendly
// duplicate on submit. In-process database with the real migrations; no real database.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb, testPool } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
const who: { id: string | null } = { id: null };
vi.mock("../src/lib/currentUser", () => ({
  getCurrentUser: async () => (who.id ? { id: who.id, fullName: "Someone", email: "s@example.com", role: "ST" } : null),
  firstNameOf: () => "Someone",
}));

import * as decision from "../src/app/api/review/[id]/decision/route";
import * as detail from "../src/app/api/review/[id]/route";
import { ACTIONS, decide, findDuplicates, getForReview } from "../src/lib/contributionReview";
import { saveOwn, submitOwn } from "../src/lib/contributionApi";
import { publicSectorCounts } from "../src/lib/contributionHub";
import { listMine } from "../src/lib/contributionMine";

const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
let seq = 0, ipn = 0;
const ip = () => `30.${Math.floor(++ipn / 250)}.${ipn % 250}.1`;
async function user(role: string, moderator = false) { const u = await seedUser({ email: `d${++seq}@example.com`, role, fullName: `Person ${seq}` }); if (moderator) await q("UPDATE users SET is_moderator = true WHERE id = $1", [u.id]); return Number(u.id); }
async function make(userId: number, status: string, title: string, sector = "agriculture-dairy") {
  const id = Number(((await q("INSERT INTO contributions (user_id, type, title, body) VALUES ($1,'problem',$2,$3) RETURNING id", [userId, title, `Body for ${title} ${++seq}, long enough.`])).rows[0] as any).id);
  await q("INSERT INTO contribution_scopes (contribution_id, sector_id) SELECT $1, id FROM sectors WHERE slug=$2", [id, sector]);
  if (status !== "draft") await q("UPDATE contributions SET status=$2::varchar, submitted_at=now(), published_at=CASE WHEN $2::varchar='published' THEN now() END WHERE id=$1", [id, status]);
  return id;
}
const status = async (id: number) => ((await q("SELECT status FROM contributions WHERE id=$1", [id])).rows[0] as any).status;
const reviews = async (id: number) => (await q("SELECT reviewer_id, action, note FROM contribution_reviews WHERE contribution_id=$1 ORDER BY id", [id])).rows as any[];
const post = async (id: number, body: unknown) => { const r = await decision.POST(new Request("http://localhost/x", { method: "POST", headers: { "x-forwarded-for": ip(), "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: String(id) }) }); return { r, b: await r.json() }; };
const get = async (id: number) => { const r = await detail.GET(new Request("http://localhost/x", { headers: { "x-forwarded-for": ip() } }), { params: Promise.resolve({ id: String(id) }) }); return { r, b: await r.json() }; };
const as = (id: number | null) => { who.id = id === null ? null : String(id); };
const draft = (title: string, sectors = ["agriculture-dairy"], extra = "") => ({ type: "problem", sectors, title, description: `Cows are milked by hand every morning ${extra || ++seq}.`, role: "Farmer", district: "Guntur" });

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", "unit-test-secret-unit-test-secret-1234");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  who.id = null;
  await q("DELETE FROM api_rate_limits");
  await q("INSERT INTO sectors (slug, name, sort_order) VALUES ('education', 'Education', 20) ON CONFLICT (slug) DO NOTHING"); // a second sector (only Agriculture & Dairy is seeded)
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("who may decide", () => {
  it("the rules: moderators verify, request changes and reject; approve, remove, unpublish and republish are for administrators", () => {
    expect(Object.entries(ACTIONS).filter(([, r]) => r.adminOnly).map(([a]) => a).sort()).toEqual(["approve", "remove", "republish", "unpublish"]);
    expect(Object.entries(ACTIONS).filter(([, r]) => !r.adminOnly).map(([a]) => a).sort()).toEqual(["reject", "request_changes", "verify"]);
  });
  it("a moderator gets 403 ADMIN_ONLY for approve, remove, unpublish and republish, and nothing changes or is recorded", async () => {
    const mod = await user("TC", true), author = await user("ST");
    const p = await make(author, "pending_review", "Moderator cannot approve this"), pub = await make(author, "published", "Moderator cannot unpublish this"), un = await make(author, "unpublished", "Moderator cannot republish this");
    as(mod);
    for (const [id, action] of [[p, "approve"], [p, "remove"], [pub, "unpublish"], [un, "republish"]] as const) {
      const x = await post(id, { action, note: "A reason given here" });
      expect(x.r.status, action).toBe(403); expect(x.b.error).toBe("ADMIN_ONLY");
    }
    expect([await status(p), await status(pub), await status(un)]).toEqual(["pending_review", "published", "unpublished"]);
    expect([...(await reviews(p)), ...(await reviews(pub)), ...(await reviews(un))]).toEqual([]);
  });
  it("a moderator's item view offers only verify, request changes and reject; an administrator's offers all pending actions", async () => {
    const mod = await user("TC", true), admin = await user("admin"), author = await user("ST");
    const id = await make(author, "pending_review", "Which buttons do I see");
    as(mod); expect((await get(id)).b.item.actions.sort()).toEqual(["reject", "request_changes", "verify"]);
    as(admin); expect((await get(id)).b.item.actions.sort()).toEqual(["approve", "reject", "remove", "request_changes", "verify"]);
  });
  it("a moderator can verify (no status change, audited) and reject; the item then shows as verified", async () => {
    const mod = await user("TC", true), author = await user("ST");
    const id = await make(author, "pending_review", "Verify me please"), r = await make(author, "pending_review", "Reject me please");
    as(mod);
    const v = await post(id, { action: "verify" });
    expect(v.r.status).toBe(200); expect(v.b.status).toBe("pending_review");
    expect(await status(id)).toBe("pending_review");
    expect(await reviews(id)).toEqual([expect.objectContaining({ action: "verify", note: null })]);
    expect((await get(id)).b.item.verified).toBe(true);
    expect((await post(r, { action: "reject", note: "This reads as an advert." })).b.status).toBe("rejected");
  });
});

describe("remove (soft delete, administrators only)", () => {
  it("needs a reason, keeps the row and its audit trail, frees the title, and the author sees it as Removed with the reason", async () => {
    const admin = await user("admin"), author = await user("ST");
    const id = await make(author, "pending_review", "Remove me as a duplicate");
    as(admin);
    const noReason = await post(id, { action: "remove" });
    expect(noReason.r.status).toBe(400); expect(noReason.b.fieldErrors.note).toBeTruthy();
    const ok = await post(id, { action: "remove", note: "Duplicate of an earlier entry" });
    expect(ok.r.status).toBe(200); expect(ok.b.status).toBe("removed");
    expect(await status(id)).toBe("removed");
    expect(await reviews(id)).toEqual([expect.objectContaining({ action: "remove", note: "Duplicate of an earlier entry" })]);
    expect(Number(((await q("SELECT count(*) n FROM contribution_title_keys WHERE contribution_id=$1", [id])).rows[0] as any).n)).toBe(0);
    const mine = await listMine(testPool(), author);
    expect(mine.items.find((i: any) => i.id === id)).toMatchObject({ status: "removed" });
    await make(author, "pending_review", "Remove me as a duplicate"); // the title is free again
  });
});

describe("likely duplicates", () => {
  it("lists live items in the same sector with the same or a very similar title, never other sectors, drafts or demo items", async () => {
    const author = await user("ST"), other = await user("ST");
    const a = await make(author, "published", "Weekend robotics club for girls");
    await make(author, "pending_review", "Weekend robotics club for girls", "education"); // another sector
    await make(author, "draft", "Weekend robotics clubs for girls"); // a draft
    await make(author, "pending_review", "Completely different topic here");
    const b = await make(other, "pending_review", "Weekend robotics clubs for girl");
    const d = await findDuplicates(testPool(), b, "Weekend robotics clubs for girl");
    expect(d.map((x) => x.id)).toEqual([a]);
    expect(d[0]!.similarity).toBeGreaterThanOrEqual(0.8);
  });
  it("approve is blocked while a likely duplicate is live; it needs an explicit confirmation WITH a reason, and the audit row says so", async () => {
    const admin = await user("admin"), author = await user("ST"), other = await user("ST");
    const a = await make(author, "published", "Solar powered milking robot");
    const b = await make(other, "pending_review", "Solar-powered milking robots");
    as(admin);
    const item = (await get(b)).b.item;
    expect(item.duplicates.map((x: any) => x.id)).toEqual([a]);
    const blocked = await post(b, { action: "approve" });
    expect(blocked.r.status).toBe(409); expect(blocked.b.error).toBe("DUPLICATE_WARNING"); expect(blocked.b.duplicates.map((x: any) => x.id)).toEqual([a]);
    expect(await status(b)).toBe("pending_review");
    const noReason = await post(b, { action: "approve", confirmDuplicate: true });
    expect(noReason.r.status).toBe(400); expect(noReason.b.fieldErrors.note).toBeTruthy();
    const ok = await post(b, { action: "approve", confirmDuplicate: true, note: "Different model, checked with the author" });
    expect(ok.r.status).toBe(200); expect(await status(b)).toBe("published");
    expect((await reviews(b))[0].note).toBe(`Approved despite a possible duplicate of #${a}: Different model, checked with the author`);
  });
  it("the check runs again at approval: a similar item that went live after submission still blocks", async () => {
    const admin = await user("admin"), author = await user("ST"), other = await user("ST");
    const b = await make(other, "pending_review", "Low cost drone sprayer trial");
    as(admin);
    expect((await get(b)).b.item.duplicates).toEqual([]);
    await make(author, "published", "Low-cost drone sprayer trials"); // goes live meanwhile
    expect((await post(b, { action: "approve" })).b.error).toBe("DUPLICATE_WARNING");
    expect(await status(b)).toBe("pending_review");
  });
  it("without a duplicate, approve works as before and publishes in one step", async () => {
    const admin = await user("admin"), author = await user("ST");
    const id = await make(author, "pending_review", "A unique title nobody else used");
    as(admin);
    const x = await post(id, { action: "approve" });
    expect(x.r.status).toBe(200); expect(await status(id)).toBe("published");
  });
});

describe("the database safeguard on submit and edit", () => {
  it("a second live contribution with the same normalised title in the same sector gets a friendly 409 DUPLICATE, not a server error", async () => {
    const one = await user("ST"), two = await user("ST");
    const a = await saveOwn(testPool(), one, draft("Shed cleaning robot for small dairies")) as any;
    expect((await submitOwn(testPool(), one, a.id)).ok).toBe(true);
    const b = await saveOwn(testPool(), two, draft("shed-cleaning robot, for small dairies!")) as any; // drafts may collide
    expect(b.ok).toBe(true);
    const s = await submitOwn(testPool(), two, b.id) as any;
    expect(s.ok).toBe(false); expect(s.status).toBe(409); expect(s.error).toBe("DUPLICATE"); expect(s.fieldErrors.title).toBeTruthy();
    expect(await status(b.id)).toBe("draft");
    const elsewhere = await saveOwn(testPool(), two, draft("Shed cleaning robot for small dairies", ["education"])) as any;
    expect((await submitOwn(testPool(), two, elsewhere.id)).ok).toBe(true); // another sector is fine
  });
  it("editing a live item onto a title already live in its sector is refused the same way", async () => {
    const one = await user("ST"), two = await user("ST");
    const a = await saveOwn(testPool(), one, draft("Biogas plant monitoring")) as any; await submitOwn(testPool(), one, a.id);
    const b = await saveOwn(testPool(), two, draft("Biogas digester sensors")) as any; await submitOwn(testPool(), two, b.id);
    const e = await saveOwn(testPool(), two, draft("BIOGAS plant monitoring."), b.id) as any;
    expect(e.ok).toBe(false); expect(e.status).toBe(409); expect(e.error).toBe("DUPLICATE");
  });
});

describe("nothing pending, rejected or removed is public", () => {
  it("public sector counts include published, non-demo items only", async () => {
    const author = await user("ST"), admin = await user("admin");
    const before = (await publicSectorCounts(testPool())).find((s) => s.slug === "agriculture-dairy")!.contributions;
    await make(author, "pending_review", "Pending is not public");
    const r = await make(author, "pending_review", "Removed is not public");
    as(admin); await post(r, { action: "remove", note: "Unsuitable content" });
    await make(author, "rejected", "Rejected is not public");
    expect((await publicSectorCounts(testPool())).find((s) => s.slug === "agriculture-dairy")!.contributions).toBe(before);
    await make(author, "published", "Published is public");
    expect((await publicSectorCounts(testPool())).find((s) => s.slug === "agriculture-dairy")!.contributions).toBe(before + 1);
  });
  it("decide() keeps the old call shape: without isAdmin it can only do what a moderator can", async () => {
    const author = await user("ST"), mod = await user("TC", true);
    const id = await make(author, "pending_review", "Old call shape still safe");
    const r = await decide(testPool(), mod, id, "approve", null) as any;
    expect(r.ok).toBe(false); expect(r.error).toBe("ADMIN_ONLY");
  });
});
