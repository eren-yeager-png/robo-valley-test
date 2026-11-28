// Contribution Portal, Phase B (migration 030), the server on a real in-process database (PGlite, every migration), through the real
// routes: the separate Approved step, field status / archive / delete, Admin > Sectors, moderators per sector (enforced on every
// reviewing route), and the Audit Log rows each change writes. Permissions are checked server-side for every role.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
const who: { id: string | null; role: string } = { id: null, role: "ST" };
vi.mock("../src/lib/currentUser", () => ({
  getCurrentUser: async () => (who.id ? { id: who.id, fullName: "Signed In", email: "x@example.com", role: who.role, mustChangePassword: false } : null),
  firstNameOf: () => "X",
}));

import * as submitRoute from "../src/app/api/cw/contributions/route";
import * as itemRoute from "../src/app/api/cw/review/[id]/route";
import * as listRoute from "../src/app/api/cw/review/route";
import * as mineRoute from "../src/app/api/cw/mine/route";
import * as portalRoute from "../src/app/api/review/portal/route";
import * as formItemRoute from "../src/app/api/review/[id]/route";
import * as decisionRoute from "../src/app/api/review/[id]/decision/route";
import * as queueRoute from "../src/app/api/review/queue/route";
import * as exportRoute from "../src/app/api/review/export/route";
import * as addFieldRoute from "../src/app/api/admin/sector-forms/[slug]/robots/route";
import * as fieldRoute from "../src/app/api/admin/sector-forms/[slug]/robots/[id]/route";
import * as formsRoute from "../src/app/api/admin/portal/sector-forms/route";
import * as formConfigRoute from "../src/app/api/cw/form-config/route";
import * as sectorsRoute from "../src/app/api/admin/sectors/route";
import * as sectorRoute from "../src/app/api/admin/sectors/[slug]/route";
import * as modSectorsRoute from "../src/app/api/admin/moderators/sectors/route";

const q = (sql: string, p: unknown[] = []): Promise<{ rows: any[] }> => testDb().raw.query(sql, p as never) as never;
let n = 0;
const ip = () => `46.${Math.floor(++n / 250) % 250}.${n % 250}.1`;
const as = (u: { id: string; role: string }) => { who.id = u.id; who.role = u.role; };
type Route = Record<string, any>;
const call = async (route: Route, method: string, url: string, body?: unknown, params?: Record<string, string>) => {
  const init: RequestInit = { method, headers: { "x-forwarded-for": ip(), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) };
  const r = await route[method](new Request("http://localhost" + url, init), params ? { params: Promise.resolve(params) } : undefined);
  const text = await r.text();
  let b: any = text;
  try { b = JSON.parse(text); } catch { /* a CSV */ }
  return { status: r.status, b };
};
let student: any, teacher: any, mod: any, mod2: any, admin: any;

async function idea(user: any, over: Record<string, unknown> = {}) {
  as(user);
  const fd = new FormData();
  fd.append("data", JSON.stringify({ kind: "New idea", refers: false, title: "Robot club starter pack", description: "Everything a school needs to start a robot club in one week.", sector: "education", robotType: "not-sure", categories: ["Robotics"], suitableFor: [], learningPath: "", references: [], ...over }));
  const r = await submitRoute.POST(new Request("http://localhost/api/cw/contributions", { method: "POST", body: fd, headers: { "x-forwarded-for": ip() } }));
  const b = (await r.json()) as any;
  if (!b.id) throw new Error("submit failed: " + JSON.stringify(b));
  return Number(b.id);
}
const item = async (user: any, id: number) => { as(user); return (await call(itemRoute, "GET", `/api/cw/review/${id}`, undefined, { id: String(id) })).b.item; };
const act = async (user: any, id: number, action: string, extra: Record<string, unknown> = {}) => {
  const it = await item(user, id);
  as(user);
  return call(itemRoute, "POST", `/api/cw/review/${id}`, { action, rowVersion: it?.rowVersion, proposed: it?.proposed, notes: it?.notes, ...extra }, { id: String(id) });
};
async function formItem(user: any, title: string, sector: string) {
  const id = Number((await q("INSERT INTO contributions (user_id, type, title, body, status) VALUES ($1, 'improve', $2, 'A contribution sent with the current form.', 'draft') RETURNING id", [user.id, title])).rows[0].id);
  await q("INSERT INTO contribution_scopes (contribution_id, sector_id) SELECT $1, id FROM sectors WHERE slug = $2", [id, sector]);
  await q("UPDATE contributions SET status = 'pending_review', submitted_at = now() - interval '2 days' WHERE id = $1", [id]);
  return id;
}
const auditRows = async (type: string) => (await q("SELECT action, actor_role, target_id, meta FROM audit_log WHERE target_type = $1 ORDER BY id", [type])).rows;

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await q("DELETE FROM api_rate_limits");
  await q("INSERT INTO sectors (slug, name, sort_order) VALUES ('education', 'Education', 20), ('healthcare', 'Healthcare', 30) ON CONFLICT (slug) DO NOTHING");
  student = await seedUser({ email: `st${++n}@example.com`, role: "ST", fullName: "Neha Sharma" });
  teacher = await seedUser({ email: `tc${n}@example.com`, role: "TC", fullName: "Kiran Prasad" });
  const m = await seedUser({ email: `mod${n}@example.com`, role: "TC", fullName: "Priya Moderator" });
  const m2 = await seedUser({ email: `mod2${n}@example.com`, role: "TC", fullName: "Ravi Moderator" });
  await q("UPDATE users SET is_moderator = true WHERE id = ANY($1::bigint[])", [[m.id, m2.id]]);
  mod = { id: m.id, role: "TC" }; mod2 = { id: m2.id, role: "TC" };
  admin = await seedUser({ email: `adm${n}@example.com`, role: "admin", fullName: "Arun Admin" });
  student = { id: student.id, role: "ST" }; teacher = { id: teacher.id, role: "TC" }; admin = { id: admin.id, role: "admin" };
});
afterEach(() => { vi.restoreAllMocks(); });

