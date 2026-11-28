// Contribution workflow: the spec's open points (section 15) as the owner decided them on 27-11-2026, on a real (in-process) database.
//   * Unpublish: Admin only, from Published; the card is removed; status Unpublished (in the Admin's "Published" filter); history.
//     Publishing again is the normal flow (preview, then publish) and updates the same card: never a duplicate.
//   * Edit after publishing: Edit Before Publishing on Published or Unpublished items makes a new version that needs a new preview;
//     the live card changes only when the Admin publishes again.
//   * After Rejected: no appeal by contributors; an Admin may Reopen (reason required) -> Under Moderator Review, with history.
//   * A Moderator's decline is visible to Admins in the Rejected filter (who, why, when) and reversible with Reopen.
//   * Earn (18+): refused for a minor's idea in the form's submission, in the Moderator's version and at the Admin's preview/publish.
//   * Admin edits: Title and Description only.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";
import { applyFile } from "../scripts/migrate.mjs";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
const who: { id: string | null; role: string } = { id: null, role: "ST" };
vi.mock("../src/lib/currentUser", () => ({
  getCurrentUser: async () => (who.id ? { id: who.id, fullName: "x", email: "x@example.com", role: who.role } : null),
  firstNameOf: () => "X",
}));

import * as submitRoute from "../src/app/api/cw/contributions/route";
import * as listRoute from "../src/app/api/cw/review/route";
import * as itemRoute from "../src/app/api/cw/review/[id]/route";
import * as publicRoute from "../src/app/api/cw/public/route";
import * as meRoute from "../src/app/api/cw/me/route";
import { buildNotices } from "../src/lib/cw/notify";
import { MESSAGES } from "../public/cw/js/lists.js";
import { history as H } from "../public/cw/js/rules.js";

const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
let n = 0;
const ip = () => `44.${Math.floor(++n / 250) % 250}.${n % 250}.1`;
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
type U = { id: string; role: string };
const as = (u: U) => { who.id = u.id; who.role = u.role; };
let member: U, minor: U, mod: U, admin: U, modEmail = "";

async function submitAs(u: U, over: Record<string, unknown> = {}) {
  as(u);
  const fd = new FormData();
  fd.append("data", JSON.stringify({ kind: "New idea", refers: false, title: `Robot idea ${++n}`, description: "A small robot that helps the school garden every day.", sector: "healthcare", robotType: "not-sure", categories: ["Robotics"], suitableFor: ["K9–K10"], learningPath: "Make", references: [], resource: {}, ...over }));
  const r = await submitRoute.POST(new Request("http://localhost/api/cw/contributions", { method: "POST", body: fd, headers: { "x-forwarded-for": ip() } }));
  return { status: r.status, b: (await r.json()) as any };
}
const submit = async (over: Record<string, unknown> = {}) => Number((await submitAs(member, over)).b.id);
const detail = async (id: number) => ((await (await itemRoute.GET(new Request("http://localhost/x", { headers: { "x-forwarded-for": ip() } }), ctx(id))).json()) as any).item;
const act = async (id: number, action: string, body: Record<string, unknown> = {}) => {
  const r = await itemRoute.POST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify({ action, ...body }) }), ctx(id));
  return { status: r.status, b: (await r.json()) as any };
};
const step = async (id: number, action: string, extra: Record<string, unknown> = {}) => { const it = await detail(id); return act(id, action, { rowVersion: it.rowVersion, proposed: it.proposed, notes: it.notes, version: it.versions.length, ...extra }); };
const list = async (filter: string) => ((await (await listRoute.GET(new Request(`http://localhost/api/cw/review?view=approvals&filter=${encodeURIComponent(filter)}`, { headers: { "x-forwarded-for": ip() } }))).json()) as any).items;
const publicItems = async () => ((await (await publicRoute.GET(new Request("http://localhost/api/cw/public", { headers: { "x-forwarded-for": ip() } }))).json()) as any).items;
const cards = async (id?: number) => Number(((await q(`SELECT count(*)::int n FROM cw_public_contributions${id ? " WHERE contribution_id = $1" : ""}`, id ? [id] : [])).rows[0] as any).n);
/** submitted by the member, sent to Admin unchanged by the moderator; the Admin is signed in */
async function pending(over: Record<string, unknown> = {}) { const id = await submit(over); as(mod); await step(id, "send_request"); as(admin); return id; }
/** ... and previewed and published by the Admin */
async function published(over: Record<string, unknown> = {}) {
  const id = await pending(over);
  await step(id, "preview");
  expect((await step(id, "publish")).b.item.status).toBe("published");
  return id;
}

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await q("DELETE FROM api_rate_limits");
  await q("INSERT INTO sectors (slug, name, sort_order) VALUES ('healthcare','Healthcare',30) ON CONFLICT DO NOTHING");
  const m = await seedUser({ email: `m${++n}@example.com`, role: "PA", fullName: "Meera Kumar Rao" });
  member = { id: m.id, role: "PA" };
  const k = await seedUser({ email: `kid${n}@example.com`, role: "ST", fullName: "Neha Sharma", ageCategory: "minor" });
  minor = { id: k.id, role: "ST" };
  const md = await seedUser({ email: `mod${n}@example.com`, role: "TC", fullName: "Priya Moderator" });
  modEmail = md.email;
  await q("UPDATE users SET is_moderator = true WHERE id = $1", [md.id]);
  mod = { id: md.id, role: "TC" };
  const a = await seedUser({ email: `adm${n}@example.com`, role: "admin", fullName: "Arun Admin" });
  admin = { id: a.id, role: "admin" };
});
afterEach(() => { vi.restoreAllMocks(); });

