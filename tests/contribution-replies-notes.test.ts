// Replies to the contributor and internal notes (portal PR1, migration 019): reviewers only, never on their own item, saved with who and
// when; the member reads replies (whatever the status) and never notes; opening an item records the view; the reply email is OFF by
// default. In-process database with the real migrations and the real routes; no real database, no real email.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
const who: { id: string | null } = { id: null };
vi.mock("../src/lib/currentUser", () => ({
  getCurrentUser: async () => (who.id ? { id: who.id, fullName: "Someone", email: "s@example.com", role: "ST" } : null),
  firstNameOf: () => "Someone",
}));
const sent: { to: string; title: string }[] = [];
const emailFails = { on: false };
vi.mock("../src/lib/email", async (orig) => ({
  ...(await orig<typeof import("../src/lib/email")>()),
  sendReplyNoticeEmail: async (to: string, title: string) => { if (emailFails.on) throw new Error("send failed"); sent.push({ to, title }); },
}));

import * as replyRoute from "../src/app/api/review/[id]/reply/route";
import * as noteRoute from "../src/app/api/review/[id]/note/route";
import * as detail from "../src/app/api/review/[id]/route";
import * as mineRoute from "../src/app/api/contributions/mine/route";
import * as ownRoute from "../src/app/api/contributions/[id]/route";

const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
let seq = 0, ipn = 0;
const ip = () => `31.${Math.floor(++ipn / 250)}.${ipn % 250}.1`;
async function user(role: string, moderator = false) { const u = await seedUser({ email: `r${++seq}@example.com`, role, fullName: `Person${seq} Surname` }); if (moderator) await q("UPDATE users SET is_moderator = true WHERE id = $1", [u.id]); return Number(u.id); }
async function make(userId: number, status: string, title: string) {
  const id = Number(((await q("INSERT INTO contributions (user_id, type, title, body) VALUES ($1,'problem',$2,$3) RETURNING id", [userId, title, `Body for ${title} ${++seq}, long enough.`])).rows[0] as any).id);
  await q("INSERT INTO contribution_scopes (contribution_id, sector_id) SELECT $1, id FROM sectors WHERE slug='agriculture-dairy'", [id]);
  if (status !== "draft") await q("UPDATE contributions SET status=$2::varchar, submitted_at=now(), published_at=CASE WHEN $2::varchar='published' THEN now() END WHERE id=$1", [id, status]);
  return id;
}
const as = (id: number | null) => { who.id = id === null ? null : String(id); };
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const send = async (route: typeof replyRoute | typeof noteRoute, id: number | string, body: unknown) => {
  const r = await route.POST(new Request("http://localhost/x", { method: "POST", headers: { "x-forwarded-for": ip(), "content-type": "application/json" }, body: JSON.stringify(body) }), ctx(id));
  return { r, b: await r.json() };
};
const mine = async () => (await (await mineRoute.GET(new Request("http://localhost/x", { headers: { "x-forwarded-for": ip() } }))).json());
const review = async (id: number) => { const r = await detail.GET(new Request("http://localhost/x", { headers: { "x-forwarded-for": ip() } }), ctx(id)); return { r, b: await r.json() }; };

