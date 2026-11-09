// The moderation queue (PR 6): who may review, what the queue and an item show, the five decisions and their audit rows, the rules that
// protect authors (own items, notes, contact details), photos for reviewers, rate limits and every failure. In-process database, real migrations.
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb, testPool } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
const who: { id: string | null } = { id: null };
vi.mock("../src/lib/currentUser", () => ({
  getCurrentUser: async () => (who.id ? { id: who.id, fullName: "Someone", email: "s@example.com", role: "ST" } : null),
  firstNameOf: () => "Someone",
}));

import * as queue from "../src/app/api/admin/moderation/queue/route";
import * as detail from "../src/app/api/admin/moderation/[id]/route";
import * as decision from "../src/app/api/admin/moderation/[id]/decision/route";
import * as photo from "../src/app/api/admin/moderation/[id]/photos/[photoId]/route";
import * as mine from "../src/app/api/contributions/mine/route";
import * as sectors from "../src/app/api/contributions/sectors/route";
import { ACTIONS, checkDecision } from "../src/lib/contributionReview";
import { reviewerOf } from "../src/lib/moderators";
import { addPhoto } from "../src/lib/contributionPhotos";
import { SERVICE_RATE_LIMITS } from "../src/lib/apiRateLimit";

const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
let seq = 0, ipn = 0;
const ip = () => `20.${Math.floor(++ipn / 250)}.${ipn % 250}.1`;
type Fn = (r: Request, c?: any) => Promise<Response>;
const call = async (fn: unknown, method: string, url: string, body?: unknown, ctx?: unknown, headers: Record<string, string> = {}) => {
  const r = await (fn as Fn)(new Request("http://localhost" + url, { method, headers: { "x-forwarded-for": ip(), "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), ctx);
  const ct = r.headers.get("content-type") ?? "";
  return { r, b: ct.includes("json") ? await r.json() : null };
};
const P = (id: number | string, photoId?: number | string) => ({ params: Promise.resolve({ id: String(id), ...(photoId !== undefined ? { photoId: String(photoId) } : {}) }) });
async function user(role: string, moderator = false) { const u = await seedUser({ email: `u${++seq}@example.com`, role, fullName: `Person ${seq}` }); if (moderator) await q("UPDATE users SET is_moderator = true WHERE id = $1", [u.id]); return Number(u.id); }
const as = (id: number | null) => { who.id = id === null ? null : String(id); };
async function make(userId: number, status: string, o: { title?: string; demo?: boolean; body?: string } = {}) {
  const id = Number(((await q("INSERT INTO contributions (user_id, type, title, body, is_demo) VALUES ($1,'problem',$2,$3,$4) RETURNING id", [userId, o.title ?? `Item title ${++seq} here`, o.body ?? "Cows are milked by hand.\n\n## Role\nFarmer\n\n## District\nGuntur", !!o.demo])).rows[0] as any).id);
  await q("INSERT INTO contribution_scopes (contribution_id, sector_id) SELECT $1, id FROM sectors WHERE slug='agriculture-dairy'", [id]);
  if (status !== "draft") await q("UPDATE contributions SET status=$2::varchar, submitted_at=now() - ($1::int * interval '1 minute'), published_at=CASE WHEN $2::varchar='published' THEN now() END WHERE id=$1", [id, status]);
  return id;
}
const decide = (id: number, action: unknown, note?: unknown) => call(decision.POST, "POST", `/x`, { action, note }, P(id));
const status = async (id: number) => ((await q("SELECT status FROM contributions WHERE id=$1", [id])).rows[0] as any).status;
const reviews = async (id: number) => (await q("SELECT reviewer_id, action, note FROM contribution_reviews WHERE contribution_id=$1 ORDER BY id", [id])).rows as any[];
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9]);

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", "unit-test-secret-unit-test-secret-1234");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  who.id = null;
  await q("DELETE FROM api_rate_limits");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); testDb().failOn(undefined); });