describe("Unpublish (Admin only, from Published)", () => {
  it("removes the card, sets Unpublished and logs it; listed under Published with its own status; a Moderator gets 403; only from Published", async () => {
    const id = await published();
    const other = await pending();
    expect(await cards(id)).toBe(1);
    as(mod);
    expect((await step(id, "unpublish")).status).toBe(403);
    as(admin);
    expect((await step(other, "unpublish")).b).toMatchObject({ error: "NOT_ALLOWED" }); // a request is not published
    const r = await step(id, "unpublish");
    expect(r.status).toBe(200);
    expect(r.b.message).toBe(MESSAGES.unpublished);
    expect(r.b.item).toMatchObject({ status: "unpublished", statusLabel: "Unpublished", previewedVersion: null, publishedVersion: 1 });
    expect(r.b.item.history.at(-1)).toMatchObject({ actor: "Arun Admin", text: H.unpublished() });
    expect(await cards(id)).toBe(0);
    expect((await publicItems()).map((x: any) => x.id)).not.toContain(id);
    expect((await list("Published")).find((x: any) => x.id === id)).toMatchObject({ status: "unpublished", statusLabel: "Unpublished" });
    expect((await step(id, "unpublish")).b).toMatchObject({ error: "NOT_ALLOWED" }); // already unpublished
  });
  it("publishing again is the normal flow: preview first, then the same card comes back (never a duplicate)", async () => {
    const id = await published();
    await step(id, "unpublish");
    expect((await step(id, "publish")).b).toMatchObject({ error: "PREVIEW_FIRST", message: MESSAGES.previewFirst });
    await step(id, "preview");
    const r = await step(id, "publish");
    expect(r.b.item).toMatchObject({ status: "published", publishedVersion: 1, publishError: null });
    expect(await cards(id)).toBe(1);
    await step(id, "unpublish"); await step(id, "preview"); await step(id, "publish"); // and once more
    expect(await cards(id)).toBe(1);
    expect(await cards()).toBe(1);
  });
});

describe("Edit after publishing", () => {
  it("on a Published item: a new version that needs a new preview; the live card changes only when published again", async () => {
    const id = await published();
    const before = (await publicItems()).find((x: any) => x.id === id);
    const e = await step(id, "admin_edit", { title: "A better title", description: "A small robot that helps the school garden every day." });
    expect(e.b.item).toMatchObject({ status: "published", previewedVersion: null, publishedVersion: 1 });
    expect(e.b.item.versions.map((v: any) => [v.v, v.role])).toEqual([[1, "Moderator"], [2, "Admin"]]);
    expect(e.b.item.history.at(-1).text).toBe(H.adminEditAfter(["Title"], 2));
    expect((await publicItems()).find((x: any) => x.id === id)).toEqual(before); // still the published version
    expect((await step(id, "publish")).b).toMatchObject({ error: "PREVIEW_FIRST" });
    await step(id, "preview");
    const p = await step(id, "publish");
    expect(p.b.item).toMatchObject({ status: "published", publishedVersion: 2 });
    expect((await publicItems()).find((x: any) => x.id === id).title).toBe("A better title");
    expect(await cards(id)).toBe(1);
    expect((await step(id, "publish")).b).toMatchObject({ error: "NOTHING_NEW", message: MESSAGES.nothingNew }); // nothing new now
    expect((await step(id, "preview")).b).toMatchObject({ error: "NOT_ALLOWED" });
  });
  it("on an Unpublished item too: the edit reaches the website only after preview and publish", async () => {
    const id = await published();
    await step(id, "unpublish");
    const e = await step(id, "admin_edit", { title: "Back with a new title", description: "A small robot that helps the school garden every day." });
    expect(e.b.item).toMatchObject({ status: "unpublished" });
    expect(await cards(id)).toBe(0);
    await step(id, "preview"); await step(id, "publish");
    expect((await publicItems()).filter((x: any) => x.id === id).map((x: any) => x.title)).toEqual(["Back with a new title"]);
  });
  it("an update stuck In Progress for over 2 minutes counts as timed out while the earlier card stays live (still Published); Retry publishes the new version", async () => {
    const id = await published();
    await step(id, "admin_edit", { title: "Second version", description: "A small robot that helps the school garden every day." });
    await step(id, "preview");
    await q("UPDATE cw_contributions SET status = 'publishing', updated_at = now() - interval '3 minutes' WHERE id = $1", [id]); // the server stopped mid-way
    const r = await step(id, "publish");
    expect(r.b.item).toMatchObject({ status: "published", publishedVersion: 2 });
    expect(r.b.item.history.map((h: any) => h.text)).toContain(H.failed("The website did not confirm the update within the time limit."));
    expect(await cards(id)).toBe(1);
  });
  it("Admin edits change Title and Description only: other fields sent with the edit are ignored", async () => {
    const id = await pending();
    const r = await step(id, "admin_edit", { title: "New title", description: "A new description that is long enough.", learningPath: "Earn (18+)", sector: "not-sure", categories: [] });
    const v = r.b.item.versions.at(-1).data;
    expect(v).toMatchObject({ title: "New title", description: "A new description that is long enough.", learningPath: "Make", sector: "healthcare", categories: ["Robotics"] });
  });
});

