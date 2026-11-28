// Contribution workflow, Phase 4: publishing and the public Community Ideas API, on a real (in-process) database.
// Preview gating in the API (acceptance 10), moderators refused (11), a failed publish leaves the public site unchanged and a retry
// succeeds with exactly one card (12), the card shows exactly the previewed content in the right sector (13), nothing internal is
// ever public (15), Published only after the read-back matched, and a second click while in progress is ignored.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
const who: { id: string | null; role: string } = { id: null, role: "ST" };
vi.mock("../src/lib/currentUser", () => ({
  getCurrentUser: async () => (who.id ? { id: who.id, fullName: "x", email: "x@example.com", role: who.role } : null),
  firstNameOf: () => "X",
}));

import * as submitRoute from "../src/app/api/cw/contributions/route";
import * as itemRoute from "../src/app/api/cw/review/[id]/route";
import * as publicRoute from "../src/app/api/cw/public/route";
import { armPublishFault } from "../src/lib/cw/publish";
import { MESSAGES } from "../public/cw/js/lists.js";

const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
let n = 0;
const ip = () => `66.${Math.floor(++n / 250) % 250}.${n % 250}.1`;
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const as = (u: { id: string; role: string }) => { who.id = u.id; who.role = u.role; };
let member: any, mod: any, admin: any;

async function submit(over: Record<string, unknown> = {}) {
  as(member);
  const fd = new FormData();
  fd.append("data", JSON.stringify({ kind: "Enhancement of existing feature", refers: false, title: "Beach robot", description: "A small robot that picks up plastic on the beach.", sector: "healthcare", robotType: "delivery-robots", categories: ["Robotics"], suitableFor: ["K6–K8", "Not sure"], learningPath: "Make",
    references: [{ url: "https://example.com/a", remarks: "a link" }], resource: { feature: "Projects", type: "Project", path: "Projects › Solar car", url: "https://techytree.in/p", change: "SECRET CHANGE TEXT" }, ...over }));
  return Number(((await (await submitRoute.POST(new Request("http://localhost/api/cw/contributions", { method: "POST", body: fd, headers: { "x-forwarded-for": ip() } }))).json()) as any).id);
}
const detail = async (id: number) => ((await (await itemRoute.GET(new Request("http://localhost/x", { headers: { "x-forwarded-for": ip() } }), ctx(id))).json()) as any).item;
const act = async (id: number, action: string, body: Record<string, unknown> = {}) => {
  const r = await itemRoute.POST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify({ action, ...body }) }), ctx(id));
  return { status: r.status, b: (await r.json()) as any };
};
const step = async (id: number, action: string, extra: Record<string, unknown> = {}) => { const it = await detail(id); return act(id, action, { rowVersion: it.rowVersion, proposed: it.proposed, notes: it.notes, version: it.versions.length, ...extra }); };
const publicItems = async () => ((await (await publicRoute.GET(new Request("http://localhost/api/cw/public"))).json()) as any).items;
const cards = async () => Number(((await q("SELECT count(*)::int n FROM cw_public_contributions")).rows[0] as any).n);
async function readyToPublish(over: Record<string, unknown> = {}) {
  const id = await submit(over); as(mod);
  const it = await detail(id);
  await act(id, "send_request", { rowVersion: it.rowVersion, proposed: { ...it.proposed, title: "Beach clean-up robot" }, notes: "SECRET INTERNAL NOTE" });
  as(admin); await step(id, "preview");
  return id;
}

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await q("DELETE FROM api_rate_limits");
  await q("INSERT INTO sectors (slug, name, sort_order) VALUES ('healthcare','Healthcare',30) ON CONFLICT DO NOTHING");
  const h = (await q("SELECT id FROM sectors WHERE slug = 'healthcare'")).rows[0] as any;
  await q("INSERT INTO sector_robot_types (sector_id, slug, name, sort_order, is_active) VALUES ($1,'delivery-robots','Delivery robots',10,true) ON CONFLICT DO NOTHING", [h.id]);
  member = await seedUser({ email: `m${++n}@example.com`, role: "TC", fullName: "Asha Mohan Rao" });
  const m = await seedUser({ email: `mod${n}@example.com`, role: "TC", fullName: "Priya Moderator" });
  await q("UPDATE users SET is_moderator = true WHERE id = $1", [m.id]);
  mod = { id: m.id, role: "TC" };
  const a = await seedUser({ email: `adm${n}@example.com`, role: "admin", fullName: "Arun Admin" });
  admin = { id: a.id, role: "admin" };
});
afterEach(() => { vi.restoreAllMocks(); });