describe("who may review", () => {
  it("anonymous 401, an ordinary member 403, an administrator and a flagged moderator are in; nobody gets a cached answer", async () => {
    const member = await user("ST"), admin = await user("admin"), mod = await user("TC", true);
    as(null); expect((await call(queue.GET, "GET", "/x")).r.status).toBe(401);
    as(member); const m = await call(queue.GET, "GET", "/x"); expect(m.r.status).toBe(403); expect(m.r.headers.get("cache-control")).toBe("no-store");
    as(admin); expect((await call(queue.GET, "GET", "/x")).r.status).toBe(200);
    as(mod); expect((await call(queue.GET, "GET", "/x")).r.status).toBe(200);
  });
  it("every reviewing route refuses a member and a foreign origin", async () => {
    const member = await user("ST"), admin = await user("admin"); const id = await make(await user("ST"), "pending_review");
    as(member);
    for (const x of [await call(queue.GET, "GET", "/x"), await call(detail.GET, "GET", "/x", undefined, P(id)), await decide(id, "approve"), await call(photo.GET, "GET", "/x", undefined, P(id, 1))]) expect(x.r.status).toBe(403);
    expect(await status(id)).toBe("pending_review");
    as(admin);
    expect((await call(queue.GET, "GET", "/x", undefined, undefined, { origin: "https://evil.example" })).r.status).toBe(403);
  });
  it("a removed flag takes access away at once, and before migration 015 only administrators get in (fails closed)", async () => {
    const mod = await user("TC", true), admin = await user("admin");
    as(mod); expect((await call(queue.GET, "GET", "/x")).r.status).toBe(200);
    await q("UPDATE users SET is_moderator=false WHERE id=$1", [mod]);
    expect((await call(queue.GET, "GET", "/x")).r.status).toBe(403);
    await q("UPDATE users SET is_moderator=true WHERE id=$1", [mod]);
    testDb().failOn((sql) => (/is_moderator FROM users/.test(sql) ? Object.assign(new Error('column "is_moderator" does not exist'), { code: "42703" }) : undefined));
    expect((await call(queue.GET, "GET", "/x")).r.status).toBe(403);
    as(admin); expect((await call(queue.GET, "GET", "/x")).r.status).toBe(200);
    testDb().failOn((sql) => (/FROM users WHERE id/.test(sql) ? new Error("down") : undefined));
    expect((await call(queue.GET, "GET", "/x")).r.status).toBe(403); // any other error: no access
    expect(await reviewerOf(testDb().raw as never, 0)).toEqual({ ok: false });
  });
});

describe("the queue", () => {
  it("lists only submitted items, pending first and oldest first; never drafts or demo items; no text or contact", async () => {
    const a = await user("ST"), admin = await user("admin"); as(admin);
    const newer = await make(a, "pending_review", { title: "Newer pending item" });
    const older = await make(a, "pending_review", { title: "Older pending item" });
    await q("UPDATE contributions SET submitted_at = now() - interval '2 days' WHERE id=$1", [older]);
    await make(a, "draft", { title: "Secret draft item" }); await make(a, "pending_review", { title: "Demo item", demo: true }); await make(a, "published", { title: "Already published" });
    await q("INSERT INTO contribution_contacts (contribution_id, contact_name, email, share_with_moderators) VALUES ($1,'Hidden Name','hidden@example.com',true)", [newer]);
    const x = await call(queue.GET, "GET", "/api/admin/moderation/queue");
    expect(x.b.items.map((i: any) => i.title)).toEqual(["Older pending item", "Newer pending item"]);
    expect(JSON.stringify(x.b)).not.toMatch(/Hidden Name|hidden@example|milked|Secret draft|email|password/i);
    expect(x.r.headers.get("cache-control")).toBe("no-store");
  });
  it("?status= shows another group, and anything unknown (including drafts) falls back to pending", async () => {
    const a = await user("ST"); as(await user("admin"));
    await make(a, "published", { title: "A published one" }); await make(a, "pending_review", { title: "A pending one" }); await make(a, "draft", { title: "A draft one" });
    expect((await call(queue.GET, "GET", "/api/admin/moderation/queue?status=published")).b.items.map((i: any) => i.title)).toEqual(["A published one"]);
    for (const s of ["draft", "nonsense", "pending_review' OR 1=1 --", ""]) expect((await call(queue.GET, "GET", "/api/admin/moderation/queue?status=" + encodeURIComponent(s))).b.items.map((i: any) => i.title)).toEqual(["A pending one"]);
  });
  it("answers 503 when the tables are missing and a plain 500 otherwise", async () => {
    as(await user("admin"));
    testDb().failOn((sql) => (/FROM contributions c WHERE c\.status/.test(sql) ? Object.assign(new Error("x"), { code: "42P01" }) : undefined));
    expect((await call(queue.GET, "GET", "/x")).r.status).toBe(503);
    testDb().failOn((sql) => (/FROM contributions c WHERE c\.status/.test(sql) ? new Error("password=hunter2") : undefined));
    const e = await call(queue.GET, "GET", "/x"); expect(e.r.status).toBe(500); expect(JSON.stringify(e.b)).not.toMatch(/hunter2/);
  });
});

