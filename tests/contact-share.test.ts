// Item 3: the Contribute form's one contact box, "Let moderators contact me using my profile details" (migration 021).
// Saved with the contribution; a flagged moderator sees the PROFILE contact only when it is ticked; nobody else ever does; contact
// details from the old form are kept and keep their own rule. In-process database with the real migrations and routes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
const who: { id: string | null } = { id: null };
vi.mock("../src/lib/currentUser", () => ({
  getCurrentUser: async () => (who.id ? { id: who.id, fullName: "Someone", email: "s@example.com", role: "ST" } : null),
  firstNameOf: () => "Someone",
}));

import * as create from "../src/app/api/contributions/route";
import * as one from "../src/app/api/contributions/[id]/route";
import { READ_PROFILE_CONTACT_SQL, readContact, readShareChoice } from "../src/lib/contributionContacts";
import { exportCsv, getForReview } from "../src/lib/contributionReview";

const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
let seq = 0, ipn = 0;
const ip = () => `44.${Math.floor(++ipn / 250)}.${ipn % 250}.1`;
async function user(role: string, opts: { moderator?: boolean; mobile?: string | null } = {}) {
  const u = await seedUser({ email: `c${++seq}@example.com`, role, fullName: `Asha${seq} Rao` });
  if (opts.moderator) await q("UPDATE users SET is_moderator = true WHERE id = $1", [u.id]);
  if (opts.mobile !== undefined) await q("UPDATE users SET mobile = $2 WHERE id = $1", [u.id, opts.mobile]);
  return Number(u.id);
}
const as = (id: number) => { who.id = String(id); };
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const req = (method: string, body?: unknown) => new Request("http://localhost/x", { method, headers: { "x-forwarded-for": ip(), "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const draft = (over: Record<string, unknown> = {}) => ({ type: "resource", sectors: ["agriculture-dairy"], title: `Weekend robotics club ${++seq}`, description: "A free weekend club where students build simple robots.", role: "Teacher / lab in-charge", district: "", ...over });
const shared = async (id: number) => ((await q("SELECT share_contact_with_moderators AS s FROM contributions WHERE id = $1", [id])).rows[0] as any).s;
async function newItem(owner: number, body: Record<string, unknown> = {}) {
  as(owner);
  const r = await create.POST(req("POST", draft(body)));
  expect(r.status).toBe(201);
  const id = Number((await r.json()).id);
  await q("UPDATE contributions SET status = 'pending_review', submitted_at = now() WHERE id = $1", [id]);
  return id;
}

beforeEach(async () => { vi.spyOn(console, "error").mockImplementation(() => undefined); await q("DELETE FROM api_rate_limits"); });
afterEach(() => { vi.restoreAllMocks(); testDb().failOn(undefined); });

describe("saving the box", () => {
  it("only an exact true ticks it; absent means an older form (leave it as it is)", () => {
    expect(readShareChoice({ shareContact: true })).toBe(true);
    for (const v of [false, "true", 1, "yes", null]) expect(readShareChoice({ shareContact: v })).toBe(false);
    expect(readShareChoice({})).toBeUndefined(); expect(readShareChoice(null)).toBeUndefined();
  });
  it("is saved with the contribution, off by default, changed by an edit, and returned to its owner for Edit", async () => {
    const owner = await user("TC");
    as(owner);
    const off = Number((await (await create.POST(req("POST", draft()))).json()).id);
    expect(await shared(off)).toBe(false);
    const on = Number((await (await create.POST(req("POST", draft({ shareContact: true })))).json()).id);
    expect(await shared(on)).toBe(true);
    expect((await one.PATCH(req("PATCH", draft({ shareContact: false })), ctx(on))).status).toBe(200);
    expect(await shared(on)).toBe(false);
    expect((await one.PATCH(req("PATCH", draft({ shareContact: true })), ctx(on))).status).toBe(200);
    expect((await one.PATCH(req("PATCH", draft()), ctx(on))).status).toBe(200); // an older form sends nothing: unchanged
    expect(await shared(on)).toBe(true);
    const got = await (await one.GET(req("GET"), ctx(on))).json();
    expect(got.contribution.shareContact).toBe(true);
    expect((await (await one.GET(req("GET"), ctx(off))).json()).contribution.shareContact).toBe(false);
  });
  it("before migration 021 the box is not saved (counts as 'not shared') and the contribution still saves", async () => {
    const owner = await user("TC"); as(owner);
    testDb().failOn((sql) => (/share_contact_with_moderators/.test(sql) ? Object.assign(new Error("column \"share_contact_with_moderators\" does not exist"), { code: "42703" }) : undefined));
    const r = await create.POST(req("POST", draft({ shareContact: true })));
    expect(r.status).toBe(201);
    const id = Number((await r.json()).id);
    expect((await one.GET(req("GET"), ctx(id))).status).toBe(200);
    expect((await (await one.GET(req("GET"), ctx(id))).json()).contribution.shareContact).toBe(false);
    testDb().failOn(undefined);
    expect(await shared(id)).toBe(false);
  });
});

describe("who sees the profile contact", () => {
  it("a flagged moderator, only when ticked: the contributor's profile name, email and mobile", async () => {
    const author = await user("ST", { mobile: "9876543210" }), mod = await user("TC", { moderator: true });
    const yes = await newItem(author, { shareContact: true }), no = await newItem(author, { shareContact: false });
    const a = (await q("SELECT full_name, email FROM users WHERE id = $1", [author])).rows[0] as any;
    const c = await readContact(testDb().raw as never, yes, mod);
    expect(c).toEqual({ name: a.full_name, email: a.email, phone: "9876543210", shareWithModerators: true, source: "profile" });
    expect(await readContact(testDb().raw as never, no, mod)).toBeNull();
  });
  it("nobody else: not an administrator without the flag, not another member, not a visitor (id 0); the author does not need it", async () => {
    const author = await user("ST", { mobile: "9876543210" }), admin = await user("admin"), other = await user("TC");
    const id = await newItem(author, { shareContact: true });
    for (const viewer of [admin, other, 0, author]) expect(await readContact(testDb().raw as never, id, viewer), String(viewer)).toBeNull();
  });
  it("the rule is in the SQL: the box, a different person, and a moderator flag read from the database", () => {
    expect(READ_PROFILE_CONTACT_SQL).toContain("c.share_contact_with_moderators");
    expect(READ_PROFILE_CONTACT_SQL).toContain("c.user_id <> $2");
    expect(READ_PROFILE_CONTACT_SQL).toContain("EXISTS (SELECT 1 FROM users m WHERE m.id = $2 AND m.is_moderator)");
    expect(READ_PROFILE_CONTACT_SQL).not.toMatch(/password|profile ->|district/);
  });
  it("details from the old form are kept and keep their own rule (shown as typed into the form); the box wins when both exist", async () => {
    const author = await user("ST"), mod = await user("TC", { moderator: true });
    const old = await newItem(author);
    await q("INSERT INTO contribution_contacts (contribution_id, contact_name, email, share_with_moderators) VALUES ($1, 'Typed Name', 'typed@example.com', true)", [old]);
    expect(await readContact(testDb().raw as never, old, mod)).toMatchObject({ name: "Typed Name", source: "form" });
    expect(await readContact(testDb().raw as never, old, author)).toMatchObject({ name: "Typed Name", source: "form" }); // the owner, as before
    await q("UPDATE contributions SET share_contact_with_moderators = true WHERE id = $1", [old]);
    expect(await readContact(testDb().raw as never, old, mod)).toMatchObject({ source: "profile" });
  });
  it("the moderator's page and CSV show it (and say where it came from); an administrator without the flag gets neither", async () => {
    const author = await user("ST", { mobile: "9123456780" }), mod = await user("TC", { moderator: true }), admin = await user("admin");
    const id = await newItem(author, { shareContact: true });
    const item = await getForReview(testDb().raw as never, mod, id, false);
    expect(item!.contact).toMatchObject({ phone: "9123456780", source: "profile" });
    expect((await getForReview(testDb().raw as never, admin, id, true))!.contact).toBeNull();
    const csv = (await exportCsv(testDb().raw as never, mod, "agriculture-dairy", { tab: "all" }))!.csv;
    expect(csv).toContain("9123456780");
    expect((await exportCsv(testDb().raw as never, admin, "agriculture-dairy", { tab: "all" }))!.csv).not.toContain("9123456780");
  });
  it("before migration 021, only the old form's details can show (no error)", async () => {
    const author = await user("ST"), mod = await user("TC", { moderator: true });
    const id = await newItem(author);
    testDb().failOn((sql) => (/share_contact_with_moderators/.test(sql) ? Object.assign(new Error("missing"), { code: "42703" }) : undefined));
    expect(await readContact(testDb().raw as never, id, mod)).toBeNull();
  });
});
