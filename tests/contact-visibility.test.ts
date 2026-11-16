// Who sees a contributor's contact details (owner's decision, 16-11-2026): an ADMINISTRATOR sees everything a moderator sees, contact
// details included, even without the moderator flag; a MODERATOR sees them; a MEMBER and a SIGNED-OUT visitor never do. Contact details
// show only when the contributor shared them: the new form's box (profile contact) or the old form's "share with moderators" box.
// Through the real routes (item detail and CSV) on the in-process database; no real database.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
const who: { id: string | null } = { id: null };
vi.mock("../src/lib/currentUser", () => ({
  getCurrentUser: async () => (who.id ? { id: who.id, fullName: "Someone", email: "s@example.com", role: "ST" } : null), // the real role is read from the database
  firstNameOf: () => "Someone",
}));

import * as detail from "../src/app/api/review/[id]/route";
import * as exportRoute from "../src/app/api/review/export/route";

const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
let seq = 0, ipn = 0;
const ip = () => `66.${Math.floor(++ipn / 250)}.${ipn % 250}.1`;
const req = (url: string) => new Request("http://localhost" + url, { headers: { "x-forwarded-for": ip() } });
const P = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
async function user(role: string, moderator = false, mobile = "9000000000") {
  const u = await seedUser({ email: `v${++seq}@example.com`, role, fullName: `Viewer${seq} Person` });
  await q("UPDATE users SET is_moderator = $2, mobile = $3 WHERE id = $1", [u.id, moderator, mobile]);
  return Number(u.id);
}
async function item(owner: number, title: string, share: boolean) {
  const id = Number(((await q("INSERT INTO contributions (user_id, type, title, body, share_contact_with_moderators) VALUES ($1,'resource',$2,'A long enough description.',$3) RETURNING id", [owner, title, share])).rows[0] as any).id);
  await q("INSERT INTO contribution_scopes (contribution_id, sector_id) SELECT $1, id FROM sectors WHERE slug='agriculture-dairy'", [id]);
  await q("UPDATE contributions SET status='pending_review', submitted_at=now() WHERE id=$1", [id]);
  return id;
}
const as = (id: number | null) => { who.id = id === null ? null : String(id); };
const itemContact = async (id: number) => { const r = await detail.GET(req(`/api/review/${id}`), P(id)); return { status: r.status, contact: r.status === 200 ? (await r.json()).item.contact : undefined }; };
const csv = async () => { const r = await exportRoute.GET(req("/api/review/export?sector=agriculture-dairy&tab=all")); return { status: r.status, text: r.status === 200 ? await r.text() : "" }; };

let author: number, admin: number, moderator: number, member: number, boxTicked: number, boxNot: number, oldShared: number, oldPrivate: number;
beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await q("DELETE FROM api_rate_limits");
  author = await user("ST", false, "9123456780");
  admin = await user("admin"); moderator = await user("TC", true); member = await user("TC");
  boxTicked = await item(author, "Profile contact shared", true);
  boxNot = await item(author, "Profile contact not shared", false);
  oldShared = await item(author, "Old form, shared", false);
  oldPrivate = await item(author, "Old form, private", false);
  await q("INSERT INTO contribution_contacts (contribution_id, contact_name, email, share_with_moderators) VALUES ($1,'Typed Shared','typed-shared@example.com',true),($2,'Typed Private','typed-private@example.com',false)", [oldShared, oldPrivate]);
});
afterEach(() => { vi.restoreAllMocks(); as(null); });

describe("contact details by viewer", () => {
  for (const [label, get] of [["an administrator (no moderator flag)", () => admin], ["a moderator", () => moderator]] as const) {
    it(`${label}: sees the shared profile contact and the shared typed contact, never an unshared one, on the item and in the CSV`, async () => {
      as(get());
      expect(await itemContact(boxTicked)).toMatchObject({ status: 200, contact: { phone: "9123456780", source: "profile" } });
      expect(await itemContact(oldShared)).toMatchObject({ status: 200, contact: { name: "Typed Shared", email: "typed-shared@example.com", source: "form" } });
      expect(await itemContact(boxNot)).toEqual({ status: 200, contact: null });
      expect(await itemContact(oldPrivate)).toEqual({ status: 200, contact: null });
      const c = await csv();
      expect(c.status).toBe(200);
      expect(c.text).toContain("9123456780"); expect(c.text).toContain("typed-shared@example.com");
      expect(c.text).not.toContain("typed-private@example.com");
    });
  }
  it("a member: no access to items or the CSV at all (403), so no contact details", async () => {
    as(member);
    for (const id of [boxTicked, oldShared]) expect((await itemContact(id)).status).toBe(403);
    const c = await csv();
    expect(c.status).toBe(403); expect(c.text).toBe("");
  });
  it("signed out: 401 for items and the CSV, so no contact details", async () => {
    as(null);
    for (const id of [boxTicked, oldShared]) expect((await itemContact(id)).status).toBe(401);
    expect((await csv()).status).toBe(401);
  });
});