describe("reading one item", () => {
  it("shows the text, the sections, the photos' descriptions and the audit trail; a draft is 404", async () => {
    const a = await user("ST"); as(await user("admin"));
    const id = await make(a, "pending_review"); const d = await make(a, "draft");
    await addPhoto(testPool() as never, id, { mime: "image/jpeg", bytes: JPEG, alt: "A cow shed", sha256: createHash("sha256").update(JPEG).digest("hex") });
    const x = await call(detail.GET, "GET", "/x", undefined, P(id));
    expect(x.b.item).toMatchObject({ id, status: "pending_review", description: "Cows are milked by hand.", role: "Farmer", district: "Guntur", authorLabel: `Member #${a}`, own: false, actions: ["approve", "request_changes", "reject"], history: [] });
    expect(x.b.item.photoList).toMatchObject([{ alt: "A cow shed", mime: "image/jpeg" }]);
    expect(JSON.stringify(x.b)).not.toMatch(/@example\.com|full_name|password/i);
    expect((await call(detail.GET, "GET", "/x", undefined, P(d))).r.status).toBe(404);
    expect((await call(detail.GET, "GET", "/x", undefined, P("abc"))).r.status).toBe(404);
  });
  it("contact details only when the author allowed it AND the reviewer is a flagged moderator (an administrator without the flag sees none)", async () => {
    const a = await user("ST"), mod = await user("TC", true), admin = await user("admin");
    const shared = await make(a, "pending_review"), priv = await make(a, "pending_review");
    await q("INSERT INTO contribution_contacts (contribution_id, contact_name, email, share_with_moderators) VALUES ($1,'Asha Shared','asha@example.com',true),($2,'Bela Private','bela@example.com',false)", [shared, priv]);
    as(mod);
    expect((await call(detail.GET, "GET", "/x", undefined, P(shared))).b.item.contact).toMatchObject({ name: "Asha Shared", email: "asha@example.com" });
    expect((await call(detail.GET, "GET", "/x", undefined, P(priv))).b.item.contact).toBeNull();
    as(admin);
    expect((await call(detail.GET, "GET", "/x", undefined, P(shared))).b.item.contact).toBeNull();
    expect(JSON.stringify((await call(detail.GET, "GET", "/x", undefined, P(priv))).b)).not.toMatch(/Bela|bela@/);
  });
  it("your own item is shown but offers no decisions", async () => {
    const mod = await user("TC", true); const id = await make(mod, "pending_review"); as(mod);
    const x = await call(detail.GET, "GET", "/x", undefined, P(id));
    expect(x.b.item).toMatchObject({ own: true, actions: [] });
  });
  it("shows earlier decisions, newest first", async () => {
    const a = await user("ST"), admin = await user("admin"); as(admin);
    const id = await make(a, "pending_review");
    await decide(id, "request_changes", "Add the district please."); await q("UPDATE contributions SET status='pending_review' WHERE id=$1", [id]); await decide(id, "approve");
    const h = (await call(detail.GET, "GET", "/x", undefined, P(id))).b.item.history;
    expect(h.map((x: any) => x.action)).toEqual(["approve", "request_changes"]);
    expect(h[1].note).toBe("Add the district please."); expect(h[0].by).toBe(`Reviewer #${admin}`);
  });
});