describe("the Approved step (a Moderator's approval, then the publishing request)", () => {
  it("approve -> Approved (who and when, history, audit); Send -> Pending Admin Approval; the Admin publishes (who, audit)", async () => {
    const id = await idea(student, { title: "Robot tutors for maths" });
    const ap = await act(mod, id, "approve");
    expect(ap.status).toBe(200);
    expect(ap.b.item).toMatchObject({ status: "approved", statusLabel: "Approved by Moderator" });
    expect(ap.b.message).toMatch(/not public/);
    expect(ap.b.item.history.at(-1).text).toBe("Approved as-is, no changes to the original. The publishing request to an Admin is sent separately.");
    const row = (await q("SELECT approved_by, approved_at IS NOT NULL AS a, publish_requested_at, edited_by FROM cw_contributions WHERE id = $1", [id])).rows[0];
    expect(row).toMatchObject({ approved_by: String(mod.id), a: true, publish_requested_at: null, edited_by: null }); // bigint ids come back as text
    expect((await act(mod, id, "approve")).status).toBe(409); // approved already
    // Moderation shows it Approved with "Send publish request to Admin"; Publish Requests does not list it yet
    as(mod);
    const m = await call(portalRoute, "GET", "/api/review/portal?view=moderation&sector=education");
    expect(m.b.features).toEqual({ approvedStep: true });
    expect(m.b.rows.find((r: any) => r.id === id)).toMatchObject({ display: "approved", actions: ["send", "view"] });
    as(admin);
    expect((await call(portalRoute, "GET", "/api/review/portal?view=requests")).b.rows.some((r: any) => r.id === id)).toBe(false);
    // the contributor sees "Approved" (it is not public yet)
    as(student);
    expect((await call(mineRoute, "GET", "/api/cw/mine")).b.items.find((x: any) => x.code === `RV-${id}`)).toMatchObject({ status: "approved", statusLabel: "Approved", publishedAt: null });
    const sent = await act(mod, id, "send_request");
    expect(sent.status).toBe(200);
    expect(sent.b.item.status).toBe("pending");
    expect((await q("SELECT approved_by, publish_requested_at IS NOT NULL AS r FROM cw_contributions WHERE id = $1", [id])).rows[0]).toEqual({ approved_by: String(mod.id), r: true });
    as(admin);
    expect((await call(portalRoute, "GET", "/api/review/portal?view=requests")).b.rows.find((r: any) => r.id === id)).toMatchObject({ display: "requested" });
    // the Admin previews and publishes
    const pv = await act(admin, id, "preview", { version: 1 });
    expect(pv.status).toBe(200);
    const pub = await act(admin, id, "publish");
    expect(pub.status).toBe(200);
    expect((await q("SELECT status, published_by FROM cw_contributions WHERE id = $1", [id])).rows[0]).toEqual({ status: "published", published_by: String(admin.id) });
    expect((await auditRows("idea")).map((r) => [r.action, r.actor_role])).toEqual([["approve", "moderator"], ["send_request", "moderator"], ["publish", "admin"]]);
  });
  it("from Approved: Back to draft, Reset or Reject (the reason is stored); edits are recorded; nobody but an Admin publishes", async () => {
    const id = await idea(student);
    const it = await item(mod, id);
    const edited = await act(mod, id, "approve", { proposed: { ...it.proposed, title: "Robot club starter pack for villages" } });
    expect(edited.b.item.history.at(-1).text).toMatch(/^Approved with edits \(changed: Title\)/);
    expect((await q("SELECT edited_by FROM cw_contributions WHERE id = $1", [id])).rows[0].edited_by).toBe(String(mod.id));
    expect((await act(mod, id, "publish")).status).toBe(403); // a Moderator never publishes
    expect((await act(mod, id, "save_draft")).b.item.status).toBe("draft");
    expect((await act(mod, id, "approve")).b.item.status).toBe("approved");
    expect((await act(mod, id, "reset")).b.item.status).toBe("draft");
    expect((await act(mod, id, "approve")).b.item.status).toBe("approved");
    const no = await act(mod, id, "decline", { reason: "Not about robots in class." });
    expect(no.b.item.status).toBe("rejected");
    expect((await q("SELECT reject_reason FROM cw_contributions WHERE id = $1", [id])).rows[0].reject_reason).toBe("Not about robots in class.");
    // an idea with no category cannot be approved as it is
    const bare = await idea(student, { title: "Robot club without a category", categories: [] });
    expect((await act(mod, bare, "approve")).status).toBe(400);
    // members cannot moderate
    expect((await act(student, bare, "approve")).status).toBe(403);
  });
});

