// Contribution workflow, Phase 3: the Admin Approval Dashboard's API on a real (in-process) database. The Admin list, the Publish
// Preview (current version only, logged once per version, never internal data), Edit Before Publishing (a new version that needs a new
// preview), Request Changes back to the Moderator (whose next send is Resubmitted), Reject, and who may do what.
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
import { MESSAGES } from "../public/cw/js/lists.js";

const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
let n = 0;
const ip = () => `55.${Math.floor(++n / 250) % 250}.${n % 250}.1`;
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const as = (u: { id: string; role: string }) => { who.id = u.id; who.role = u.role; };
let member: any, mod: any, admin: any;

async function submit(over: Record<string, unknown> = {}) {
  as(member);
  const fd = new FormData();
  fd.append("data", JSON.stringify({ kind: "New idea", refers: false, title: "Beach robot", description: "A small robot that picks up plastic on the beach.", sector: "healthcare", robotType: "not-sure", categories: ["Robotics"], suitableFor: ["K6–K8"], learningPath: "Make", references: [{ url: "https://example.com/a", remarks: "a link" }], resource: {}, ...over }));
  return Number(((await (await submitRoute.POST(new Request("http://localhost/api/cw/contributions", { method: "POST", body: fd, headers: { "x-forwarded-for": ip() } }))).json()) as any).id);
}
const detail = async (id: number) => ((await (await itemRoute.GET(new Request("http://localhost/x", { headers: { "x-forwarded-for": ip() } }), ctx(id))).json()) as any).item;
const act = async (id: number, action: string, body: Record<string, unknown> = {}) => {
  const r = await itemRoute.POST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify({ action, ...body }) }), ctx(id));
  return { status: r.status, b: (await r.json()) as any };
};
const step = async (id: number, action: string, extra: Record<string, unknown> = {}) => { const it = await detail(id); return act(id, action, { rowVersion: it.rowVersion, proposed: it.proposed, notes: it.notes, version: it.versions.length, ...extra }); };
/** submitted by the member and sent to Admin unchanged by the moderator, with an internal note */
async function pending(over: Record<string, unknown> = {}) { const id = await submit(over); as(mod); await step(id, "send_request", { notes: "SECRET INTERNAL NOTE" }); as(admin); return id; }

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await q("DELETE FROM api_rate_limits");
  await q("INSERT INTO sectors (slug, name, sort_order) VALUES ('healthcare','Healthcare',30) ON CONFLICT DO NOTHING");
  member = await seedUser({ email: `m${++n}@example.com`, role: "PA", fullName: "Meera Kumar Rao" });
  const m = await seedUser({ email: `mod${n}@example.com`, role: "TC", fullName: "Priya Moderator" });
  await q("UPDATE users SET is_moderator = true WHERE id = $1", [m.id]);
  mod = { id: m.id, role: "TC" };
  const a = await seedUser({ email: `adm${n}@example.com`, role: "admin", fullName: "Arun Admin" });
  admin = { id: a.id, role: "admin" };
});
afterEach(() => { vi.restoreAllMocks(); });

describe("the Admin list", () => {
  it("Awaiting me (default) holds Pending, Resubmitted and Failed, with its count; With Moderators holds the rest of the open ones", async () => {
    const a = await pending(); await submit({ title: "Still with the moderators" });
    as(admin);
    const r = await listRoute.GET(new Request("http://localhost/api/cw/review?view=approvals", { headers: { "x-forwarded-for": ip() } }));
    const b = (await r.json()) as any;
    expect(b.filter).toBe("Awaiting me");
    expect(b.items.map((i: any) => i.id)).toEqual([a]);
    expect(b.items[0]).toMatchObject({ moderator: "Priya Moderator", status: "pending" });
    expect(b.counts.awaiting).toBe(1);
    expect(b.earlier).toBeUndefined();
    const w = (await (await listRoute.GET(new Request("http://localhost/api/cw/review?view=approvals&filter=With%20Moderators", { headers: { "x-forwarded-for": ip() } }))).json()) as any;
    expect(w.items.map((i: any) => i.title)).toEqual(["Still with the moderators"]);
  });
});

