// "My Contributions" in every portal (src/lib/cw/mine.ts, GET /api/cw/mine, public/cw/js/mine.js), on a real (in-process) database.
// Only the signed-in person's own items, from the workflow and from the current form, with the status a contributor sees (Draft /
// Pending / Approved / Published / Unpublished / Rejected), the moderators' feedback, and Edit ONLY for pending items of the current
// form. New-workflow ideas are View only: a contributor can't edit one through the screen, the API or the database (acceptance 7).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
const who: { id: string | null; role: string } = { id: null, role: "ST" };
vi.mock("../src/lib/currentUser", () => ({
  getCurrentUser: async () => (who.id ? { id: who.id, fullName: "x", email: "x@example.com", role: who.role } : null),
  firstNameOf: () => "X",
}));

import * as mineRoute from "../src/app/api/cw/mine/route";
import * as submitRoute from "../src/app/api/cw/contributions/route";
import * as itemRoute from "../src/app/api/cw/review/[id]/route";
import { MINE_LABEL } from "../public/cw/js/lists.js";
import { mineStatus } from "../public/cw/js/rules.js";

const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
let n = 0;
const ip = () => `33.${Math.floor(++n / 250) % 250}.${n % 250}.1`;
type U = { id: string; role: string };
const as = (u: U) => { who.id = u.id; who.role = u.role; };
let member: U, other: U, admin: U;

async function idea(u: U, title: string) {
  as(u);
  const fd = new FormData();
  fd.append("data", JSON.stringify({ kind: "Suggestion", refers: true, title, description: "A small robot that helps the school garden every day.", sector: "healthcare", robotType: "not-sure", categories: ["Robotics"], suitableFor: [], learningPath: "", references: [],
    resource: { feature: "Robots by Sector", type: "Sector page", path: "Robots by Sector › Healthcare", url: "", change: "Add a field about rehabilitation robots." } }));
  return Number(((await (await submitRoute.POST(new Request("http://localhost/api/cw/contributions", { method: "POST", body: fd, headers: { "x-forwarded-for": ip() } }))).json()) as any).id);
}
async function oldItem(u: U, title: string, status: string, reply = "") {
  const id = Number(((await q(`INSERT INTO contributions (user_id, type, type_chosen, title, body) VALUES ($1, 'problem', true, $2, 'Made up for the test of My Contributions.') RETURNING id`, [u.id, title])).rows[0] as any).id);
  await q("INSERT INTO contribution_scopes (contribution_id, sector_id) SELECT $1, id FROM sectors WHERE slug = 'healthcare'", [id]);
  if (status !== "draft") await q("UPDATE contributions SET status = $2::varchar, submitted_at = now() - interval '1 day', published_at = CASE WHEN $2::varchar = 'published' THEN now() END WHERE id = $1", [id, status]);
  if (reply) await q("INSERT INTO contribution_replies (contribution_id, author_id, message) VALUES ($1, $2, $3)", [id, admin.id, reply]);
  return id;
}
const mine = async () => { const r = await mineRoute.GET(new Request("http://localhost/api/cw/mine", { headers: { "x-forwarded-for": ip() } })); return { status: r.status, b: (await r.json()) as any }; };

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await q("DELETE FROM api_rate_limits");
  await q("INSERT INTO sectors (slug, name, sort_order) VALUES ('healthcare','Healthcare',30) ON CONFLICT DO NOTHING");
  const m = await seedUser({ email: `mm${++n}@example.com`, role: "PA", fullName: "Meera Kumar" }); member = { id: m.id, role: "PA" };
  const o = await seedUser({ email: `mo${n}@example.com`, role: "TC", fullName: "Someone Else" }); other = { id: o.id, role: "TC" };
  const a = await seedUser({ email: `ma${n}@example.com`, role: "admin", fullName: "Arun Admin" }); admin = { id: a.id, role: "admin" };
});
afterEach(() => { vi.restoreAllMocks(); });

