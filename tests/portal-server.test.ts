// Contribution Portal (Phase A), the server side on a real in-process database (PGlite, every migration): the portal reads behind
// Moderation, Publish Requests and the Overview for BOTH kinds of contributions (Share Your Idea and the current form), who may open
// which view, a database without the workflow tables, Sector Forms' data (fields with where they came from, how many contributions use
// each, the suggestions waiting), the Audit Log, and Users & Roles' "View as" (read-only).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb, testPool } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
const who: { id: string | null; role: string } = { id: null, role: "ST" };
vi.mock("../src/lib/currentUser", () => ({
  getCurrentUser: async () => (who.id ? { id: who.id, fullName: "x", email: "x@example.com", role: who.role, mustChangePassword: false } : null),
  firstNameOf: () => "X",
}));

import * as submitRoute from "../src/app/api/cw/contributions/route";
import * as itemRoute from "../src/app/api/cw/review/[id]/route";
import * as portalRoute from "../src/app/api/review/portal/route";
import * as formsRoute from "../src/app/api/admin/portal/sector-forms/route";
import * as auditRoute from "../src/app/api/admin/audit-log/route";
import { portalData } from "../src/lib/portalReview";
import { fieldUseCounts } from "../src/lib/sectorForms";
import { historyAction } from "../src/lib/auditLog";
import { viewAs } from "../src/lib/viewAs";

const q = (sql: string, p: unknown[] = []): Promise<{ rows: any[] }> => testDb().raw.query(sql, p as never) as never;
let n = 0;
const ip = () => `45.${Math.floor(++n / 250) % 250}.${n % 250}.1`;
const as = (u: { id: string; role: string }) => { who.id = u.id; who.role = u.role; };
const get = async (route: { GET: (r: Request) => Promise<Response> }, url: string) => {
  const r = await route.GET(new Request("http://localhost" + url, { headers: { "x-forwarded-for": ip() } }));
  return { status: r.status, b: (await r.json()) as any };
};
let student: any, teacher: any, mod: any, admin: any;

async function idea(user: any, over: Record<string, unknown> = {}) {
  as(user);
  const fd = new FormData();
  fd.append("data", JSON.stringify({ kind: "New idea", refers: false, title: "Robot club starter pack", description: "Everything a school needs to start a robot club in one week.", sector: "education", robotType: "not-sure", categories: ["Robotics"], suitableFor: [], learningPath: "", references: [], ...over }));
  const r = await submitRoute.POST(new Request("http://localhost/api/cw/contributions", { method: "POST", body: fd, headers: { "x-forwarded-for": ip() } }));
  const b = (await r.json()) as any;
  if (!b.id) throw new Error("submit failed: " + JSON.stringify(b));
  return Number(b.id);
}
const act = async (user: any, id: number, action: string, extra: Record<string, unknown> = {}) => {
  as(user);
  const ctx = { params: Promise.resolve({ id: String(id) }) };
  const it = ((await (await itemRoute.GET(new Request("http://localhost/api/cw/review/" + id, { headers: { "x-forwarded-for": ip() } }), ctx)).json()) as any).item;
  const r = await itemRoute.POST(new Request("http://localhost/api/cw/review/" + id, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() },
    body: JSON.stringify({ action, rowVersion: it.rowVersion, proposed: it.proposed, notes: it.notes, ...extra }) }), ctx);
  return { status: r.status, b: (await r.json()) as any };
};
/** an item sent with the current form, in one sector; `verified`: a reviewer approved it */
async function formItem(user: any, title: string, status: string, sector: string, verified = false) {
  // a draft first, then its sector, then its status (the database refuses a submitted item without a sector)
  const id = Number((await q("INSERT INTO contributions (user_id, type, title, body, status) VALUES ($1, 'improve', $2, 'A contribution sent with the current form.', 'draft') RETURNING id", [user.id, title])).rows[0].id);
  await q("INSERT INTO contribution_scopes (contribution_id, sector_id) SELECT $1, id FROM sectors WHERE slug = $2", [id, sector]);
  await q("UPDATE contributions SET status = $2::varchar, submitted_at = now() - interval '2 days', published_at = CASE WHEN $2::varchar IN ('published', 'unpublished') THEN now() - interval '1 day' END WHERE id = $1", [id, status]);
  if (verified) await q("INSERT INTO contribution_reviews (contribution_id, reviewer_id, action) VALUES ($1, $2, 'verify')", [id, mod.id]);
  return id;
}

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await q("DELETE FROM api_rate_limits");
  await q("INSERT INTO sectors (slug, name, sort_order) VALUES ('education', 'Education', 20), ('healthcare', 'Healthcare', 30) ON CONFLICT (slug) DO NOTHING");
  student = await seedUser({ email: `st${++n}@example.com`, role: "ST", fullName: "Neha Sharma" });
  teacher = await seedUser({ email: `tc${n}@example.com`, role: "TC", fullName: "Kiran Prasad" });
  const m = await seedUser({ email: `mod${n}@example.com`, role: "TC", fullName: "Priya Moderator" });
  await q("UPDATE users SET is_moderator = true WHERE id = $1", [m.id]);
  mod = { id: m.id, role: "TC" };
  admin = await seedUser({ email: `adm${n}@example.com`, role: "admin", fullName: "Arun Admin" });
  student = { id: student.id, role: "ST" }; teacher = { id: teacher.id, role: "TC" }; admin = { id: admin.id, role: "admin" };
});
afterEach(() => { vi.restoreAllMocks(); testDb().failOn(undefined as never); });

