// Contribution workflow, Phase 1: the contributor side of the API on a real (in-process) database with migration 027.
// Submitting creates RV-1025 (Submitted, one history line, not public); every rule is checked again on the server; name and type come
// from the profile; the attachment's real type is read from its bytes; reviewers cannot contribute; the member's own list.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
const who: { id: string | null; role: string } = { id: null, role: "ST" };
vi.mock("../src/lib/currentUser", () => ({
  getCurrentUser: async () => (who.id ? { id: who.id, fullName: "ignored", email: "t@example.com", role: who.role } : null),
  firstNameOf: () => "Test",
}));

import * as submitRoute from "../src/app/api/cw/contributions/route";
import * as mineRoute from "../src/app/api/cw/mine/route";
import * as meRoute from "../src/app/api/cw/me/route";
import * as configRoute from "../src/app/api/cw/form-config/route";
import { MESSAGES } from "../public/cw/js/lists.js";

const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
let n = 0;
const ip = () => `33.${Math.floor(++n / 250) % 250}.${n % 250}.1`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const PDF = new TextEncoder().encode("%PDF-1.4\n%fake but starts right\n");
const good = (over: Record<string, unknown> = {}) => ({ kind: "New idea", refers: false, title: "Robot that picks up plastic from beaches", description: "A small robot that drives on the beach and picks up plastic.", sector: "not-sure", robotType: "not-sure", categories: ["Robotics"], suitableFor: ["K6–K8"], learningPath: "Make", references: [], resource: {}, ...over });

async function send(data: unknown, file?: { bytes: Uint8Array; name: string; type?: string }, headers: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append("data", typeof data === "string" ? data : JSON.stringify(data));
  if (file) fd.append("attachment", new File([file.bytes as BlobPart], file.name, { type: file.type ?? "application/octet-stream" }));
  const r = await submitRoute.POST(new Request("http://localhost/api/cw/contributions", { method: "POST", body: fd, headers: { "x-forwarded-for": ip(), ...headers } }));
  return { status: r.status, b: (await r.json()) as any };
}
const get = async (fn: (r: Request) => Promise<Response>, path: string) => {
  const r = await fn(new Request("http://localhost" + path, { headers: { "x-forwarded-for": ip() } }));
  return { status: r.status, b: (await r.json()) as any, cache: r.headers.get("cache-control") };
};
async function member(over: Record<string, unknown> = {}) {
  const u = await seedUser({ email: `m${++n}@example.com`, role: "TC", fullName: "Ananya Rao", ...over });
  who.id = u.id; who.role = String(u.role);
  return Number(u.id);
}

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  who.id = null;
  await q("DELETE FROM api_rate_limits");
  await q("INSERT INTO sectors (slug, name, sort_order) VALUES ('healthcare','Healthcare',30) ON CONFLICT DO NOTHING");
  const agri = (await q("SELECT id FROM sectors WHERE slug = 'agriculture-dairy'")).rows[0] as any;
  await q("INSERT INTO sector_robot_types (sector_id, slug, name, sort_order, is_active) VALUES ($1,'weeding-robots','Weeding robots',10,true), ($1,'old-robot','Old robot',20,false) ON CONFLICT DO NOTHING", [agri.id]);
});
afterEach(() => { vi.restoreAllMocks(); testDb().failOn(undefined); });