describe("fields (Sector Forms, Admins only): status, archive, delete only when unused, a plugin's field never", () => {
  const add = (body: object) => call(addFieldRoute, "POST", "/api/admin/sector-forms/education/robots", body, { slug: "education" });
  const change = (id: number, body: object) => call(fieldRoute, "PATCH", `/api/admin/sector-forms/education/robots/${id}`, body, { slug: "education", id: String(id) });
  const del = (id: number) => call(fieldRoute, "DELETE", `/api/admin/sector-forms/education/robots/${id}`, undefined, { slug: "education", id: String(id) });
  it("add with a typed link code, a description, an icon and a status; edit; archive and restore; members only ever see active fields", async () => {
    as(admin);
    const a = await add({ name: "Tutor robots", slug: "tutors", description: "Robots that help with homework.", icon: "🤖", status: "active" });
    expect(a.status).toBe(200);
    expect(a.b.robot).toMatchObject({ slug: "tutors", status: "active", source: "admin", description: "Robots that help with homework.", icon: "🤖" });
    expect((await add({ name: "Other tutors", slug: "tutors" })).status).toBe(409); // the link code is unique in the sector
    expect((await add({ name: "Lab helpers", status: "archived" })).status).toBe(400); // a new field starts Active or Hidden
    const h = await add({ name: "Lab helpers", status: "hidden" });
    expect(h.b.robot).toMatchObject({ slug: "lab-helpers", status: "hidden", active: false });
    const e = await change(a.b.robot.id, { edit: { name: "Tutor bots", description: "", icon: "📚" } });
    expect(e.b.robots.find((r: any) => r.id === a.b.robot.id)).toMatchObject({ name: "Tutor bots", description: "", icon: "📚", slug: "tutors" });
    expect((await change(a.b.robot.id, { status: "archived" })).b.robots.find((r: any) => r.id === a.b.robot.id)).toMatchObject({ status: "archived", active: false });
    const forms = await call(formsRoute, "GET", "/api/admin/portal/sector-forms?sector=education");
    expect(forms.b.sectors.find((s: any) => s.slug === "education").fields).toBe(1); // archived fields are not the sector's fields any more
    as(student);
    const cfg = await call(formConfigRoute, "GET", "/api/cw/form-config");
    expect((cfg.b.sectors.find((s: any) => s.slug === "education")?.robots ?? []).map((r: any) => r.slug)).toEqual([]); // neither hidden nor archived
    as(admin);
    await change(a.b.robot.id, { status: "active" });
    as(student);
    expect((await call(formConfigRoute, "GET", "/api/cw/form-config")).b.sectors.find((s: any) => s.slug === "education").robots.map((r: any) => r.slug)).toEqual(["tutors"]);
    expect((await auditRows("field")).map((r) => r.action)).toEqual(["field_add", "field_add", "field_edit", "field_archive", "field_restore"]);
  });
  it("delete: refused while a contribution of any status uses it (Archive instead), never for a plugin's field; allowed when unused", async () => {
    as(admin);
    const used = (await add({ name: "Tutor robots" })).b.robot;
    const draftUse = (await add({ name: "Lab helpers" })).b.robot;
    const plugin = (await add({ name: "Kit finder" })).b.robot;
    const free = (await add({ name: "Spare field" })).b.robot;
    await idea(student, { robotType: used.slug });
    const draft = Number((await q("INSERT INTO contributions (user_id, type, title, body, status) VALUES ($1, 'improve', 'A draft about lab helpers', 'Only a draft, but it chose the field.', 'draft') RETURNING id", [student.id])).rows[0].id);
    await q("INSERT INTO contribution_scopes (contribution_id, sector_id, robot_type_id) SELECT $1, id, $2 FROM sectors WHERE slug = 'education'", [draft, draftUse.id]);
    await q("INSERT INTO plugins (plugin_key, name) VALUES ('classroom-kit', 'Classroom Kit')");
    await q("UPDATE sector_robot_types SET source = 'plugin', plugin_key = 'classroom-kit' WHERE id = $1", [plugin.id]);
    as(admin);
    const r1 = await del(used.id);
    expect(r1).toMatchObject({ status: 409, b: { error: "IN_USE" } });
    expect(r1.b.message).toMatch(/1 contribution uses this field\. Archive it instead\./);
    expect((await del(draftUse.id)).b.error).toBe("IN_USE");
    expect((await del(plugin.id)).b.error).toBe("PLUGIN_MANAGED");
    const forms = await call(formsRoute, "GET", "/api/admin/portal/sector-forms?sector=education");
    expect(forms.b.fields.map((f: any) => [f.name, f.deletable])).toEqual([["Tutor robots", false], ["Lab helpers", false], ["Kit finder", false], ["Spare field", true]]);
    expect(forms.b.fields.find((f: any) => f.name === "Kit finder")).toMatchObject({ source: "plugin", pluginName: "Classroom Kit", deleteBlock: "Managed by Classroom Kit: it cannot be deleted. Hide or archive it instead." });
    expect((await del(free.id)).status).toBe(200);
    expect((await q("SELECT count(*)::int n FROM sector_robot_types WHERE id = $1", [free.id])).rows[0].n).toBe(0);
    expect((await auditRows("field")).filter((r) => r.action === "field_delete").map((r) => r.meta.name)).toEqual(["Spare field"]);
    // the plugin's field can be archived (never deleted)
    expect((await change(plugin.id, { status: "archived" })).status).toBe(200);
  });
  it("only Admins: moderators and members get 403 on adding, changing and deleting a field", async () => {
    as(admin);
    const f = (await add({ name: "Tutor robots" })).b.robot;
    for (const u of [mod, student]) {
      as(u);
      expect((await add({ name: "Nope" })).status).toBe(403);
      expect((await change(f.id, { status: "archived" })).status).toBe(403);
      expect((await del(f.id)).status).toBe(403);
      expect((await call(formsRoute, "GET", "/api/admin/portal/sector-forms")).status).toBe(403);
    }
  });
});