beforeEach(async () => { vi.spyOn(console, "error").mockImplementation(() => undefined); who.id = null; sent.length = 0; emailFails.on = false; await q("DELETE FROM api_rate_limits"); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("replies", () => {
  it("a moderator and an administrator can reply; each reply is saved with who and when, and the member reads them all", async () => {
    const mod = await user("TC", true), admin = await user("admin"), author = await user("ST");
    const id = await make(author, "pending_review", "Weekend robotics club");
    as(mod);
    const a = await send(replyRoute, id, { message: "  Thanks! Could you add a photo of the robots?  " });
    expect(a.r.status).toBe(201); expect(a.b.success).toBe(true); expect(a.b.emailed).toBe(false);
    as(admin);
    expect((await send(replyRoute, id, { message: "Also, which district is it in?" })).r.status).toBe(201);
    const rows = (await q("SELECT author_id, message, created_at FROM contribution_replies WHERE contribution_id=$1 ORDER BY id", [id])).rows as any[];
    expect(rows.map((r) => [Number(r.author_id), r.message])).toEqual([[mod, "Thanks! Could you add a photo of the robots?"], [admin, "Also, which district is it in?"]]);
    as(author);
    const m = await mine();
    const it0 = m.items.find((x: any) => x.id === id);
    expect(it0.replies.map((x: any) => x.message)).toEqual(["Thanks! Could you add a photo of the robots?", "Also, which district is it in?"]);
    expect(it0.statusLabel).toBe("Replied");
    expect(it0.status).toBe("pending_review"); // the stored status did not change
  });
  it("the member sees replies whatever the status (published, not accepted, unpublished)", async () => {
    const mod = await user("TC", true), author = await user("ST");
    const ids = [await make(author, "published", "Published item here"), await make(author, "rejected", "Rejected item here"), await make(author, "unpublished", "Unpublished item here")];
    as(mod);
    for (const id of ids) expect((await send(replyRoute, id, { message: `A reply about item ${id}` })).r.status).toBe(201);
    as(author);
    const m = await mine();
    for (const id of ids) expect(m.items.find((x: any) => x.id === id).replies[0].message).toBe(`A reply about item ${id}`);
    expect(m.items.find((x: any) => x.id === ids[2]).statusLabel).toBe("Unpublished");
  });
  it("is refused for members (403), signed-out visitors (401), your own item (403 OWN_ITEM), drafts and unknown items (404)", async () => {
    const mod = await user("TC", true), member = await user("ST");
    const other = await make(member, "pending_review", "Someone else's item");
    const own = await make(mod, "pending_review", "The moderator's own item");
    const draft = await make(member, "draft", "A draft nobody reviews");
    as(member);
    expect((await send(replyRoute, other, { message: "I am not a reviewer" })).r.status).toBe(403);
    as(null);
    expect((await send(replyRoute, other, { message: "Nobody signed in" })).r.status).toBe(401);
    as(mod);
    const o = await send(replyRoute, own, { message: "Replying to myself" });
    expect(o.r.status).toBe(403); expect(o.b.error).toBe("OWN_ITEM");
    expect((await send(replyRoute, draft, { message: "A draft is invisible" })).r.status).toBe(404);
    expect((await send(replyRoute, 999999, { message: "No such item" })).r.status).toBe(404);
    expect((await send(replyRoute, "abc", { message: "Bad id" })).r.status).toBe(404);
    expect(Number(((await q("SELECT count(*)::int n FROM contribution_replies")).rows[0] as any).n)).toBe(0);
  });
  it("checks the text: 3 to 2000 characters, no control characters", async () => {
    const mod = await user("TC", true), author = await user("ST");
    const id = await make(author, "pending_review", "Validation target");
    as(mod);
    for (const message of [undefined, 12, "  a ", "x".repeat(2001), "bad\u0007bell"]) {
      const x = await send(replyRoute, id, { message });
      expect(x.r.status, String(message)).toBe(400); expect(x.b.fieldErrors.message).toBeTruthy();
    }
    expect((await send(replyRoute, id, { message: "Line one\nLine two" })).r.status).toBe(201);
  });
  it("the email is OFF by default; with CONTRIBUTION_REPLY_EMAIL=true it goes to the author (title only) and is marked sent; a failed email keeps the reply", async () => {
    const mod = await user("TC", true), author = await user("ST");
    const id = await make(author, "pending_review", "Email me about this");
    as(mod);
    await send(replyRoute, id, { message: "First reply, no email" });
    expect(sent).toEqual([]);
    vi.stubEnv("CONTRIBUTION_REPLY_EMAIL", "true");
    const x = await send(replyRoute, id, { message: "Second reply, with email" });
    expect(x.b.emailed).toBe(true);
    expect(sent).toEqual([{ to: `r${seq - 1}@example.com`, title: "Email me about this" }]);
    emailFails.on = true;
    const y = await send(replyRoute, id, { message: "Third reply, email fails" });
    expect(y.r.status).toBe(201); expect(y.b.emailed).toBe(false);
    const rows = (await q("SELECT message, email_sent_at FROM contribution_replies WHERE contribution_id=$1 ORDER BY id", [id])).rows as any[];
    expect(rows.map((r) => [r.message, r.email_sent_at !== null])).toEqual([["First reply, no email", false], ["Second reply, with email", true], ["Third reply, email fails", false]]);
  });
});

describe("internal notes", () => {
  it("reviewers add notes with who and when; reviewers see them; the member never does (My Contributions, own item)", async () => {
    const mod = await user("TC", true), author = await user("ST");
    const id = await make(author, "pending_review", "Note target item");
    as(mod);
    const n = await send(noteRoute, id, { note: "SECRET-NOTE: checked the website, it is real." });
    expect(n.r.status).toBe(201);
    const d = await review(id);
    expect(d.b.item.notes.map((x: any) => x.text)).toEqual(["SECRET-NOTE: checked the website, it is real."]);
    expect(d.b.item.notes[0].by).toMatch(/^Person\d+$/); // first name only
    as(author);
    expect(JSON.stringify(await mine())).not.toContain("SECRET-NOTE");
    const own = await (await ownRoute.GET(new Request("http://localhost/x", { headers: { "x-forwarded-for": ip() } }), ctx(id))).json();
    expect(own.success).toBe(true);
    expect(JSON.stringify(own)).not.toContain("SECRET-NOTE");
  });
  it("is refused for members and on your own item, and checks the text (3 to 1000)", async () => {
    const mod = await user("TC", true), member = await user("ST");
    const id = await make(member, "pending_review", "Another note target");
    const own = await make(mod, "pending_review", "Moderator's own note target");
    as(member);
    expect((await send(noteRoute, id, { note: "Members cannot" })).r.status).toBe(403);
    as(mod);
    expect((await send(noteRoute, own, { note: "My own item" })).b.error).toBe("OWN_ITEM");
    expect((await send(noteRoute, id, { note: "no" })).r.status).toBe(400);
    expect((await send(noteRoute, id, { note: "x".repeat(1001) })).r.status).toBe(400);
  });
});

describe("opening an item", () => {
  it("records the view (first and last), shows In review, and never records your own item", async () => {
    const mod = await user("TC", true), author = await user("ST");
    const id = await make(author, "pending_review", "Open me please");
    const own = await make(mod, "pending_review", "My own item to open");
    as(author);
    expect((await mine()).items.find((x: any) => x.id === id).statusLabel).toBe("Pending review");
    as(mod);
    const first = await review(id);
    expect(first.b.item.displayLabel).toBe("In review");
    await review(id);
    const v = (await q("SELECT viewer_id, first_viewed_at, last_viewed_at FROM contribution_views WHERE contribution_id=$1", [id])).rows as any[];
    expect(v.length).toBe(1); expect(Number(v[0].viewer_id)).toBe(mod);
    expect(new Date(v[0].last_viewed_at).getTime()).toBeGreaterThanOrEqual(new Date(v[0].first_viewed_at).getTime());
    await review(own);
    expect(Number(((await q("SELECT count(*)::int n FROM contribution_views WHERE contribution_id=$1", [own])).rows[0] as any).n)).toBe(0);
    as(author);
    expect((await mine()).items.find((x: any) => x.id === id).statusLabel).toBe("Pending review"); // members never see "In review"
  });
  it("every action is in the work log with who, what and when", async () => {
    const mod = await user("TC", true), author = await user("ST");
    const id = await make(author, "pending_review", "Logged item here");
    as(mod);
    await review(id);
    await send(replyRoute, id, { message: "A reply for the log" });
    await send(noteRoute, id, { note: "A note for the log" });
    const log = (await q("SELECT actor_id, action, contribution_id FROM contribution_work_log WHERE contribution_id=$1 ORDER BY action", [id])).rows as any[];
    expect(log.map((r) => [Number(r.actor_id), r.action, Number(r.contribution_id)])).toEqual([[mod, "note", id], [mod, "reply", id], [mod, "view", id]]);
  });
});