describe("submitting (acceptance 1)", () => {
  it("creates RV-1025 as Submitted with exactly one history entry; proposed starts as a copy of original; nothing public", async () => {
    await member();
    const r = await send(good());
    expect(r.status).toBe(201);
    expect(r.b).toEqual({ success: true, id: 1025, code: "RV-1025", kind: "New idea" });
    const row = (await q("SELECT status, original, proposed, contributor_name, contributor_type, contributor_minor, resource FROM cw_contributions WHERE id = 1025")).rows[0] as any;
    expect(row.status).toBe("submitted");
    expect(row.proposed).toEqual(row.original);
    expect(row.original).toMatchObject({ title: "Robot that picks up plastic from beaches", categories: ["Robotics"], sector: "not-sure" });
    expect(row.resource).toBeNull();
    expect([row.contributor_name, row.contributor_type, row.contributor_minor]).toEqual(["Ananya Rao", "TC", false]);
    const h = (await q("SELECT actor, text FROM cw_contribution_history WHERE contribution_id = 1025")).rows;
    expect(h).toEqual([{ actor: "Ananya Rao (Teacher / lab in-charge)", text: "Submitted through the contribution form: New idea." }]);
    expect(Number(((await q("SELECT count(*)::int n FROM cw_public_contributions")).rows[0] as any).n)).toBe(0);
    expect((await send(good({ title: "Another idea from the same member" }))).b.code).toBe("RV-1026");
  });
  it("a change to something existing stores the resource (with its auto ID) and the references, and says so in history", async () => {
    await member();
    const r = await send(good({ kind: "Enhancement of existing feature", sector: "agriculture-dairy", robotType: "weeding-robots",
      resource: { feature: "Robots by Sector", type: "Robot type", path: "Robots by Sector › Agriculture & Dairy › Weeding robots", url: "https://techytree.in/x", change: "Add a cost band.", id: "forged" },
      references: [{ url: "https://example.com/a", remarks: "comparison" }, { url: "", remarks: "" }] }));
    expect(r.status).toBe(201);
    const row = (await q("SELECT resource, reference_links FROM cw_contributions WHERE id = $1", [r.b.id])).rows[0] as any;
    expect(row.resource).toEqual({ feature: "Robots by Sector", type: "Robot type", path: "Robots by Sector › Agriculture & Dairy › Weeding robots", url: "https://techytree.in/x", change: "Add a cost band.", id: "rv_robot_type · weeding-robots" });
    expect(row.reference_links).toEqual([{ url: "https://example.com/a", remarks: "comparison" }]);
    expect(((await q("SELECT text FROM cw_contribution_history WHERE contribution_id = $1", [r.b.id])).rows[0] as any).text)
      .toBe('Submitted through the contribution form: Enhancement of existing feature on "Robots by Sector › Agriculture & Dairy › Weeding robots" with 1 reference link(s).');
  });
  it("name and type always come from the profile, never from the form; a minor is remembered for the public card", async () => {
    await member({ fullName: "Ravi Teja", role: "ST", ageCategory: "minor" });
    const r = await send({ ...good(), name: "Someone Else", type: "Admin" });
    expect(r.status).toBe(201);
    expect((await q("SELECT contributor_name, contributor_type, contributor_minor FROM cw_contributions WHERE id = $1", [r.b.id])).rows[0]).toEqual({ contributor_name: "Ravi Teja", contributor_type: "ST", contributor_minor: true });
  });
});

describe("the server repeats every check, with the same messages (acceptance 3)", () => {
  it("returns all problems together and stores nothing", async () => {
    await member();
    const r = await send({ kind: "Suggestion", title: "", description: "", resource: { feature: "Robots by Sector", type: "Robot type", path: "", url: "x", change: "" }, references: [{ url: "", remarks: "r" }, { url: "bad", remarks: "" }] });
    expect(r.status).toBe(400);
    expect(r.b.message.split("\n").slice(0, 6)).toEqual([MESSAGES.required, MESSAGES.resourcePath, MESSAGES.resourceUrl, MESSAGES.change, MESSAGES.refRemark, MESSAGES.refUrl]);
    expect(Number(((await q("SELECT count(*)::int n FROM cw_contributions")).rows[0] as any).n)).toBe(0);
  });
  it("a sector's robot type must be one that is on in Sector Forms; an unknown sector or category is refused", async () => {
    await member();
    expect((await send(good({ sector: "agriculture-dairy", robotType: "old-robot" }))).b.message).toBe(MESSAGES.badChoice);
    expect((await send(good({ sector: "atlantis" }))).status).toBe(400);
    expect((await send(good({ categories: ["Gardening"] }))).status).toBe(400);
    expect((await send(good({ sector: "agriculture-dairy", robotType: "weeding-robots" }))).status).toBe(201);
  });
});