describe("the list (GET /api/cw/mine)", () => {
  it("only my own items, from the workflow AND the current form, newest first, with the contributor's status, sector and type", async () => {
    await idea(other, "Not mine");
    const wf = await idea(member, "My new idea");
    await oldItem(member, "My older idea from the form", "pending_review");
    await oldItem(other, "Someone else's older idea", "published");
    as(member);
    const r = await mine();
    expect(r.status).toBe(200);
    expect(r.b.items.map((i: any) => [i.title, i.source, i.statusLabel, i.sectorName, i.type])).toEqual([
      ["My new idea", "workflow", "Pending", "Healthcare", "Suggestion"],
      ["My older idea from the form", "form", "Pending", "Healthcare", "Describe a problem"],
    ]);
    expect(r.b.items[0].code).toBe(`RV-${wf}`);
    expect(r.b.contributeUrl).toMatch(/\/contribute-now\/$/);
  });
  it("Edit only for pending (and draft) items of the current form; never for a new idea", async () => {
    await idea(member, "A new idea");
    await oldItem(member, "Pending one", "pending_review");
    await oldItem(member, "Changes asked", "changes_requested");
    await oldItem(member, "Published one", "published");
    as(member);
    const items = (await mine()).b.items as any[];
    const edit = Object.fromEntries(items.map((i) => [i.title, Boolean(i.editUrl)]));
    expect(edit).toEqual({ "A new idea": false, "Pending one": true, "Changes asked": true, "Published one": false });
    expect(items.find((i) => i.title === "Pending one").editUrl).toMatch(/\/your-contributions\/$/);
  });
  it("the moderators' feedback: the reason for a rejected idea, and the reply to an older one", async () => {
    const id = await idea(member, "Rejected idea");
    await q("UPDATE cw_contributions SET status = 'rejected', row_version = row_version + 1 WHERE id = $1", [id]);
    await q("INSERT INTO cw_contribution_feedback (contribution_id, type, text, by_name) VALUES ($1, 'decline', 'Already covered by another idea.', 'Priya Moderator')", [id]);
    await oldItem(member, "Older with a reply", "changes_requested", "Please add the kit names.");
    as(member);
    const items = (await mine()).b.items as any[];
    expect(items.find((i) => i.title === "Rejected idea")).toMatchObject({ statusLabel: "Rejected", feedback: "Already covered by another idea." });
    expect(items.find((i) => i.title === "Older with a reply")).toMatchObject({ statusLabel: "Pending", feedback: "Please add the kit names." });
  });
  it("administrators and moderators see their own items too (the page is in every portal); signed out: 401", async () => {
    await oldItem(admin, "An admin's older idea", "published");
    as(admin);
    expect((await mine()).b.items.map((i: any) => i.title)).toEqual(["An admin's older idea"]);
    who.id = null;
    expect((await mine()).status).toBe(401);
  });
  it("the status a contributor sees, for every status of both sources", () => {
    const wf = ["submitted", "under_review", "draft", "changes_requested", "pending", "resubmitted", "publishing", "failed", "published", "unpublished", "rejected"].map((s) => mineStatus("workflow", s).label);
    expect(wf).toEqual(["Pending", "Pending", "Pending", "Pending", "Approved", "Approved", "Approved", "Approved", "Published", "Unpublished", "Rejected"]);
    expect(["draft", "pending_review", "changes_requested", "published", "rejected"].map((s) => mineStatus("form", s).label)).toEqual(["Draft", "Pending", "Pending", "Published", "Rejected"]);
    expect(Object.values(MINE_LABEL)).toEqual(["Draft", "Pending", "Approved", "Published", "Unpublished", "Rejected"]);
  });
});

describe("a contributor can't edit a new-workflow idea (acceptance 7 stays as it is)", () => {
  it("not through the API: the review actions are for reviewers (403) and the submit route has no edit method", async () => {
    const id = await idea(member, "Cannot be edited");
    as(member);
    const r = await itemRoute.POST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify({ action: "save_draft", rowVersion: 1, proposed: { title: "Changed" } }) }), { params: Promise.resolve({ id: String(id) }) });
    expect(r.status).toBe(403);
    expect(Object.keys(submitRoute).filter((k) => /^(PUT|PATCH|DELETE)$/.test(k))).toEqual([]); // Next answers 405 to those
    expect(((await q("SELECT original->>'title' t FROM cw_contributions WHERE id = $1", [id])).rows[0] as any).t).toBe("Cannot be edited");
  });
  it("not in the database: the original is written once", async () => {
    const id = await idea(member, "Written once");
    await expect(q(`UPDATE cw_contributions SET original = jsonb_set(original, '{title}', '"Changed"') WHERE id = $1`, [id])).rejects.toThrow(/cannot be changed/);
  });
});
