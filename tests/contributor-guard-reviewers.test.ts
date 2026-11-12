// Reviewers review, members contribute (portal PR1): every contribution WRITE route answers 403 REVIEWER_CANNOT_CONTRIBUTE to an
// administrator or a flagged moderator, before anything is read or stored; members are unaffected; reading your own items stays open.
// In-process database with the real migrations and the real routes; no real database.
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
import * as photos from "../src/app/api/contributions/[id]/photos/route";
import * as contact from "../src/app/api/contributions/[id]/contact/route";
import * as submitRoute from "../src/app/api/contributions/[id]/submit/route";
import * as mineRoute from "../src/app/api/contributions/mine/route";
import { REVIEWER_CANNOT_CONTRIBUTE } from "../src/lib/contributorGuard";

const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
let seq = 0, ipn = 0;
const ip = () => `32.${Math.floor(++ipn / 250)}.${ipn % 250}.1`;
async function user(role: string, moderator = false) { const u = await seedUser({ email: `g${++seq}@example.com`, role, fullName: `Person ${seq}` }); if (moderator) await q("UPDATE users SET is_moderator = true WHERE id = $1", [u.id]); return Number(u.id); }
const as = (id: number) => { who.id = String(id); };
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const req = (method: string, body?: unknown) => new Request("http://localhost/x", { method, headers: { "x-forwarded-for": ip(), "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const formReq = () => { const f = new FormData(); f.set("alt", "A photo"); return new Request("http://localhost/x", { method: "POST", headers: { "x-forwarded-for": ip() }, body: f }); };
const DRAFT = { type: "problem", sectors: ["agriculture-dairy"], title: "Milking by hand takes hours", description: "Cows are milked by hand every morning and it takes hours.", role: "Farmer", district: "Guntur" };
const count = async () => Number(((await q("SELECT count(*)::int n FROM contributions")).rows[0] as any).n);

/** Every write route, against one existing item id. */
const WRITES = (id: number): [string, () => Promise<Response>][] => [
  ["POST /api/contributions", () => create.POST(req("POST", DRAFT))],
  ["PATCH /api/contributions/[id]", () => one.PATCH(req("PATCH", DRAFT), ctx(id))],
  ["DELETE /api/contributions/[id]", () => one.DELETE(req("DELETE"), ctx(id))],
  ["POST /api/contributions/[id]/photos", () => photos.POST(formReq(), ctx(id))],
  ["DELETE /api/contributions/[id]/photos", () => photos.DELETE(req("DELETE", { photoId: 1 }), ctx(id))],
  ["PUT /api/contributions/[id]/contact", () => contact.PUT(req("PUT", { name: "Asha", email: "a@example.com", phone: null, shareWithModerators: false }), ctx(id))],
  ["DELETE /api/contributions/[id]/contact", () => contact.DELETE(req("DELETE"), ctx(id))],
  ["POST /api/contributions/[id]/submit", () => submitRoute.POST(req("POST"), ctx(id))],
];

beforeEach(async () => { vi.spyOn(console, "error").mockImplementation(() => undefined); await q("DELETE FROM api_rate_limits"); });
afterEach(() => { vi.restoreAllMocks(); });

describe("administrators and moderators cannot contribute", () => {
  for (const [label, role, moderator] of [["an administrator", "admin", false], ["a flagged moderator", "TC", true]] as const) {
    it(`${label} gets 403 REVIEWER_CANNOT_CONTRIBUTE on every write route, and nothing is stored or changed`, async () => {
      const reviewer = await user(role, moderator);
      const id = Number(((await q("INSERT INTO contributions (user_id, type, title, body) VALUES ($1,'problem','An old draft of theirs','A body that is long enough here.') RETURNING id", [reviewer])).rows[0] as any).id);
      as(reviewer);
      for (const [name, call] of WRITES(id)) {
        const r = await call();
        expect(r.status, name).toBe(403);
        const b = await r.json();
        expect(b.error, name).toBe("REVIEWER_CANNOT_CONTRIBUTE");
        expect(b.message, name).toBe(REVIEWER_CANNOT_CONTRIBUTE);
      }
      expect(await count()).toBe(1); // only the draft made directly above
      expect(((await q("SELECT status, title FROM contributions WHERE id=$1", [id])).rows[0] as any)).toMatchObject({ status: "draft", title: "An old draft of theirs" });
    });
  }
  it("a moderator can still READ their own items (My Contributions and their own item)", async () => {
    const mod = await user("TC", true);
    const id = Number(((await q("INSERT INTO contributions (user_id, type, title, body) VALUES ($1,'problem','Written before the flag','A body that is long enough here.') RETURNING id", [mod])).rows[0] as any).id);
    as(mod);
    const m = await mineRoute.GET(req("GET"));
    expect(m.status).toBe(200);
    expect((await m.json()).items.map((x: any) => x.id)).toEqual([id]);
    expect((await one.GET(req("GET"), ctx(id))).status).toBe(200);
  });
  it("the flag is read on every call: removing it lets the person contribute again", async () => {
    const mod = await user("TC", true);
    as(mod);
    expect((await create.POST(req("POST", DRAFT))).status).toBe(403);
    await q("UPDATE users SET is_moderator = false WHERE id = $1", [mod]);
    expect((await create.POST(req("POST", DRAFT))).status).toBe(201);
  });
});

describe("members are unaffected", () => {
  it("a member creates, edits and submits as before", async () => {
    const member = await user("ST");
    as(member);
    const c = await create.POST(req("POST", DRAFT));
    expect(c.status).toBe(201);
    const id = Number((await c.json()).id);
    expect((await one.PATCH(req("PATCH", { ...DRAFT, title: "Milking by hand takes many hours" }), ctx(id))).status).toBe(200);
    const s = await submitRoute.POST(req("POST"), ctx(id));
    expect(s.status).toBe(200);
    expect((await s.json()).status).toBe("pending_review");
  });
});