describe("Moderation's data: both kinds of contributions, one status model", () => {
  it("rows from Share Your Idea and the current form, the grid's numbers, and what a reviewer may do on each row", async () => {
    const a = await idea(student, { title: "Kit library" });
    const b = await idea(teacher, { title: "Robot club starter pack" });
    await act(mod, b, "send_request"); // approved: the request goes to the Admin
    const f1 = await formItem(teacher, "Lab safety checklist", "pending_review", "education");
    const f2 = await formItem(student, "Line follower race day", "pending_review", "education", true);
    as(mod);
    const r = await get(portalRoute, "/api/review/portal?view=moderation&sector=education");
    expect(r.status).toBe(200);
    expect(r.b.sector).toEqual({ slug: "education", name: expect.any(String) });
    const row = (k: string) => r.b.rows.find((x: any) => x.key === k);
    expect(row(`w-${a}`)).toMatchObject({ source: "workflow", display: "pending", actions: ["approve", "edit", "reject"], contributor: "Neha Sharma" });
    expect(row(`w-${b}`)).toMatchObject({ display: "requested", actions: ["view"] });
    expect(row(`f-${f1}`)).toMatchObject({ source: "form", display: "pending", actions: ["approve", "reject"], viewUrl: `/admin/moderation/${f1}?from=education` });
    expect(row(`f-${f2}`)).toMatchObject({ display: "requested", note: "Verified by a reviewer", actions: [] });
    const edu = r.b.sectors.find((s: any) => s.slug === "education");
    expect(edu).toMatchObject({ pending: 2, requested: 2, total: 4 });
    expect(r.b.exportUrl).toBe("/api/review/export?sector=education&tab=all");
  });
  it("a Rejected idea says who declined it (Moderator) or rejected it (Admin), and when", async () => {
    const a = await idea(student, { title: "Declined by a moderator" });
    await act(mod, a, "decline", { reason: "Not about robots at all." });
    as(mod);
    const r = await get(portalRoute, "/api/review/portal?view=moderation&sector=education");
    const row = r.b.rows.find((x: any) => x.key === `w-${a}`);
    expect(row).toMatchObject({ display: "rejected", decision: { label: "Declined by Priya Moderator (Moderator)" } });
    expect(row.decision.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    as(admin);
    expect((await get(portalRoute, "/api/review/portal?view=requests")).b.rows.find((x: any) => x.key === `w-${a}`).decision.label).toBe("Declined by Priya Moderator (Moderator)");
  });
  it("with no sector asked for, the sector with the most waiting opens", async () => {
    await formItem(teacher, "Hospital delivery robot visit", "pending_review", "healthcare");
    await formItem(teacher, "Pharmacy robot open day", "pending_review", "healthcare");
    as(mod);
    expect((await get(portalRoute, "/api/review/portal?view=moderation")).b.sector.slug).toBe("healthcare");
  });
  it("a reviewer never acts on their own current-form item", async () => {
    const own = await formItem(mod, "My own idea", "pending_review", "education");
    as(mod);
    const r = await get(portalRoute, "/api/review/portal?view=moderation&sector=education");
    expect(r.b.rows.find((x: any) => x.key === `f-${own}`).actions).toEqual([]);
  });
  it("Publish Requests and the Overview are the Admin's: a Moderator gets 403", async () => {
    as(mod);
    expect((await get(portalRoute, "/api/review/portal?view=requests")).status).toBe(403);
    expect((await get(portalRoute, "/api/review/portal?view=overview")).status).toBe(403);
    who.id = null;
    expect((await get(portalRoute, "/api/review/portal")).status).toBe(401);
    as(student);
    expect((await get(portalRoute, "/api/review/portal")).status).toBe(403);
  });
  it("Publish Requests: the approved idea (with who approved it and when it was sent) and the verified current-form item", async () => {
    const b = await idea(teacher);
    await act(mod, b, "send_request");
    const f = await formItem(student, "Verified one", "pending_review", "education", true);
    await idea(student, { title: "Still with the Moderators" });
    as(admin);
    const r = await get(portalRoute, "/api/review/portal?view=requests");
    expect(r.status).toBe(200);
    expect(r.b.rows.map((x: any) => x.key).sort()).toEqual([`f-${f}`, `w-${b}`].sort()); // ideas still with the Moderators are not requests
    expect(r.b.rows.find((x: any) => x.key === `w-${b}`)).toMatchObject({ approvedBy: "Priya Moderator", display: "requested", sectorName: expect.any(String) });
    expect(r.b.rows.find((x: any) => x.key === `f-${f}`)).toMatchObject({ approvedBy: "Priya", viewUrl: `/admin/moderation/${f}` });
    expect((await get(portalRoute, "/api/review/portal?view=requests&sector=healthcare")).b.rows).toEqual([]);
  });
  it("the Overview's four numbers", async () => {
    const b = await idea(teacher);
    await act(mod, b, "send_request");
    await formItem(student, "Verified", "pending_review", "education", true);
    await formItem(student, "Not accepted", "rejected", "education");
    as(admin);
    const t = (await get(portalRoute, "/api/review/portal?view=overview")).b.totals;
    expect(t).toMatchObject({ requests: 2, publishedThisWeek: 0, rejected: 1 });
    expect(t.activeContributors).toBeGreaterThanOrEqual(2);
  });
  it("a database without the workflow's tables still shows the current form's items; with neither it is \"not set up\"", async () => {
    const f = await formItem(teacher, "Old one", "pending_review", "education");
    testDb().failOn((sql) => (/cw_contribution/.test(sql) ? Object.assign(new Error('relation "cw_contributions" does not exist'), { code: "42P01" }) : undefined));
    const d = await portalData(testPool(), { view: "moderation", sector: "education", viewerId: Number(mod.id), isAdmin: false }); // the pool the routes use (with the failing table)
    expect(d.rows.map((x) => x.key)).toEqual([`f-${f}`]);
    expect(d.absent).toContain("workflow");
    testDb().failOn((sql) => (/cw_contribution|FROM contributions|JOIN contributions/.test(sql) ? Object.assign(new Error("missing"), { code: "42P01" }) : undefined));
    as(mod);
    expect((await get(portalRoute, "/api/review/portal?view=moderation")).status).toBe(503);
  });
});

describe("Sector Forms' data", () => {
  it("fields with where they came from and how many contributions use each; suggestions waiting until the field exists", async () => {
    const sec = (await q("SELECT id FROM sectors WHERE slug = 'education'")).rows[0].id;
    await q("INSERT INTO sector_robot_types (sector_id, slug, name, sort_order) VALUES ($1, 'robotic-arms', 'Robotic arms', 1), ($1, 'coding-kits', 'Coding kits', 2)", [sec]);
    await idea(student, { title: "Arm for the lab", robotType: "robotic-arms" });
    const suggest = { kind: "Suggestion", refers: true, resource: { feature: "Robots by Sector", type: "Sector page", path: "Robots by Sector › Education", url: "", change: "Add a field" } };
    await idea(teacher, { ...suggest, title: "Coding kits", description: "Kits children use to learn coding with robots." });
    await idea(teacher, { ...suggest, title: "Drone clubs", description: "School drone clubs and their competitions." });
    as(admin);
    const r = await get(formsRoute, "/api/admin/portal/sector-forms?sector=education");
    expect(r.status).toBe(200);
    expect(r.b.sector.slug).toBe("education");
    expect(r.b.fields.map((f: any) => [f.name, f.source, f.contributions])).toEqual([["Robotic arms", "admin", 1], ["Coding kits", "member", 0]]);
    expect(r.b.suggestions.map((s: any) => [s.name, s.by])).toEqual([["Drone clubs", "Kiran Prasad"]]);
    expect(r.b.sectors.find((s: any) => s.slug === "education")).toMatchObject({ fields: 2, suggestions: 1 });
    as(mod);
    expect((await get(formsRoute, "/api/admin/portal/sector-forms")).status).toBe(403);
  });
  it("fieldUseCounts counts current-form items by their robot and ideas by either version", async () => {
    const sec = (await q("SELECT id FROM sectors WHERE slug = 'education'")).rows[0].id;
    const rid = Number((await q("INSERT INTO sector_robot_types (sector_id, slug, name) VALUES ($1, 'robotic-arms', 'Robotic arms') RETURNING id", [sec])).rows[0].id);
    const f = await formItem(teacher, "Old arm idea", "published", "education");
    await q("UPDATE contribution_scopes SET robot_type_id = $1 WHERE contribution_id = $2", [rid, f]);
    await idea(student, { title: "New arm idea", robotType: "robotic-arms" });
    expect((await fieldUseCounts(testDb().raw as never, "education")).get(rid)).toBe(2);
  });
});

describe("the Audit Log and View as", () => {
  it("history lines and decisions, newest first, with who and the role; filter by kind; Admins only", async () => {
    const b = await idea(teacher, { title: "Audit me" });
    await act(mod, b, "send_request");
    const f = await formItem(student, "Old audit item", "pending_review", "education");
    await q("INSERT INTO contribution_reviews (contribution_id, reviewer_id, action, note) VALUES ($1, $2, 'reject', 'Not about robots.')", [f, mod.id]);
    as(admin);
    const r = await get(auditRoute, "/api/admin/audit-log");
    expect(r.status).toBe(200);
    const kinds = r.b.rows.map((x: any) => `${x.action}:${x.role}`);
    expect(kinds).toEqual(expect.arrayContaining(["submitted:Contributor", "approved:Moderator", "rejected:Moderator"]));
    expect(r.b.rows.find((x: any) => x.action === "rejected").details).toBe("Not accepted. Note: Not about robots.");
    const only = await get(auditRoute, "/api/admin/audit-log?action=approved");
    expect(only.b.rows.every((x: any) => x.action === "approved")).toBe(true);
    as(mod);
    expect((await get(auditRoute, "/api/admin/audit-log")).status).toBe(403);
    expect(historyAction("Submitted publishing request to Admin (version 1). Approved as-is, no changes to the original.")).toBe("approved");
    expect(historyAction("Published v2 to the public \"Education\" section, refreshed the page and verified it shows the approved content.")).toBe("published");
  });
  it("View as: the portal, the navigation and the person's own contributions, read-only (no edit links)", async () => {
    await idea(student, { title: "Seen by the Admin" });
    await formItem(student, "Pending old one", "pending_review", "education");
    const v = await viewAs(testDb().raw as never, Number(student.id));
    expect(v).toMatchObject({ portal: "member", roleLabel: "Student" });
    expect(v!.nav).toEqual(expect.arrayContaining(["Home", "Sectors", "My Contributions"]));
    expect(v!.items.map((i) => i.title)).toEqual(expect.arrayContaining(["Seen by the Admin", "Pending old one"]));
    expect(v!.items.every((i) => i.editUrl === "")).toBe(true);
    expect((await viewAs(testDb().raw as never, Number(mod.id)))!.portal).toBe("moderator");
    expect((await viewAs(testDb().raw as never, Number(mod.id)))!.nav).toEqual(["Moderation", "My Contributions"]);
    expect((await viewAs(testDb().raw as never, Number(admin.id)))!.portal).toBe("admin");
    expect(await viewAs(testDb().raw as never, 99999999)).toBeNull();
  });
});
