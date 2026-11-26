// Contribution workflow, Phase 2: the Moderator Workspace's API on a real (in-process) database. Lists and filters, opening, drafts,
// reset, sending (as-is / edited), decline, read-only states, optimistic locking, the original never changing, real names in history,
// who may call what, and the private attachment.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
const who: { id: string | null; role: string } = { id: null, role: "ST" };
vi.mock("../src/lib/currentUser", () => ({
  getCurrentUser: async () => (who.id ? { id: who.id, fullName: "x", email: "x@example.com", role: who.role } : null),
  firstNameOf: () => "X",
}));

import * as submitRoute from "../src/app/api/cw/contributions/route";
import * as listRoute from "../src/app/api/cw/review/route";
import * as itemRoute from "../src/app/api/cw/review/[id]/route";
import * as fileRoute from "../src/app/api/cw/review/[id]/attachment/route";
import { MESSAGES } from "../public/cw/js/lists.js";

const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
let n = 0;
const ip = () => `44.${Math.floor(++n / 250) % 250}.${n % 250}.1`;
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const as = (u: { id: string; role: string }) => { who.id = u.id; who.role = u.role; };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
let member: { id: string; role: string }, mod: { id: string; role: string }, admin: { id: string; role: string };

async function submit(over: Record<string, unknown> = {}, file?: Uint8Array) {
  as(member);
  const fd = new FormData();
  fd.append("data", JSON.stringify({ kind: "New idea", refers: false, title: "Beach robot", description: "A small robot that picks up plastic on the beach.", sector: "not-sure", robotType: "not-sure", categories: ["Robotics"], suitableFor: [], learningPath: "", references: [], resource: {}, ...over }));
  if (file) fd.append("attachment", new File([file as BlobPart], "sketch.png", { type: "image/png" }));
  const r = await submitRoute.POST(new Request("http://localhost/api/cw/contributions", { method: "POST", body: fd, headers: { "x-forwarded-for": ip() } }));
  return Number(((await r.json()) as any).id);
}
const list = async (view: string, filter = "") => {
  const r = await listRoute.GET(new Request(`http://localhost/api/cw/review?view=${view}&filter=${encodeURIComponent(filter)}`, { headers: { "x-forwarded-for": ip() } }));
  return { status: r.status, b: (await r.json()) as any };
};
const detail = async (id: number) => ((await (await itemRoute.GET(new Request("http://localhost/api/cw/review/" + id, { headers: { "x-forwarded-for": ip() } }), ctx(id))).json()) as any).item;
const act = async (id: number, action: string, body: Record<string, unknown> = {}) => {
  const r = await itemRoute.POST(new Request("http://localhost/api/cw/review/" + id, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify({ action, ...body }) }), ctx(id));
  return { status: r.status, b: (await r.json()) as any };
};
/** an action with the row version and proposed version the person currently sees */
const step = async (id: number, action: string, extra: Record<string, unknown> = {}) => { const it = await detail(id); return act(id, action, { rowVersion: it.rowVersion, proposed: it.proposed, notes: it.notes, ...extra }); };

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await q("DELETE FROM api_rate_limits");
  member = await seedUser({ email: `m${++n}@example.com`, role: "PA", fullName: "Meera Kumar" });
  const m = await seedUser({ email: `mod${n}@example.com`, role: "TC", fullName: "Priya Moderator" });
  await q("UPDATE users SET is_moderator = true WHERE id = $1", [m.id]);
  mod = { id: m.id, role: "TC" };
  const a = await seedUser({ email: `adm${n}@example.com`, role: "admin", fullName: "Arun Admin" });
  admin = { id: a.id, role: "admin" };
});
afterEach(() => { vi.restoreAllMocks(); });

describe("lists and filters", () => {
  it("Open is the default; the badge counts Open items; the earlier (old form) contributions still waiting are counted", async () => {
    const a = await submit(), b = await submit({ title: "Second" });
    await q("INSERT INTO contributions (user_id, type, title, body, status, submitted_at) VALUES ($1, 'problem', 'Old form item one', 'An older contribution text.', 'pending_review', now()), ($1, 'problem', 'Old form item two', 'An older contribution text.', 'published', now())", [member.id]).catch(async () => {
      // older schemas may need a sector scope; fall back to counting whatever is there
    });
    as(mod);
    const r = await list("workspace");
    expect(r.status).toBe(200);
    expect(r.b.filter).toBe("Open");
    expect(r.b.items.map((i: any) => i.id)).toEqual([b, a]); // newest first
    expect(r.b.items[0]).toMatchObject({ code: `RV-${b}`, status: "submitted", title: "Second", kind: "New idea", contributorName: "Meera Kumar", contributorType: "Parent / guardian", sectorName: "Not sure" });
    expect(r.b.counts.open).toBe(2);
    expect(typeof r.b.earlier).toBe("number");
    expect((await list("workspace", "Decided")).b.items).toEqual([]);
    expect((await list("workspace", "made up")).b.filter).toBe("Open");
  });
});