describe("decisions", () => {
  it("approve publishes (and the hub number goes up); the author sees it in their list", async () => {
    const a = await user("ST"), admin = await user("admin"); const id = await make(a, "pending_review"); as(admin);
    const count = async () => ((await (await (sectors.GET as Fn)(new Request("http://localhost/x", { headers: { "x-forwarded-for": ip() } }))).json()).sectors.find((s: any) => s.slug === "agriculture-dairy")).contributions;
    expect(await count()).toBe(0);
    const x = await decide(id, "approve");
    expect(x.r.status).toBe(200); expect(x.b).toMatchObject({ success: true, status: "published", action: "approve" });
    expect(await count()).toBe(1);
    expect(((await q("SELECT published_at FROM contributions WHERE id=$1", [id])).rows[0] as any).published_at).not.toBeNull();
    as(a); expect((await call(mine.GET, "GET", "/x")).b.items[0]).toMatchObject({ status: "published" });
  });
  it("request changes and reject need a note and the author reads it; reject is final", async () => {
    const a = await user("ST"), admin = await user("admin"); as(admin);
    const c = await make(a, "pending_review"), r = await make(a, "pending_review");
    for (const act of ["request_changes", "reject"]) for (const bad of [undefined, "", "  ", "ab"]) {
      const x = await decide(c, act, bad); expect(x.r.status).toBe(400); expect(x.b.fieldErrors.note).toMatch(/note/i);
    }
    expect(await status(c)).toBe("pending_review");
    expect((await decide(c, "request_changes", "Please add the district and a cost.")).b.status).toBe("changes_requested");
    expect((await decide(r, "reject", "This reads as an advert.")).b.status).toBe("rejected");
    as(a); const items = Object.fromEntries((await call(mine.GET, "GET", "/x")).b.items.map((i: any) => [i.id, i]));
    expect(items[c]).toMatchObject({ status: "changes_requested", note: "Please add the district and a cost." });
    expect(items[r]).toMatchObject({ status: "rejected", note: "This reads as an advert.", canEdit: false });
    as(admin); expect((await decide(r, "approve")).r.status).toBe(409); expect(await status(r)).toBe("rejected");
  });
  it("unpublish needs a note and takes it out of the public count; republish puts it back", async () => {
    const a = await user("ST"), admin = await user("admin"); as(admin); const id = await make(a, "published");
    const count = async () => ((await (await (sectors.GET as Fn)(new Request("http://localhost/x", { headers: { "x-forwarded-for": ip() } }))).json()).sectors.find((s: any) => s.slug === "agriculture-dairy")).contributions;
    expect(await count()).toBe(1);
    expect((await decide(id, "unpublish", "")).r.status).toBe(400);
    expect((await decide(id, "unpublish", "Contains a private phone number.")).b.status).toBe("unpublished");
    expect(await count()).toBe(0);
    expect(((await q("SELECT published_at FROM contributions WHERE id=$1", [id])).rows[0] as any).published_at).toBeNull();
    expect((await decide(id, "republish")).b.status).toBe("published"); expect(await count()).toBe(1);
  });
  it("only the right moves: approve needs pending, unpublish needs published, republish needs unpublished (409 with a plain message)", async () => {
    const a = await user("ST"), admin = await user("admin"); as(admin);
    const cases: [string, string, string][] = [["approve", "published", "x"], ["approve", "draft-skip", "x"], ["request_changes", "changes_requested", "Needs more detail."], ["unpublish", "pending_review", "Not live yet."], ["republish", "published", "x"], ["reject", "published", "No longer wanted."]];
    for (const [act, st, note] of cases) {
      if (st === "draft-skip") continue;
      const id = await make(a, st); const x = await decide(id, act, note);
      expect(x.r.status, `${act} on ${st}`).toBe(409); expect(x.b.error).toBe("WRONG_STATUS"); expect(x.b.message).toMatch(/Reload the page/); expect(await status(id)).toBe(st);
    }
    const d = await make(a, "draft"); expect((await decide(d, "approve")).r.status).toBe(404); expect(await status(d)).toBe("draft");
  });
  it("nobody can review their own item (403) and nothing changes, not even for an administrator", async () => {
    const mod = await user("TC", true), admin = await user("admin"); const m = await make(mod, "pending_review"), ad = await make(admin, "pending_review");
    as(mod); const x = await decide(m, "approve"); expect(x.r.status).toBe(403); expect(x.b.error).toBe("OWN_ITEM");
    as(admin); expect((await decide(ad, "reject", "I do not want this.")).r.status).toBe(403);
    expect(await status(m)).toBe("pending_review"); expect(await status(ad)).toBe("pending_review");
    expect(await reviews(m)).toEqual([]);
    as(admin); expect((await decide(m, "approve")).r.status).toBe(200); // another reviewer can
  });
  it("every decision writes exactly one append-only audit row with who, what and the note; a second decision is a 409 and adds no row", async () => {
    const a = await user("ST"), admin = await user("admin"), mod = await user("TC", true); const id = await make(a, "pending_review");
    as(admin); await decide(id, "approve", "Looks good.");
    as(mod); expect((await decide(id, "approve")).r.status).toBe(409);
    await decide(id, "unpublish", "Needs a second look.");
    expect(await reviews(id)).toEqual([{ reviewer_id: String(admin), action: "approve", note: "Looks good." }, { reviewer_id: String(mod), action: "unpublish", note: "Needs a second look." }]);
    await expect(q("UPDATE contribution_reviews SET note='x' WHERE contribution_id=$1", [id])).rejects.toThrow(/never changed or deleted/);
    await expect(q("DELETE FROM contribution_reviews WHERE contribution_id=$1", [id])).rejects.toThrow(/never changed or deleted/);
  });
  it("an edited published item goes back to the queue, and approving it again publishes it", async () => {
    const a = await user("ST"), admin = await user("admin"); const id = await make(a, "published");
    await q("UPDATE contributions SET status='pending_review', published_at=NULL WHERE id=$1", [id]); // what the author's edit does
    as(admin); expect((await call(queue.GET, "GET", "/x")).b.items.map((i: any) => i.id)).toContain(id);
    expect((await decide(id, "approve")).b.status).toBe("published");
  });
  it("validation: unknown action, bad note type, control characters, over-long note, odd bodies", async () => {
    const a = await user("ST"); as(await user("admin")); const id = await make(a, "pending_review");
    expect((await decide(id, "delete")).b.fieldErrors.action).toBeTruthy();
    expect((await decide(id, undefined)).r.status).toBe(400);
    expect((await decide(id, "approve", 5)).b.fieldErrors.note).toBeTruthy();
    expect((await decide(id, "reject", "bad\u0007note here")).b.fieldErrors.note).toMatch(/not allowed/);
    expect((await decide(id, "reject", "x".repeat(1001))).b.fieldErrors.note).toMatch(/1000/);
    expect((await call(decision.POST, "POST", "/x", [1], P(id))).r.status).toBe(400);
    expect((await call(decision.POST, "POST", "/x", "oops", P(id))).r.status).toBe(400);
    expect((await call(decision.POST, "POST", "/x", { action: "approve", note: "n".repeat(10 * 1024) }, P(id))).r.status).toBe(413);
    expect((await call(decision.POST, "POST", "/x", { action: "approve" }, P("abc"))).r.status).toBe(404);
    expect(await status(id)).toBe("pending_review");
    expect(checkDecision("approve", null)).toMatchObject({ ok: true, note: null });
    expect(Object.keys(ACTIONS)).toEqual(["approve", "request_changes", "reject", "unpublish", "republish"]);
  });
  it("no audit row, no decision: if the audit write fails the status does not change", async () => {
    const a = await user("ST"); as(await user("admin")); const id = await make(a, "pending_review");
    testDb().failOn((sql) => (/INSERT INTO contribution_reviews/.test(sql) ? new Error("disk full") : undefined));
    const x = await decide(id, "approve"); expect(x.r.status).toBe(500); expect(JSON.stringify(x.b)).not.toMatch(/disk full/);
    testDb().failOn(undefined);
    expect(await status(id)).toBe("pending_review"); expect(await reviews(id)).toEqual([]);
  });
  it("without migration 017 the answer is 503 NOT_SET_UP and nothing changes (no 500, no half decision)", async () => {
    const a = await user("ST"); as(await user("admin")); const id = await make(a, "pending_review");
    testDb().failOn((sql) => (/INSERT INTO contribution_reviews/.test(sql) ? Object.assign(new Error('relation "contribution_reviews" does not exist'), { code: "42P01" }) : undefined));
    const x = await decide(id, "approve"); expect(x.r.status).toBe(503); expect(x.b.error).toBe("NOT_SET_UP");
    testDb().failOn((sql) => (/UPDATE contributions SET status/.test(sql) ? Object.assign(new Error('violates check constraint "contributions_status_ck"'), { code: "23514", constraint: "contributions_status_ck" }) : undefined));
    expect((await decide(id, "reject", "Not a fit for the site.")).r.status).toBe(503);
    testDb().failOn(undefined);
    expect(await status(id)).toBe("pending_review");
  });
});