describe("After Rejected: no appeal; an Admin may Reopen (reason required)", () => {
  it("a Moderator's decline is shown to Admins in Rejected (who, why, when); Reopen needs a reason and sends it back to Under Moderator Review", async () => {
    const id = await submit(); as(mod);
    await step(id, "open");
    await step(id, "decline", { reason: "Looks like a duplicate." });
    as(admin);
    const rej = (await list("Rejected")).find((x: any) => x.id === id);
    expect(rej.decision).toMatchObject({ type: "decline", by: "Priya Moderator", text: "Looks like a duplicate." });
    expect(Date.parse(rej.decision.at)).toBeGreaterThan(0);
    as(mod);
    expect((await step(id, "reopen", { reason: "x" })).status).toBe(403); // Admin only
    as(admin);
    expect((await step(id, "reopen", { reason: "   " })).b).toMatchObject({ error: "VALIDATION_FAILED", message: MESSAGES.reasonRequired });
    const r = await step(id, "reopen", { reason: "Not a duplicate: please review again." });
    expect(r.b.item).toMatchObject({ status: "under_review", moderator: "Priya Moderator", previewedVersion: null });
    expect(r.b.item.feedback.at(-1)).toMatchObject({ type: "reopen", text: "Not a duplicate: please review again.", by: "Arun Admin" });
    expect(r.b.item.history.at(-1)).toMatchObject({ actor: "Arun Admin", text: H.reopened("Not a duplicate: please review again.") });
    expect((await step(id, "reopen", { reason: "again" })).b).toMatchObject({ error: "NOT_ALLOWED" }); // only from Rejected
    as(mod);
    expect((await step(id, "send_request")).b.item.status).toBe("pending"); // the Moderator works on it again (no version yet)
  });
  it("an Admin's own rejection shows as such and can be reopened too; the Moderator's next send is Resubmitted", async () => {
    const id = await pending();
    await step(id, "reject", { reason: "Not safe." });
    expect((await list("Rejected")).find((x: any) => x.id === id).decision).toMatchObject({ type: "reject", by: "Arun Admin", text: "Not safe." });
    await step(id, "reopen", { reason: "Safe after all." });
    as(mod);
    expect((await step(id, "send_request")).b.item.status).toBe("resubmitted");
  });
  it("Reopen is refused from every status but Rejected", async () => {
    const sub = await submit(), pen = await pending(), pub = await published();
    for (const id of [sub, pen, pub]) expect((await step(id, "reopen", { reason: "r" })).b, String(id)).toMatchObject({ error: "NOT_ALLOWED" });
  });
  it("contributors cannot appeal (no review action is theirs); they can always share a new idea", async () => {
    const id = await submit(); as(mod); await step(id, "open"); await step(id, "decline", { reason: "No." });
    as(member);
    expect((await act(id, "reopen", { reason: "Please look again", rowVersion: 1 })).status).toBe(403);
    expect((await submitAs(member, { title: "A new idea instead" })).status).toBe(201);
  });
  it("the Moderator is emailed when an idea is reopened", async () => {
    const id = await submit(); as(mod); await step(id, "open"); await step(id, "decline", { reason: "No." });
    as(admin); await step(id, "reopen", { reason: "Yes." });
    const mails = await buildNotices("reopened", id, testDb().pool as never, "https://app.example");
    expect(mails.map((m) => [m.to, m.subject])).toEqual([[modEmail, `RV-${id} reopened for review`]]);
    expect(mails[0].text).toContain("https://app.example/admin/workspace");
  });
});