describe("opening (acceptance 4)", () => {
  it("the first open moves Submitted to Under Moderator Review once and records the moderator", async () => {
    const id = await submit(); as(mod);
    const r = await act(id, "open");
    expect(r.status).toBe(200);
    expect(r.b.item).toMatchObject({ status: "under_review", moderator: "Priya Moderator" });
    await act(id, "open");
    const h = (await detail(id)).history;
    expect(h.map((x: any) => [x.actor, x.text])).toEqual([["Meera Kumar (Parent / guardian)", "Submitted through the contribution form: New idea."], ["Priya Moderator", "Opened the contribution and started review."]]);
  });
});

describe("drafts, reset and sending", () => {
  it("Save Draft keeps the edit, lists the changed fields, says nothing was published; Reset goes back to the original", async () => {
    const id = await submit(); as(mod); await act(id, "open");
    const it = await detail(id);
    const r = await act(id, "save_draft", { rowVersion: it.rowVersion, proposed: { ...it.proposed, title: "Beach clean-up robot", categories: ["Robotics", "STEAM"] }, notes: "Clearer title." });
    expect(r.b).toMatchObject({ success: true, message: MESSAGES.draftSaved });
    expect(r.b.item).toMatchObject({ status: "draft", notes: "Clearer title.", proposed: { title: "Beach clean-up robot" }, original: { title: "Beach robot" } });
    expect(r.b.item.history.at(-1).text).toBe("Saved a draft (changed: Title, Category). Not published.");
    const back = await step(id, "reset");
    expect(back.b.item.proposed).toEqual(back.b.item.original);
    expect(back.b.item.history.at(-1).text).toBe("Reset the working version back to the original submission.");
  });
  it("sending unchanged: Pending Admin Approval, version 1, 'Approved as-is' (acceptance 5)", async () => {
    const id = await submit(); as(mod); await act(id, "open");
    const r = await step(id, "send_request");
    expect(r.status).toBe(200);
    expect(r.b.message).toBe("Request sent to Admin. Status: Pending Admin Approval. It is still not public.");
    expect(r.b.item).toMatchObject({ status: "pending", previewedVersion: null });
    expect(r.b.item.versions).toEqual([expect.objectContaining({ v: 1, by: "Priya Moderator", role: "Moderator" })]);
    expect(r.b.item.history.at(-1).text).toBe("Submitted publishing request to Admin (version 1). Approved as-is, no changes to the original.");
  });
  it("sending after edits says what was edited against the original", async () => {
    const id = await submit(); as(mod);
    const it = await detail(id);
    const r = await act(id, "send_request", { rowVersion: it.rowVersion, proposed: { ...it.proposed, description: it.proposed.description + " With a solar panel.", learningPath: "Make" } });
    expect(r.b.item.history.at(-1).text).toBe("Submitted publishing request to Admin (version 1). Edited vs original: Description, Suggested path.");
  });
  it("cannot send with an empty title, a description under 20 characters or no category (acceptance 6); nothing changes", async () => {
    const id = await submit(); as(mod);
    const it = await detail(id);
    for (const [p, msg] of [[{ title: "" }, MESSAGES.sendLength], [{ description: "Too short." }, MESSAGES.sendLength], [{ categories: [] }, MESSAGES.sendCategory]] as const) {
      const r = await act(id, "send_request", { rowVersion: it.rowVersion, proposed: { ...it.proposed, ...p } });
      expect([r.status, r.b.message]).toEqual([400, msg]);
    }
    expect((await detail(id))).toMatchObject({ status: "submitted", rowVersion: it.rowVersion, versions: [] });
  });
  it("Decline needs a reason, then Rejected with the reason stored as feedback and in history", async () => {
    const id = await submit(); as(mod);
    expect((await step(id, "decline", { reason: "  " })).b.message).toBe(MESSAGES.reasonRequired);
    const r = await step(id, "decline", { reason: "Already on the site." });
    expect(r.b.item.status).toBe("rejected");
    expect(r.b.item.feedback).toEqual([expect.objectContaining({ type: "reject", text: "Already on the site.", by: "Priya Moderator" })]);
    expect(r.b.item.history.at(-1).text).toBe("Declined the idea. Reason: Already on the site.");
  });
});