describe("Admin > Sectors (Admins only)", () => {
  const change = (slug: string, body: object) => call(sectorRoute, "PATCH", `/api/admin/sectors/${slug}`, body, { slug });
  it("add, rename, move, style; archive waits while something waits for a decision; archived sectors leave the member lists", async () => {
    as(admin);
    const a = await call(sectorsRoute, "POST", "/api/admin/sectors", { name: "Space & Drones", icon: "🚀", color: "#1f7a5c" });
    expect(a).toMatchObject({ status: 200, b: { sector: { slug: "space-drones", name: "Space & Drones" } } });
    expect((await call(sectorsRoute, "POST", "/api/admin/sectors", { name: "space & drones" })).status).toBe(409);
    expect((await q("SELECT icon, color, is_active, archived_at FROM sectors WHERE slug = 'space-drones'")).rows[0]).toEqual({ icon: "🚀", color: "#1F7A5C", is_active: true, archived_at: null });
    expect((await change("space-drones", { name: "Space and drones" })).b.message).toMatch(/link code stays "space-drones"/);
    expect((await change("space-drones", { style: { color: "blue" } })).status).toBe(400);
    expect((await change("space-drones", { move: "up" })).status).toBe(200);
    // something waits in Education: archiving it is refused
    await idea(student, { title: "Waiting for review" });
    as(admin);
    expect((await change("education", { archived: true })).b.error).toBe("STILL_WAITING");
    expect((await change("space-drones", { archived: true })).status).toBe(200);
    expect((await q("SELECT is_active, archived_at IS NOT NULL AS a FROM sectors WHERE slug = 'space-drones'")).rows[0]).toEqual({ is_active: false, a: true });
    as(student);
    expect((await call(formConfigRoute, "GET", "/api/cw/form-config")).b.sectors.some((s: any) => s.slug === "space-drones")).toBe(false);
    as(admin);
    expect((await change("space-drones", { archived: false })).status).toBe(200);
    expect((await auditRows("sector")).map((r) => r.action)).toEqual(["sector_add", "sector_rename", "sector_reorder", "sector_archive", "sector_restore"]);
    for (const u of [mod, student]) {
      as(u);
      expect((await call(sectorsRoute, "POST", "/api/admin/sectors", { name: "Nope" })).status).toBe(403);
      expect((await change("education", { name: "Nope" })).status).toBe(403);
    }
  });
});