describe("photos for reviewers", () => {
  it("serves the image bytes safely for a submitted item, and refuses drafts, mismatches, members and bad ids", async () => {
    const a = await user("ST"), admin = await user("admin"), member = await user("ST");
    const id = await make(a, "pending_review"), other = await make(a, "pending_review"), draft = await make(a, "draft");
    const add = (cid: number) => addPhoto(testPool() as never, cid, { mime: "image/jpeg", bytes: JPEG, alt: "A cow shed", sha256: createHash("sha256").update(JPEG).digest("hex") });
    const pid = await add(id), draftPhoto = await add(draft);
    as(admin);
    const ok = await call(photo.GET, "GET", "/x", undefined, P(id, pid));
    expect(ok.r.status).toBe(200);
    expect(ok.r.headers.get("content-type")).toBe("image/jpeg");
    expect(ok.r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(ok.r.headers.get("cache-control")).toBe("private, no-store");
    expect(ok.r.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect((await call(photo.GET, "GET", "/x", undefined, P(other, pid))).r.status).toBe(404); // the photo belongs to another item
    expect((await call(photo.GET, "GET", "/x", undefined, P(draft, draftPhoto))).r.status).toBe(404); // drafts are private
    expect((await call(photo.GET, "GET", "/x", undefined, P(id, "x"))).r.status).toBe(404);
    as(member); expect((await call(photo.GET, "GET", "/x", undefined, P(id, pid))).r.status).toBe(403);
  });
});

describe("rate limits", () => {
  it("per reviewer: the 31st decision in a minute is a 429 with Retry-After; another reviewer is unaffected", async () => {
    const a = await user("ST"), r1 = await user("admin"), r2 = await user("admin"); as(r1);
    const id = await make(a, "pending_review");
    for (let i = 0; i < SERVICE_RATE_LIMITS.modDecision; i++) expect((await decide(id, "approve")).r.status).not.toBe(429);
    const x = await decide(id, "approve");
    expect(x.r.status).toBe(429); expect(x.r.headers.get("retry-after")).toMatch(/^\d+$/); expect(x.r.headers.get("cache-control")).toBe("no-store");
    as(r2); expect((await decide(id, "approve")).r.status).not.toBe(429);
  });
  it("per visitor address, and the kill switch turns both off", async () => {
    const admin = await user("admin"); as(admin);
    for (let i = 0; i < SERVICE_RATE_LIMITS.modIp; i++) await call(queue.GET, "GET", "/x", undefined, undefined, { "x-forwarded-for": "30.1.1.1" });
    expect((await call(queue.GET, "GET", "/x", undefined, undefined, { "x-forwarded-for": "30.1.1.1" })).r.status).toBe(429);
    vi.stubEnv("SERVICE_RATE_LIMIT_ENABLED", "false");
    expect((await call(queue.GET, "GET", "/x", undefined, undefined, { "x-forwarded-for": "30.1.1.1" })).r.status).toBe(200);
  });
});