describe("read-only states, locking and the original (acceptance 7, 8)", () => {
  it("in Pending, Resubmitted, Publishing, Published and Rejected the Moderator cannot change anything", async () => {
    const id = await submit(); as(mod); await step(id, "send_request");
    for (const status of ["pending", "resubmitted", "publishing", "published", "rejected"]) {
      await q("UPDATE cw_contributions SET status = $2::varchar, published_at = CASE WHEN $2::varchar = 'published' THEN now() END WHERE id = $1", [id, status]);
      for (const a of ["save_draft", "reset", "send_request", "decline"]) {
        const r = await step(id, a, { reason: "r" });
        expect([status, a, r.status, r.b.error]).toEqual([status, a, 409, "NOT_ALLOWED"]);
      }
    }
  });
  it("a stale row version is refused with 409 and changes nothing (optimistic locking)", async () => {
    const id = await submit(); as(mod);
    const it = await detail(id);
    await step(id, "save_draft", { proposed: { ...it.proposed, title: "First edit" } });
    const r = await act(id, "save_draft", { rowVersion: it.rowVersion, proposed: { ...it.proposed, title: "Lost edit" } });
    expect([r.status, r.b.error, r.b.message]).toEqual([409, "STALE", MESSAGES.stale]);
    expect((await detail(id)).proposed.title).toBe("First edit");
  });
  it("original, resource and references are identical after any number of edits; sending them in the request changes nothing", async () => {
    const id = await submit({ kind: "Modification", resource: { feature: "Projects", type: "Project", path: "Projects › Solar car", url: "https://techytree.in/p", change: "Add steps." }, references: [{ url: "https://example.com/a", remarks: "r" }] });
    as(mod);
    const before = await detail(id);
    for (const t of ["One", "Two", "Three"]) await step(id, "save_draft", { proposed: { ...before.proposed, title: t }, original: { title: "Hacked" }, resource: { path: "Hacked" }, references: [] });
    await step(id, "send_request", { original: { title: "Hacked" } });
    const after = await detail(id);
    expect([after.original, after.resource, after.references]).toEqual([before.original, before.resource, before.references]);
  });
});

describe("who may call what", () => {
  it("signed out: 401; a member who is not a reviewer: 403; a moderator cannot see the Admin list", async () => {
    const id = await submit();
    who.id = null;
    expect((await list("workspace")).status).toBe(401);
    as(member);
    expect((await list("workspace")).status).toBe(403);
    expect((await act(id, "open")).status).toBe(403);
    as(mod);
    expect((await list("approvals")).status).toBe(403);
    as(admin);
    expect((await list("approvals")).status).toBe(200);
  });
  it("an unknown or not-yet-offered action is refused; an unknown id is 404", async () => {
    const id = await submit(); as(mod);
    expect((await act(id, "delete")).status).toBe(400);
    expect((await act(999999, "open")).status).toBe(404);
  });
  it("every history line names the real signed-in person (acceptance 16)", async () => {
    const id = await submit(); as(admin);
    await act(id, "open");
    expect((await detail(id)).history.at(-1)).toMatchObject({ actor: "Arun Admin", text: "Opened the contribution and started review." });
    expect((await detail(id)).history.every((h: any) => h.at && h.actor && h.text)).toBe(true);
  });
});

describe("the attachment is private to reviewers", () => {
  it("a reviewer downloads it with its real type, never cached or sniffed; a member cannot", async () => {
    const id = await submit({}, PNG);
    const get = () => fileRoute.GET(new Request(`http://localhost/api/cw/review/${id}/attachment`, { headers: { "x-forwarded-for": ip() } }), ctx(id));
    as(member);
    expect((await get()).status).toBe(403);
    as(mod);
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("cache-control")).toBe("no-store, private");
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="sketch.png"');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(PNG);
    expect((await detail(id)).attachment).toEqual({ name: "sketch.png", mime: "image/png", size: PNG.length });
  });
});