describe("moderators per sector (set in Users & Roles; enforced on every reviewing route)", () => {
  const limit = (u: any, sectors: string[]) => { as(admin); return call(modSectorsRoute, "POST", "/api/admin/moderators/sectors", { userId: u.id, sectors }); };
  it("a limited moderator sees and handles only their sectors; others are refused; [] = every sector again", async () => {
    const edu = await idea(student, { title: "An education idea" });
    const health = await idea(student, { title: "A healthcare idea", sector: "healthcare" });
    const formHealth = await formItem(teacher, "Clinic robots for the hospital", "healthcare");
    const set = await limit(mod, ["education"]);
    expect(set).toMatchObject({ status: 200, b: { sectors: [{ slug: "education", name: "Education" }] } });
    as(mod);
    const portal = await call(portalRoute, "GET", "/api/review/portal?view=moderation");
    expect(portal.b.sectors.map((s: any) => s.slug)).toEqual(["education"]);
    expect(portal.b.limitedTo).toEqual(["education"]);
    expect((await call(itemRoute, "GET", `/api/cw/review/${health}`, undefined, { id: String(health) })).b.error).toBe("NOT_YOUR_SECTOR");
    expect((await act(mod, health, "approve")).status).toBe(403);
    expect((await act(mod, edu, "approve")).status).toBe(200);
    as(mod);
    expect((await call(formItemRoute, "GET", `/api/review/${formHealth}`, undefined, { id: String(formHealth) })).b.error).toBe("NOT_YOUR_SECTOR");
    expect((await call(decisionRoute, "POST", `/api/review/${formHealth}/decision`, { action: "verify" }, { id: String(formHealth) })).status).toBe(403);
    expect((await call(queueRoute, "GET", "/api/review/queue")).b.items.some((x: any) => x.id === formHealth)).toBe(false);
    expect((await call(exportRoute, "GET", "/api/review/export?sector=healthcare")).status).toBe(403);
    const list = await call(listRoute, "GET", "/api/cw/review?filter=All");
    expect(list.b.items.map((x: any) => x.id)).toEqual([edu]);
    // another moderator, and every Admin, still review every sector
    as(mod2);
    expect((await call(itemRoute, "GET", `/api/cw/review/${health}`, undefined, { id: String(health) })).status).toBe(200);
    as(admin);
    expect((await call(formItemRoute, "GET", `/api/review/${formHealth}`, undefined, { id: String(formHealth) })).status).toBe(200);
    // back to every sector
    await limit(mod, []);
    as(mod);
    expect((await call(itemRoute, "GET", `/api/cw/review/${health}`, undefined, { id: String(health) })).status).toBe(200);
    expect((await auditRows("user")).map((r) => [r.action, r.meta.all])).toEqual([["moderator_sectors", false], ["moderator_sectors", true]]);
  });
  it("only Admins set it, only for moderators (an Admin reviews every sector), only with real sectors", async () => {
    as(mod);
    expect((await call(modSectorsRoute, "POST", "/api/admin/moderators/sectors", { userId: mod2.id, sectors: [] })).status).toBe(403);
    expect((await limit(student, ["education"])).b.error).toBe("NOT_MODERATOR");
    expect((await limit(admin, ["education"])).b.error).toBe("ADMIN_ALL_SECTORS");
    expect((await limit(mod, ["no-such-sector"])).status).toBe(400);
    expect((await limit(mod, ["Bad Slug"])).status).toBe(400);
  });
});