describe("the Publish Preview (acceptance 10, 15)", () => {
  it("is for the CURRENT version only; recorded once per version; returns the public card's record and nothing internal", async () => {
    const id = await pending();
    const it = await detail(id);
    expect((await act(id, "preview", { rowVersion: it.rowVersion, version: 2 })).status).toBe(409); // not the version on screen
    const r = await act(id, "preview", { rowVersion: it.rowVersion, version: 1 });
    expect(r.status).toBe(200);
    expect(r.b.item.previewedVersion).toBe(1);
    expect(r.b.record).toMatchObject({ code: `RV-${id}`, version: 1, title: "Beach robot", sectorName: "Healthcare", robotTypeName: "Not sure", contributor: { name: "Meera", type: "Parent / guardian" } });
    expect(JSON.stringify(r.b.record)).not.toMatch(/SECRET|Kumar|Rao|notes|history|feedback|Priya/);
    await step(id, "preview");
    expect((await detail(id)).history.filter((h: any) => h.text === "Opened the publish preview for v1.")).toHaveLength(1);
  });
  it("Edit Before Publishing makes a new version by the Admin, keeps the Moderator's, clears the preview; no change = no version", async () => {
    const id = await pending();
    await step(id, "preview");
    expect((await step(id, "admin_edit", { title: "Beach robot", description: "A small robot that picks up plastic on the beach." })).b.item.versions).toHaveLength(1); // nothing changed
    const r = await step(id, "admin_edit", { title: "Beach clean-up robot", description: "A small robot that picks up plastic on the beach." });
    expect(r.b.item).toMatchObject({ status: "pending", previewedVersion: null, proposed: { title: "Beach clean-up robot" } });
    expect(r.b.item.versions.map((v: any) => [v.v, v.role, v.by, v.data.title])).toEqual([[1, "Moderator", "Priya Moderator", "Beach robot"], [2, "Admin", "Arun Admin", "Beach clean-up robot"]]);
    expect(r.b.item.history.at(-1).text).toBe("Edited the proposed content (changed: Title). Saved as v2; Moderator version kept.");
    expect((await step(id, "admin_edit", { title: "", description: "x" })).b.message).toBe(MESSAGES.sendLength);
  });
});

describe("Request Changes and Reject (acceptance 14)", () => {
  it("Request Changes needs feedback, sends the item back to the Moderator with it; the next send is Resubmitted", async () => {
    const id = await pending();
    expect((await step(id, "request_changes", { feedback: " " })).b.message).toBe(MESSAGES.reasonRequired);
    const r = await step(id, "request_changes", { feedback: "Please add a photo." });
    expect(r.b.item.status).toBe("changes_requested");
    expect(r.b.item.history.at(-1).text).toBe("Requested changes: Please add a photo.");
    as(mod);
    const seen = await detail(id);
    expect(seen.feedback.at(-1)).toMatchObject({ type: "changes", text: "Please add a photo.", by: "Arun Admin" });
    expect((await step(id, "save_draft")).b.item.status).toBe("changes_requested"); // a draft keeps it there
    const again = await step(id, "send_request");
    expect(again.b.item.status).toBe("resubmitted");
    expect(again.b.item.history.at(-1).text).toBe("Resubmitted publishing request to Admin (version 2). Approved as-is, no changes to the original.");
  });
  it("Reject needs a reason; then Rejected", async () => {
    const id = await pending();
    const r = await step(id, "reject", { reason: "Duplicate of RV-1000." });
    expect(r.b.item.status).toBe("rejected");
    expect(r.b.item.history.at(-1).text).toBe("Rejected the publishing request. Reason: Duplicate of RV-1000.");
  });
});

describe("who may do what", () => {
  it("a moderator gets 403 for every Admin action; the Admin acts only in Pending, Resubmitted and Failed", async () => {
    const id = await pending();
    as(mod);
    for (const a of ["preview", "admin_edit", "request_changes", "reject"]) expect((await step(id, a, { reason: "r", feedback: "f", title: "T", description: "D" })).status, a).toBe(403);
    const fresh = await submit({ title: "Another idea, still with the moderators" });
    as(admin);
    for (const a of ["preview", "admin_edit", "request_changes", "reject"]) expect((await step(fresh, a, { reason: "r", feedback: "f", title: "T", description: "Long enough description." })).status, a).toBe(409);
  });
});
