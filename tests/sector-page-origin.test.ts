// Edit keeps the way a contribution was started (decision 2 of 16-11-2026, migration 022: contributions.from_sector_page).
// The Contribute form says fromSectorPage: true when it was opened from a sector page; the app saves that once, when the contribution
// is created, never changes it, and returns it to the owner for Edit. In-process database with the real migrations and routes.
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
import { readFromSectorPage } from "../src/lib/contributionApi";

const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
let seq = 0, ipn = 0;
const ip = () => `45.${Math.floor(++ipn / 250)}.${ipn % 250}.1`;
async function user() {
  const u = await seedUser({ email: `o${++seq}@example.com`, role: "TC", fullName: `Ravi${seq} Kumar` });
  return Number(u.id);
}
const as = (id: number) => { who.id = String(id); };
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const req = (method: string, body?: unknown) => new Request("http://localhost/x", { method, headers: { "x-forwarded-for": ip(), "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const draft = (over: Record<string, unknown> = {}) => ({ type: "resource", sectors: ["agriculture-dairy"], title: `Village dairy robot ${++seq}`, description: "A small robot that helps clean the milking area every morning.", role: "Teacher / lab in-charge", district: "", ...over });
const stored = async (id: number) => ((await q("SELECT from_sector_page AS f FROM contributions WHERE id = $1", [id])).rows[0] as any).f;
async function make(body: Record<string, unknown>) {
  const r = await create.POST(req("POST", draft(body)));
  expect(r.status).toBe(201);
  return Number((await r.json()).id);
}
const forEdit = async (id: number) => (await (await one.GET(req("GET"), ctx(id))).json()).contribution;

beforeEach(async () => { vi.spyOn(console, "error").mockImplementation(() => undefined); await q("DELETE FROM api_rate_limits"); });
afterEach(() => { vi.restoreAllMocks(); testDb().failOn(undefined); who.id = null; });

describe("where a contribution was started", () => {
  it("only an exact true counts", () => {
    expect(readFromSectorPage({ fromSectorPage: true })).toBe(true);
    for (const v of [false, "true", 1, "yes", null, undefined]) expect(readFromSectorPage({ fromSectorPage: v })).toBe(false);
    expect(readFromSectorPage({})).toBe(false); expect(readFromSectorPage(null)).toBe(false); expect(readFromSectorPage([true])).toBe(false);
  });
  it("is saved when the contribution is created and returned to its owner for Edit; the general page (or an older form) is false", async () => {
    as(await user());
    const fromPage = await make({ fromSectorPage: true });
    const general = await make({ fromSectorPage: false });
    const older = await make({});
    expect([await stored(fromPage), await stored(general), await stored(older)]).toEqual([true, false, false]);
    expect((await forEdit(fromPage)).fromSectorPage).toBe(true);
    expect((await forEdit(general)).fromSectorPage).toBe(false);
    expect((await forEdit(older)).fromSectorPage).toBe(false);
  });
  it("an edit never changes it, whatever the form sends", async () => {
    as(await user());
    const fromPage = await make({ fromSectorPage: true });
    const general = await make({});
    expect((await one.PATCH(req("PATCH", draft({ fromSectorPage: false })), ctx(fromPage))).status).toBe(200);
    expect((await one.PATCH(req("PATCH", draft({ fromSectorPage: true })), ctx(general))).status).toBe(200);
    expect(await stored(fromPage)).toBe(true);
    expect(await stored(general)).toBe(false);
    // also after a reviewer sent it back for changes
    await q("UPDATE contributions SET status = 'changes_requested', submitted_at = now() WHERE id = ANY($1::int[])", [[fromPage, general]]);
    expect((await one.PATCH(req("PATCH", draft({ fromSectorPage: false })), ctx(fromPage))).status).toBe(200);
    expect((await forEdit(fromPage)).fromSectorPage).toBe(true);
  });
  it("nobody else can read it through Edit: another member gets 404, a visitor 401", async () => {
    const owner = await user();
    as(owner);
    const id = await make({ fromSectorPage: true });
    as(await user());
    expect((await one.GET(req("GET"), ctx(id))).status).toBe(404);
    who.id = null;
    expect((await one.GET(req("GET"), ctx(id))).status).toBe(401);
  });
  it("before migration 022 nothing is saved (Edit shows the list) and the contribution still saves and opens", async () => {
    as(await user());
    testDb().failOn((sql) => (/from_sector_page/.test(sql) ? Object.assign(new Error("column \"from_sector_page\" does not exist"), { code: "42703" }) : undefined));
    const id = await make({ fromSectorPage: true });
    const got = await one.GET(req("GET"), ctx(id));
    expect(got.status).toBe(200);
    expect((await got.json()).contribution.fromSectorPage).toBe(false);
    testDb().failOn(undefined);
    expect(await stored(id)).toBe(false);
  });
});