describe("the attachment (4 MB, JPEG, PNG or PDF, real type from the bytes, private)", () => {
  it("stores a real PNG and a real PDF with their real type and a hash", async () => {
    await member();
    const a = await send(good(), { bytes: PNG, name: "sketch.png", type: "image/png" });
    const b = await send(good({ title: "A second idea with a plan" }), { bytes: PDF, name: "../../etc/plan.pdf", type: "text/plain" });
    expect([a.status, b.status]).toEqual([201, 201]);
    const rows = (await q("SELECT contribution_id, file_name, mime, byte_size, file_sha256 FROM cw_contribution_attachments ORDER BY contribution_id")).rows as any[];
    expect(rows.map((x) => [x.file_name, x.mime, x.byte_size])).toEqual([["sketch.png", "image/png", PNG.length], ["plan.pdf", "application/pdf", PDF.length]]);
    expect(rows[0].file_sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("refuses a file whose bytes are not JPEG, PNG or PDF (whatever its name says), and one over 4 MB", async () => {
    await member();
    const fake = await send(good(), { bytes: new TextEncoder().encode("<svg onload=alert(1)>"), name: "photo.png", type: "image/png" });
    expect(fake.status).toBe(400);
    expect(fake.b.message).toBe(MESSAGES.attachmentType);
    const big = new Uint8Array(4 * 1024 * 1024 + 1); big.set(PNG);
    const huge = await send(good(), { bytes: big, name: "big.png", type: "image/png" });
    expect(huge.status).toBe(400);
    expect(huge.b.message).toBe(MESSAGES.attachmentSize);
    expect(Number(((await q("SELECT count(*)::int n FROM cw_contributions")).rows[0] as any).n)).toBe(0);
  });
});

describe("who may submit", () => {
  it("sign-in required (401); administrators and moderators review and cannot contribute (403)", async () => {
    expect((await send(good())).status).toBe(401);
    const admin = await seedUser({ email: "boss@example.com", role: "admin", fullName: "Boss" });
    who.id = admin.id; who.role = "admin";
    expect((await send(good())).status).toBe(403);
    const mod = await seedUser({ email: "mod@example.com", role: "TC", fullName: "Mod Person" });
    await q("UPDATE users SET is_moderator = true WHERE id = $1", [mod.id]);
    who.id = mod.id; who.role = "TC";
    expect((await send(good())).status).toBe(403);
  });
  it("a program filling the hidden website field gets an answer that looks fine, and nothing is stored", async () => {
    await member();
    const r = await send({ ...good(), website: "http://spam.example" });
    expect(r.status).toBe(201);
    expect(Number(((await q("SELECT count(*)::int n FROM cw_contributions")).rows[0] as any).n)).toBe(0);
  });
  it("an unreadable body is refused without storing anything", async () => {
    await member();
    expect((await send("{not json")).status).toBe(400);
  });
});

describe("reading", () => {
  it("me: signed out, a member (name and type from the profile), a reviewer", async () => {
    expect((await get(meRoute.GET, "/api/cw/me")).b).toEqual({ success: true, signedIn: false });
    await member({ fullName: "Meera K.", role: "PA" });
    const m = await get(meRoute.GET, "/api/cw/me");
    expect(m.b).toEqual({ success: true, signedIn: true, name: "Meera K.", type: "Parent / guardian", minor: false, reviewer: false });
    expect(m.cache).toBe("no-store");
  });
  it("form settings: active sectors with their active robot types, names only", async () => {
    const r = await get(configRoute.GET, "/api/cw/form-config");
    const agri = r.b.sectors.find((s: any) => s.slug === "agriculture-dairy");
    expect(agri.robots).toEqual([{ slug: "weeding-robots", name: "Weeding robots" }]);
    expect(JSON.stringify(r.b)).not.toMatch(/old-robot|"id"/);
  });
  it("mine: only my own ideas, newest first, with the status a contributor sees (My Contributions)", async () => {
    const other = await member(); await send(good({ title: "Someone else's idea" }));
    await member(); await send(good({ title: "My first idea" })); await send(good({ title: "My second idea" }));
    await q("UPDATE cw_contributions SET status = 'pending' WHERE original->>'title' = 'My first idea'");
    const r = await get(mineRoute.GET, "/api/cw/mine");
    expect(r.b.items.map((x: any) => [x.title, x.statusLabel])).toEqual([["My second idea", "Pending"], ["My first idea", "Approved"]]);
    expect(other).toBeGreaterThan(0);
  });
  it("before migration 027 My Contributions still answers (with the current form's items only); the other routes say 'not set up yet'", async () => {
    await member();
    testDb().failOn((sql) => (/cw_contributions/.test(sql) ? Object.assign(new Error("missing"), { code: "42P01" }) : undefined));
    const r = await get(mineRoute.GET, "/api/cw/mine");
    expect([r.status, r.b.items]).toEqual([200, []]);
    const s = await send(good({ title: "Before the workflow tables exist" }));
    expect([s.status, s.b.error]).toEqual([503, "NOT_SET_UP"]);
  });
});
