// Published and Unpublished contributions are read-only for their owner (owner decision 16-11-2026): no edit, no resend, no photo
// or contact change, through every route. Editing stays open while it is a draft, Pending review or Changes requested.
// Every role: signed out, the owner (a member), another member, a moderator and an administrator. In-process database, real routes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
const who: { id: string | null; role: string } = { id: null, role: "ST" };
vi.mock("../src/lib/currentUser", () => ({
  getCurrentUser: async () => (who.id ? { id: who.id, fullName: "Test Person", email: "t@example.com", role: who.role } : null),
  firstNameOf: () => "Test",
}));

import * as one from "../src/app/api/contributions/[id]/route";
import * as submit from "../src/app/api/contributions/[id]/submit/route";
import * as photos from "../src/app/api/contributions/[id]/photos/route";
import * as contact from "../src/app/api/contributions/[id]/contact/route";
import * as mine from "../src/app/api/contributions/mine/route";
import { EDITABLE_STATUSES, OWNER_RULES, notEditable } from "../src/lib/contributionApi";

const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
let ipn = 0, seq = 0;
const ip = () => `21.${Math.floor(++ipn / 250) % 250}.${ipn % 250}.1`;
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
type Handler = (r: Request, c: unknown) => Promise<Response>;
const send = async (h: unknown, method: string, url: string, id: number, body?: unknown) => {
  const init: RequestInit = { method, headers: { "x-forwarded-for": ip(), ...(body instanceof FormData ? {} : { "content-type": "application/json" }) } };
  if (body !== undefined) init.body = body instanceof FormData ? body : JSON.stringify(body);
  const r = await (h as Handler)(new Request("http://localhost" + url, init), ctx(id));
  return { status: r.status, b: (await r.json()) as any };
};
const seg = (m: number, p: Buffer) => Buffer.concat([Buffer.from([0xff, m, (p.length + 2) >> 8, (p.length + 2) & 255]), p]);
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0")), seg(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0])), seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])), Buffer.from([0x12, 0x34, 0xff, 0xd9])]);
const photoForm = (alt = "A photo of the milking shed") => { const f = new FormData(); f.set("photo", new File([new Uint8Array(jpeg())], "p.jpg", { type: "image/jpeg" })); f.set("alt", alt); return f; };
const edit = (id: number) => send(one.PATCH, "PATCH", `/api/contributions/${id}`, id, { type: "problem", sectors: ["agriculture-dairy"], title: `Edited title ${++seq} for the test`, description: `Edited text that is long enough for the rules ${seq}` });
const resend = (id: number) => send(submit.POST, "POST", `/api/contributions/${id}/submit`, id);
const addPhoto = (id: number) => send(photos.POST, "POST", `/api/contributions/${id}/photos`, id, photoForm());
const removePhoto = (id: number, photoId: number) => send(photos.DELETE, "DELETE", `/api/contributions/${id}/photos?photoId=${photoId}`, id);
const setContact = (id: number) => send(contact.PUT, "PUT", `/api/contributions/${id}/contact`, id, { name: "Asha Rao", email: "asha@example.com", phone: "9876543210", shareWithModerators: false });
const dropContact = (id: number) => send(contact.DELETE, "DELETE", `/api/contributions/${id}/contact`, id);
const listMine = async () => { const r = await (mine.GET as never as (r: Request) => Promise<Response>)(new Request("http://localhost/api/contributions/mine", { headers: { "x-forwarded-for": ip() } })); return (await r.json()) as any; };
const readOwn = (id: number) => send(one.GET, "GET", `/api/contributions/${id}`, id);

async function member(role = "ST") { const u = await seedUser({ email: `o${++seq}@example.com`, role, fullName: `Owner ${seq}` }); return Number(u.id); }
const signIn = (id: number | null, role = "ST") => { who.id = id === null ? null : String(id); who.role = role; };
/** One contribution of `owner` in `status`, with one photo and one contact row, made while it was a draft. */
async function item(owner: number, status: string) {
  const id = Number(((await q("INSERT INTO contributions (user_id, type, title, body) VALUES ($1,'problem',$2,'A description that is long enough to be valid here.') RETURNING id", [owner, `Read-only check ${++seq}`])).rows[0] as any).id);
  await q("INSERT INTO contribution_scopes (contribution_id, sector_id) SELECT $1, id FROM sectors WHERE slug = 'agriculture-dairy'", [id]);
  signIn(owner); expect((await addPhoto(id)).status).toBe(201);
  await q("INSERT INTO contribution_contacts (contribution_id, contact_name, email, share_with_moderators) VALUES ($1,'Old Name','old@example.com',false)", [id]);
  if (status !== "draft") await q("UPDATE contributions SET status = $2::varchar, submitted_at = now(), published_at = CASE WHEN $2::varchar = 'published' THEN now() END WHERE id = $1", [id, status]);
  return id;
}
const snapshot = async (id: number) => JSON.stringify((await q(
  "SELECT c.status, c.title, c.body, c.published_at IS NOT NULL AS pub, (SELECT count(*) FROM contribution_photos p WHERE p.contribution_id = c.id) AS photos, " +
  "(SELECT json_agg(cc) FROM contribution_contacts cc WHERE cc.contribution_id = c.id) AS contact FROM contributions c WHERE c.id = $1", [id])).rows[0]);
const photoOf = async (id: number) => Number(((await q("SELECT id FROM contribution_photos WHERE contribution_id = $1 LIMIT 1", [id])).rows[0] as any).id);

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", "unit-test-secret-unit-test-secret-1234");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  signIn(null);
  await q("DELETE FROM api_rate_limits");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); testDb().failOn(undefined); });