describe("Earn (18+) is never allowed on a minor's idea", () => {
  it("the form's submission: refused for a minor with the clear message; accepted without Earn; an adult may choose Earn", async () => {
    const r = await submitAs(minor, { learningPath: "Earn (18+)" });
    expect([r.status, r.b.message]).toEqual([400, MESSAGES.earnMinor]);
    expect((await submitAs(minor, { learningPath: "Learn" })).status).toBe(201);
    expect((await submitAs(member, { learningPath: "Earn (18+)" })).status).toBe(201);
    as(minor);
    expect(((await (await meRoute.GET(new Request("http://localhost/api/cw/me", { headers: { "x-forwarded-for": ip() } }))).json()) as any).minor).toBe(true);
  });
  it("the Moderator cannot set it on a minor's idea (save draft, send, decline with edits), with the message; on an adult's idea it is fine", async () => {
    const kid = Number((await submitAs(minor, { learningPath: "Learn" })).b.id);
    as(mod);
    const it = await detail(kid);
    const earn = { ...it.proposed, learningPath: "Earn (18+)" };
    for (const action of ["save_draft", "send_request"]) expect((await act(kid, action, { rowVersion: it.rowVersion, proposed: earn })).b, action).toMatchObject({ error: "VALIDATION_FAILED", message: MESSAGES.earnMinorReview });
    expect((await act(kid, "decline", { rowVersion: it.rowVersion, proposed: earn, reason: "r" })).b).toMatchObject({ message: MESSAGES.earnMinorReview });
    expect(await detail(kid)).toMatchObject({ status: "submitted", rowVersion: it.rowVersion });
    const adult = await submit(); as(mod);
    const a = await detail(adult);
    expect((await act(adult, "send_request", { rowVersion: a.rowVersion, proposed: { ...a.proposed, learningPath: "Earn (18+)" } })).b.item.status).toBe("pending");
  });
  it("an Admin cannot preview or publish such a version (data from before the rule), with the message", async () => {
    const kid = Number((await submitAs(minor, { learningPath: "Learn" })).b.id);
    as(mod); await step(kid, "send_request");
    await q(`UPDATE cw_contributions SET proposed = jsonb_set(proposed, '{learningPath}', '"Earn (18+)"'), row_version = row_version + 1 WHERE id = $1`, [kid]);
    as(admin);
    expect((await step(kid, "preview")).b).toMatchObject({ error: "EARN_MINOR", message: MESSAGES.earnMinorPublish });
    await q("UPDATE cw_contributions SET previewed_version = 1, row_version = row_version + 1 WHERE id = $1", [kid]);
    expect((await step(kid, "publish")).b).toMatchObject({ error: "EARN_MINOR", message: MESSAGES.earnMinorPublish });
    expect(await cards(kid)).toBe(0);
  });
});

describe("a database with 027 but not 028 yet (the code may run before 028 is applied)", () => {
  const run = () => ({ setExpected: (n: string) => testDb().raw.query("select set_config('rv.expected_db', $1, false)", [n]), exec: (sql: string) => testDb().raw.exec(sql) });
  it("a Moderator's decline still works (stored as a rejection); Unpublish and Reopen answer 'not set up yet' and change nothing", async () => {
    await applyFile(run(), testDb().dbName, readFileSync("db/rollback/028_down.sql", "utf8"));
    try {
      const id = await submit(); as(mod); await step(id, "open");
      const d = await step(id, "decline", { reason: "Duplicate." });
      expect(d.b.item.status).toBe("rejected");
      expect(d.b.item.feedback.at(-1)).toMatchObject({ type: "reject", text: "Duplicate." });
      as(admin);
      const r = await step(id, "reopen", { reason: "Look again." });
      expect([r.status, r.b.error]).toEqual([503, "NOT_SET_UP"]);
      expect((await detail(id)).status).toBe("rejected");
      const pub = await published();
      const u = await step(pub, "unpublish");
      expect([u.status, u.b.error]).toEqual([503, "NOT_SET_UP"]);
      expect(await cards(pub)).toBe(1); // the card is still there: the whole step was undone
      expect((await detail(pub)).status).toBe("published");
    } finally {
      await applyFile(run(), testDb().dbName, readFileSync("db/migrations/028_contribution_workflow_decisions.sql", "utf8"));
    }
  });
});