describe("preview gating and permissions (acceptance 10, 11)", () => {
  it("the API refuses to publish until the current version was previewed; a new version needs a new preview", async () => {
    const id = await submit(); as(mod); await step(id, "send_request"); as(admin);
    const r = await step(id, "publish");
    expect([r.status, r.b.error, r.b.message]).toEqual([409, "PREVIEW_FIRST", MESSAGES.previewFirst]);
    await step(id, "preview");
    await step(id, "admin_edit", { title: "Changed after preview", description: "A small robot that picks up plastic on the beach." });
    expect((await step(id, "publish")).b.error).toBe("PREVIEW_FIRST");
    expect(await cards()).toBe(0);
  });
  it("a Moderator (or a member) calling publish gets 403", async () => {
    const id = await readyToPublish();
    as(mod);
    const rowVersion = (await detail(id)).rowVersion;
    expect((await act(id, "publish", { rowVersion })).status).toBe(403);
    as(member); // not a reviewer at all: refused before anything else
    expect((await act(id, "publish", { rowVersion })).status).toBe(403);
    expect(await cards()).toBe(0);
  });
});

describe("publishing (acceptance 12, 13, 15)", () => {
  it("success: Published only after the read-back matched; one card in the right sector with exactly the previewed content", async () => {
    const id = await readyToPublish();
    const preview = (await step(id, "preview")).b; // the same record the preview showed
    const r = await step(id, "publish");
    expect(r.status).toBe(200);
    expect(r.b.published).toBe(true);
    expect(r.b.item).toMatchObject({ status: "published", publishedVersion: 1, publishAttempts: 1, publishError: null });
    expect(r.b.item.history.slice(-2).map((h: any) => [h.actor, h.text])).toEqual([
      ["Arun Admin", "Clicked Publish (attempt 1)."],
      ["System", 'Published v1 to the public "Healthcare" section, refreshed the page and verified it shows the approved content.'],
    ]);
    const items = await publicItems();
    expect(items).toHaveLength(1);
    const { publishedAt, ...card } = items[0];
    const { publishedAt: _p, ...previewed } = (await step(id, "preview")).b.record ?? preview.record ?? {};
    expect(publishedAt).toBeTruthy();
    expect(card).toEqual({ ...previewed, version: 1 });
    expect(card).toMatchObject({ title: "Beach clean-up robot", sectorName: "Healthcare", robotTypeName: "Delivery robots", contributor: { name: "Asha", type: "Teacher / lab in-charge" }, resource: { path: "Projects › Solar car", url: "https://techytree.in/p" } });
    expect(JSON.stringify(items)).not.toMatch(/SECRET|Mohan|Rao|Priya|notes|history|feedback/);
  });
  it("failure: Publication Failed with the error, the public site unchanged; retry succeeds and there is still exactly one card", async () => {
    const id = await readyToPublish();
    armPublishFault("upsert", "Website did not confirm the update (timeout).");
    const f = await step(id, "publish");
    expect(f.b.published).toBe(false);
    expect(f.b.item).toMatchObject({ status: "failed", publishError: "Website did not confirm the update (timeout).", publishAttempts: 1 });
    expect(f.b.item.history.at(-1)).toMatchObject({ actor: "System", text: "Publication FAILED: Website did not confirm the update (timeout). Public website unchanged." });
    expect(await cards()).toBe(0);
    expect(await publicItems()).toEqual([]);
    const ok = await step(id, "publish"); // Retry Publish (the preview of this version still counts)
    expect(ok.b.item).toMatchObject({ status: "published", publishAttempts: 2 });
    await step(id, "publish").then((r) => expect(r.status).toBe(409)); // published: nothing more to do
    expect(await cards()).toBe(1);
  });
  it("a failed verification after the update puts the earlier public card back exactly as it was; the idea stays Published", async () => {
    const id = await readyToPublish();
    await step(id, "publish");
    const before = await publicItems();
    // an edit after publishing (spec section 15), previewed, and this time the read-back fails
    await step(id, "request_changes", { feedback: "x" }).then((r) => expect(r.status).toBe(409)); // not from Published
    await step(id, "admin_edit", { title: "Second title", description: "A small robot that picks up plastic on the beach." });
    await step(id, "preview");
    armPublishFault("verify", "The public page still showed the old version.");
    const f = await step(id, "publish");
    expect(f.b.item).toMatchObject({ status: "published", publishedVersion: 1, publishError: "The public page still showed the old version." }); // the earlier card is still live
    expect(await publicItems()).toEqual(before);
    expect(await cards()).toBe(1);
    const r = await step(id, "publish"); // Retry Publish
    expect(r.b.item).toMatchObject({ status: "published", publishedVersion: 2, publishError: null });
    expect((await publicItems()).map((x: any) => x.title)).toEqual(["Second title"]);
    expect(await cards()).toBe(1);
  });
  it("any failure after the attempt started ends as Publication Failed with a plain message (never stuck In Progress); Retry works", async () => {
    const id = await readyToPublish();
    testDb().failOn((sql) => (/FROM cw_public_contributions/.test(sql) ? Object.assign(new Error('relation "cw_public_contributions" does not exist'), { code: "42P01" }) : undefined));
    const f = await step(id, "publish");
    testDb().failOn(undefined);
    expect(f.status).toBe(200);
    expect(f.b.item).toMatchObject({ status: "failed", publishError: "The public website could not be updated." });
    expect(JSON.stringify(f.b.item)).not.toMatch(/relation|does not exist|42P01/); // never the database's own words
    const r = await step(id, "publish");
    expect(r.b.item.status).toBe("published");
    expect(await cards()).toBe(1);
  });
  it("an attempt left In Progress for more than 2 minutes (the server stopped mid-way) counts as timed out, and Retry publishes it", async () => {
    const id = await readyToPublish();
    await q("UPDATE cw_contributions SET status = 'publishing', updated_at = now() - interval '5 minutes' WHERE id = $1", [id]);
    const r = await step(id, "publish");
    expect(r.b.item.status).toBe("published");
    expect(r.b.item.history.slice(-3).map((h: any) => h.text)).toEqual([
      "Publication FAILED: The website did not confirm the update within the time limit. Public website unchanged.",
      "Clicked Publish (attempt 1).",
      'Published v1 to the public "Healthcare" section, refreshed the page and verified it shows the approved content.',
    ]);
  });
  it("a second click while the publish is in progress is refused (nothing happens twice)", async () => {
    const id = await readyToPublish();
    await q("UPDATE cw_contributions SET status = 'publishing' WHERE id = $1", [id]);
    const r = await step(id, "publish");
    expect([r.status, r.b.error]).toEqual([409, "NOT_ALLOWED"]);
    expect(await cards()).toBe(0);
  });
  it("a minor is shown by first name only on the public card", async () => {
    await q("UPDATE users SET age_category = 'minor' WHERE id = $1", [member.id]);
    const id = await readyToPublish();
    await step(id, "publish");
    expect((await publicItems())[0].contributor).toEqual({ name: "Asha", type: "" });
  });
  it("drafts and pending requests are never public; the public API needs no sign-in and is never cached", async () => {
    await submit({ title: "A draft idea" }); const pend = await submit({ title: "A pending idea" }); as(mod); await step(pend, "send_request");
    who.id = null;
    const r = await publicRoute.GET(new Request("http://localhost/api/cw/public"));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(((await r.json()) as any).items).toEqual([]);
  });
});