describe("the rule", () => {
  it("Published and Unpublished: no edit, no resend, no delete; editing stays open for draft, Pending review and Changes requested", () => {
    expect(OWNER_RULES.published).toEqual({ edit: null, submit: false, deleteIt: false });
    expect(OWNER_RULES.unpublished).toEqual({ edit: null, submit: false, deleteIt: false });
    expect([...EDITABLE_STATUSES].sort()).toEqual(["changes_requested", "draft", "pending_review"]);
    expect(notEditable("published").message).toBe("This contribution is published, so it can no longer be changed. To add something, start a new contribution.");
    expect(notEditable("unpublished").message).toBe("This contribution was taken down by an administrator, so it can no longer be changed. You can start a new one.");
  });
});

describe("the owner (a member)", () => {
  for (const status of ["published", "unpublished"]) {
    it(`${status}: every change is refused with 409 and a plain reason, and nothing changes (status, text, photo, contact)`, async () => {
      const owner = await member(); const id = await item(owner, status); const pid = await photoOf(id);
      const before = await snapshot(id);
      signIn(owner);
      for (const [what, r] of [["edit", await edit(id)], ["add photo", await addPhoto(id)], ["remove photo", await removePhoto(id, pid)], ["save contact", await setContact(id)], ["remove contact", await dropContact(id)]] as const) {
        expect([r.status, r.b.error], `${status} ${what}`).toEqual([409, "NOT_EDITABLE"]);
        expect(r.b.message, what).toBe(notEditable(status).message);
      }
      const s = await resend(id);
      expect([s.status, s.b.error]).toEqual([409, "NOT_SUBMITTABLE"]);
      expect(s.b.message).toBe(status === "published" ? "This contribution is already published." : "This contribution was taken down by an administrator, so it cannot be sent again. You can start a new one.");
      expect(await snapshot(id)).toBe(before);
    });
  }

  it("My Contributions and the item itself say it cannot be edited (the Edit links follow this)", async () => {
    const owner = await member(); const p = await item(owner, "published"), u = await item(owner, "unpublished"), c = await item(owner, "changes_requested"), w = await item(owner, "pending_review");
    signIn(owner);
    const byId = Object.fromEntries((await listMine()).items.map((i: any) => [i.id, i.canEdit]));
    expect(byId).toEqual({ [p]: false, [u]: false, [c]: true, [w]: true });
    expect((await readOwn(p)).b.contribution.editable).toBe(false);
    expect((await readOwn(u)).b.contribution.editable).toBe(false);
    expect((await readOwn(c)).b.contribution.editable).toBe(true);
  });

  it("still editable: Changes requested, Pending review and drafts (edit, photos, contact); Changes requested can be sent again", async () => {
    const owner = await member();
    for (const status of ["changes_requested", "pending_review", "draft"]) {
      await q("DELETE FROM api_rate_limits"); // photos have their own low per-user rate; each status starts fresh
      const id = await item(owner, status); const pid = await photoOf(id);
      signIn(owner);
      const e = await edit(id);
      expect(e.status, status).toBe(200);
      expect(e.b.status, status).toBe(status); // the status stays what it was (Changes requested is sent with Submit)
      expect((await removePhoto(id, pid)).status, status).toBe(200);
      expect((await addPhoto(id)).status, status).toBe(201);
      expect((await setContact(id)).status, status).toBe(200);
      expect((await dropContact(id)).status, status).toBe(200);
    }
    const c = await item(owner, "changes_requested");
    signIn(owner);
    expect((await resend(c)).b.status).toBe("pending_review");
  });

  it("a published item stays in the public numbers: an attempted edit no longer takes it out", async () => {
    const owner = await member(); const id = await item(owner, "published");
    signIn(owner); await edit(id); await addPhoto(id);
    expect(((await q("SELECT status, published_at IS NOT NULL AS pub FROM contributions WHERE id = $1", [id])).rows[0])).toEqual({ status: "published", pub: true });
  });
});

describe("everyone else", () => {
  it("signed out: 401 for every change, nothing changes", async () => {
    const owner = await member(); const id = await item(owner, "published"); const pid = await photoOf(id); const before = await snapshot(id);
    signIn(null);
    for (const r of [await edit(id), await resend(id), await addPhoto(id), await removePhoto(id, pid), await setContact(id), await dropContact(id)]) expect(r.status).toBe(401);
    expect(await snapshot(id)).toBe(before);
  });

  it("another member: 404 for someone else's item, whatever its status (nobody learns it exists)", async () => {
    const owner = await member(); const p = await item(owner, "published"), c = await item(owner, "changes_requested");
    signIn(await member());
    for (const id of [p, c]) for (const r of [await edit(id), await resend(id), await addPhoto(id), await setContact(id), await dropContact(id)]) expect(r.status, String(id)).toBe(404);
  });

  it("a moderator and an administrator cannot change a member's item at all (403: reviewers do not contribute)", async () => {
    const owner = await member(); const id = await item(owner, "published"); const before = await snapshot(id);
    const mod = await member("TC"); await q("UPDATE users SET is_moderator = true WHERE id = $1", [mod]);
    const admin = await member("admin");
    for (const [uid, role] of [[mod, "TC"], [admin, "admin"]] as const) {
      signIn(uid, role);
      for (const r of [await edit(id), await resend(id), await addPhoto(id), await setContact(id), await dropContact(id)]) expect([r.status, r.b.error], role).toEqual([403, "REVIEWER_CANNOT_CONTRIBUTE"]);
    }
    expect(await snapshot(id)).toBe(before);
  });
});
