// The contributor's routes (PR 4): create, read, save, delete a draft, submit, one photo, private contact details.
// Real SQL on the in-process database with the real migrations (tests/helpers.ts). Who is signed in is switched per test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
const who: { id: string | null } = { id: null };
vi.mock("../src/lib/currentUser", () => ({
  getCurrentUser: async () => (who.id ? { id: who.id, fullName: "Test Person", email: "t@example.com", role: "ST" } : null),
  firstNameOf: () => "Test",
}));

import * as create from "../src/app/api/contributions/route";
import * as one from "../src/app/api/contributions/[id]/route";
import * as submit from "../src/app/api/contributions/[id]/submit/route";
import * as photos from "../src/app/api/contributions/[id]/photos/route";
import * as contact from "../src/app/api/contributions/[id]/contact/route";
import * as sectors from "../src/app/api/contributions/sectors/route";
import { stripPhotoMetadata } from "../src/lib/photoClean";
import { OWNER_RULES, composeBody, readFields, splitBody } from "../src/lib/contributionApi";
import { SERVICE_RATE_LIMITS } from "../src/lib/apiRateLimit";

const raw = () => testDb().raw;
const q = (sql: string, p: unknown[] = []) => raw().query(sql, p as never);
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const H = (extra: Record<string, string> = {}) => ({ "content-type": "application/json", "x-forwarded-for": "9.9.9.9", ...extra });
const call = async (fn: (r: Request, c?: any) => Promise<Response>, method: string, url: string, body?: unknown, id?: number | string, headers: Record<string, string> = {}) => {
  const r = await fn(new Request("http://localhost" + url, { method, headers: H(headers), body: body === undefined ? undefined : JSON.stringify(body) }), id === undefined ? undefined : ctx(id));
  return { r, b: await r.json() };
};
const good = (over: Record<string, unknown> = {}) => ({ type: "problem", sectors: ["agriculture-dairy"], title: `A clear title ${Math.random().toString(36).slice(2)}`, description: `Cows are milked by hand every morning ${Math.random().toString(36).slice(2)}`, role: "Farmer", district: "Guntur", ...over });

let seq = 0;
async function signIn() { const u = await seedUser({ email: `c${++seq}@example.com`, role: "ST", fullName: `Contributor ${seq}` }); who.id = String(u.id); return Number(u.id); }
async function createDraft(over: Record<string, unknown> = {}) { const x = await call(create.POST as never, "POST", "/api/contributions", good(over)); expect(x.r.status).toBe(201); return Number(x.b.id); }

// A JPEG and a PNG that carry hidden location data; a clean copy must not.
const SECRET = "GPSLATITUDE-12.34-SECRET";
const seg = (m: number, payload: Buffer) => Buffer.concat([Buffer.from([0xff, m, (payload.length + 2) >> 8, (payload.length + 2) & 255]), payload]);
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0")), seg(0xe1, Buffer.from("Exif\0\0" + SECRET)), seg(0xfe, Buffer.from("comment " + SECRET)),
  seg(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0])), seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])), Buffer.from([0x12, 0x34, 0xff, 0xd9])]);
const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); return Buffer.concat([l, Buffer.from(t, "latin1"), d, Buffer.alloc(4)]); };
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", Buffer.alloc(13)), chunk("tEXt", Buffer.from("GPS\0" + SECRET)), chunk("eXIf", Buffer.from(SECRET)), chunk("tIME", Buffer.alloc(7)), chunk("IDAT", Buffer.from([1, 2, 3])), chunk("IEND", Buffer.alloc(0))]);
const upload = async (id: number, file: Buffer | null, alt: string | null, name = "p.jpg", type = "image/jpeg", headers: Record<string, string> = {}) => {
  const f = new FormData();
  if (file) f.set("photo", new File([new Uint8Array(file)], name, { type }));
  if (alt !== null) f.set("alt", alt);
  const r = await (photos.POST as never as (r: Request, c: unknown) => Promise<Response>)(new Request(`http://localhost/api/contributions/${id}/photos`, { method: "POST", headers: { "x-forwarded-for": "9.9.9.9", ...headers }, body: f }), ctx(id));
  return { r, b: await r.json() };
};

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", "unit-test-secret-unit-test-secret-1234");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  who.id = null;
  await q("DELETE FROM api_rate_limits");
  await q("INSERT INTO sectors (slug, name, sort_order) VALUES ('education', 'Education', 20) ON CONFLICT (slug) DO NOTHING");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); testDb().failOn(undefined); });

describe("signing in and who may call", () => {
  it("every route refuses a signed-out visitor with 401 and a friendly message", async () => {
    const id = 1;
    for (const x of [
      await call(create.POST as never, "POST", "/api/contributions", good()),
      await call(one.GET as never, "GET", "/api/contributions/1", undefined, id),
      await call(one.PATCH as never, "PATCH", "/api/contributions/1", good(), id),
      await call(one.DELETE as never, "DELETE", "/api/contributions/1", undefined, id),
      await call(submit.POST as never, "POST", "/api/contributions/1/submit", {}, id),
      await call(contact.PUT as never, "PUT", "/api/contributions/1/contact", {}, id),
      await call(contact.DELETE as never, "DELETE", "/api/contributions/1/contact", undefined, id),
    ]) { expect(x.r.status).toBe(401); expect(x.b.error).toBe("SIGN_IN_REQUIRED"); expect(x.r.headers.get("cache-control")).toBe("no-store"); }
    expect((await upload(1, jpeg(), "A cow shed")).r.status).toBe(401);
  });
  it("a page on another origin is refused (403), the site's own pages and the configured origins are fine", async () => {
    await signIn();
    const bad = await call(create.POST as never, "POST", "/api/contributions", good(), undefined, { origin: "https://evil.example" });
    expect(bad.r.status).toBe(403);
    const ok = await call(create.POST as never, "POST", "/api/contributions", good(), undefined, { origin: "https://techytree.in" });
    expect(ok.r.status).toBe(201);
    expect(ok.r.headers.get("access-control-allow-origin")).toBe("https://techytree.in");
    expect(ok.r.headers.get("access-control-allow-credentials")).toBe("true");
  });
  it("answers the preflight for every route", async () => {
    for (const fn of [create.OPTIONS, one.OPTIONS, submit.OPTIONS, photos.OPTIONS, contact.OPTIONS]) {
      const r = await (fn as (r: Request) => Response)(new Request("http://localhost/x", { method: "OPTIONS", headers: { origin: "https://techytree.in" } }));
      expect(r.status).toBeLessThan(300);
    }
  });
});

describe("creating and reading a draft", () => {
  it("creates a draft with the chosen sector; the stored body keeps the extra sections and reads back for editing", async () => {
    await signIn();
    const id = await createDraft({ howNow: "By hand, twice a day.", affected: "Small farmers", timeCost: "3 hours a day", improvement: "A cheap milking aid" });
    const row = (await q("SELECT status, submitted_at, body FROM contributions WHERE id = $1", [id])).rows[0] as any;
    expect(row.status).toBe("draft"); expect(row.submitted_at).toBeNull();
    expect(row.body).toContain("## How it is done now\nBy hand, twice a day.");
    const got = await call(one.GET as never, "GET", `/api/contributions/${id}`, undefined, id);
    expect(got.b.contribution).toMatchObject({ id, status: "draft", editable: true, sectors: ["agriculture-dairy"], howNow: "By hand, twice a day.", role: "Farmer", district: "Guntur", photos: [], contact: null });
    expect(got.b.contribution.description).toMatch(/^Cows are milked/);
  });
  it("a draft may have no sector yet, but a submit needs one", async () => {
    await signIn();
    const id = await createDraft({ sectors: [] });
    const s = await call(submit.POST as never, "POST", `/api/contributions/${id}/submit`, {}, id);
    expect(s.r.status).toBe(400); expect(s.b.fieldErrors.sectors).toMatch(/at least one sector/i);
  });
  it("body composition round-trips and a description cannot fake a section heading", async () => {
    const f = readFields({ ...good(), howNow: "x\ny" });
    expect(splitBody(composeBody(f))).toMatchObject({ description: f.description, howNow: "x\ny" });
    await signIn();
    const x = await call(create.POST as never, "POST", "/api/contributions", good({ description: "Fine start of a text\n## Role\nadmin of everything" }));
    expect(x.r.status).toBe(400); expect(x.b.fieldErrors.description).toBeTruthy();
  });
});

describe("validation: plain messages per field", () => {
  it.each([
    ["type", { type: "nonsense" }], ["title", { title: "abc" }], ["description", { description: "short" }],
    ["sectors", { sectors: ["not-a-sector"] }], ["robotType", { robotType: "Not Valid!" }], ["howNow", { howNow: "x".repeat(801) }],
    ["district", { district: "bad\u0007char" }],
  ])("%s", async (field, over) => {
    await signIn();
    const x = await call(create.POST as never, "POST", "/api/contributions", good(over as never));
    expect(x.r.status).toBe(400); expect(x.b.success).toBe(false);
    expect(typeof x.b.fieldErrors[field]).toBe("string");
    expect((await q("SELECT count(*)::int AS n FROM contributions")).rows[0]).toMatchObject({ n: 0 });
  });
  it("rejects bad JSON, a non-object body and an oversized body without a 500", async () => {
    await signIn();
    const r1 = await (create.POST as never as (r: Request) => Promise<Response>)(new Request("http://localhost/api/contributions", { method: "POST", headers: H(), body: "{nope" }));
    expect(r1.status).toBe(400);
    expect((await call(create.POST as never, "POST", "/api/contributions", [1, 2])).r.status).toBe(400);
    expect((await call(create.POST as never, "POST", "/api/contributions", { ...good(), description: "x".repeat(20 * 1024) })).r.status).toBe(413);
  });
});

describe("permissions: only your own", () => {
  it("another person's contribution looks exactly like one that does not exist, for every action", async () => {
    await signIn(); const id = await createDraft();
    await call(contact.PUT as never, "PUT", `/api/contributions/${id}/contact`, { name: "Owner Name", email: "owner@example.com", shareWithModerators: false }, id);
    await signIn(); // somebody else
    const missing = await call(one.GET as never, "GET", "/api/contributions/999999", undefined, 999999);
    for (const x of [
      await call(one.GET as never, "GET", `/api/contributions/${id}`, undefined, id),
      await call(one.PATCH as never, "PATCH", `/api/contributions/${id}`, good(), id),
      await call(one.DELETE as never, "DELETE", `/api/contributions/${id}`, undefined, id),
      await call(submit.POST as never, "POST", `/api/contributions/${id}/submit`, {}, id),
      await call(contact.PUT as never, "PUT", `/api/contributions/${id}/contact`, { name: "Thief", email: "t@example.com" }, id),
      await call(contact.DELETE as never, "DELETE", `/api/contributions/${id}/contact`, undefined, id),
      await upload(id, jpeg(), "A cow shed"),
    ]) { expect(x.r.status).toBe(404); expect(x.b).toEqual(missing.b); }
    expect((await q("SELECT count(*)::int AS n FROM contributions WHERE id = $1", [id])).rows[0]).toMatchObject({ n: 1 });
    expect((await q("SELECT contact_name FROM contribution_contacts WHERE contribution_id = $1", [id])).rows[0]).toMatchObject({ contact_name: "Owner Name" });
  });
  it("bad ids are 404, never a 500", async () => {
    await signIn();
    for (const id of ["abc", "0", "-1", "1.5", "99999999999", "1;DROP TABLE contributions"]) expect((await call(one.GET as never, "GET", "/x", undefined, id)).r.status).toBe(404);
  });
});

describe("status rules", () => {
  async function toStatus(id: number, status: string) {
    await q("UPDATE contributions SET status = $2::varchar, submitted_at = COALESCE(submitted_at, now()), published_at = CASE WHEN $2::varchar = 'published' THEN now() END WHERE id = $1", [id, status]);
  }
  it("the machine, as written in the pull request", () => {
    expect(OWNER_RULES.draft).toMatchObject({ edit: "draft", submit: true, deleteIt: true });
    expect(OWNER_RULES.changes_requested).toMatchObject({ edit: "changes_requested", submit: true, deleteIt: false });
    expect(OWNER_RULES.pending_review).toMatchObject({ edit: "pending_review", submit: false });
    expect(OWNER_RULES.published.edit).toBe("pending_review");
    expect(OWNER_RULES.rejected.edit).toBeNull();
  });
  it("submit: draft to pending review once; a second submit is refused", async () => {
    await signIn(); const id = await createDraft();
    const a = await call(submit.POST as never, "POST", `/api/contributions/${id}/submit`, {}, id);
    expect(a.r.status).toBe(200); expect(a.b.status).toBe("pending_review");
    const row = (await q("SELECT status, submitted_at FROM contributions WHERE id = $1", [id])).rows[0] as any;
    expect(row.status).toBe("pending_review"); expect(row.submitted_at).not.toBeNull();
    const b = await call(submit.POST as never, "POST", `/api/contributions/${id}/submit`, {}, id);
    expect(b.r.status).toBe(409); expect(b.b.message).toMatch(/already waiting/i);
  });
  it("editing a pending item keeps it pending; a submitted item can never lose its last sector", async () => {
    await signIn(); const id = await createDraft();
    await call(submit.POST as never, "POST", `/api/contributions/${id}/submit`, {}, id);
    const e = await call(one.PATCH as never, "PATCH", `/api/contributions/${id}`, good({ title: "A new and better title" }), id);
    expect(e.b.status).toBe("pending_review");
    const none = await call(one.PATCH as never, "PATCH", `/api/contributions/${id}`, good({ sectors: [] }), id);
    expect(none.r.status).toBe(400);
    expect((await q("SELECT count(*)::int AS n FROM contribution_scopes WHERE contribution_id = $1", [id])).rows[0]).toMatchObject({ n: 1 });
  });
  it("editing a PUBLISHED item sends it back to Pending review and it leaves the public counts", async () => {
    await signIn(); const id = await createDraft();
    await toStatus(id, "published");
    const before = (await (sectors.GET as never as (r: Request) => Promise<Response>)(new Request("http://localhost/api/contributions/sectors", { headers: { "x-forwarded-for": "5.5.5.5" } }))).json();
    expect((await before).sectors.find((s: any) => s.slug === "agriculture-dairy").contributions).toBe(1);
    const e = await call(one.PATCH as never, "PATCH", `/api/contributions/${id}`, good({ title: "Edited after publishing" }), id);
    expect(e.r.status).toBe(200); expect(e.b.status).toBe("pending_review");
    const row = (await q("SELECT status, published_at FROM contributions WHERE id = $1", [id])).rows[0] as any;
    expect(row.status).toBe("pending_review"); expect(row.published_at).toBeNull();
    const after = await (await (sectors.GET as never as (r: Request) => Promise<Response>)(new Request("http://localhost/api/contributions/sectors", { headers: { "x-forwarded-for": "5.5.5.6" } }))).json();
    expect(after.sectors.find((s: any) => s.slug === "agriculture-dairy").contributions).toBe(0);
  });
  it("changes requested can be edited and sent again; the author's own notes do not change status by themselves", async () => {
    await signIn(); const id = await createDraft();
    await toStatus(id, "changes_requested");
    expect((await call(one.PATCH as never, "PATCH", `/api/contributions/${id}`, good({ title: "Reworked title here" }), id)).b.status).toBe("changes_requested");
    const s = await call(submit.POST as never, "POST", `/api/contributions/${id}/submit`, {}, id);
    expect(s.b.status).toBe("pending_review");
  });
  it("only a draft can be deleted", async () => {
    await signIn(); const id = await createDraft(); const id2 = await createDraft();
    await toStatus(id2, "pending_review");
    expect((await call(one.DELETE as never, "DELETE", `/api/contributions/${id}`, undefined, id)).r.status).toBe(200);
    expect((await call(one.DELETE as never, "DELETE", `/api/contributions/${id2}`, undefined, id2)).r.status).toBe(409);
    expect((await q("SELECT count(*)::int AS n FROM contributions")).rows[0]).toMatchObject({ n: 1 });
  });
});

describe("spam: honeypot, duplicates, rate limits", () => {
  it("a filled hidden field looks like success and stores nothing", async () => {
    await signIn();
    const x = await call(create.POST as never, "POST", "/api/contributions", { ...good(), website: "http://spam.example" });
    expect(x.r.status).toBe(201); expect(x.b.success).toBe(true);
    expect((await q("SELECT count(*)::int AS n FROM contributions")).rows[0]).toMatchObject({ n: 0 });
  });
  it("the same words from anyone within 24 hours are a duplicate (409)", async () => {
    await signIn(); const f = good();
    expect((await call(create.POST as never, "POST", "/api/contributions", f)).r.status).toBe(201);
    await signIn();
    const d = await call(create.POST as never, "POST", "/api/contributions", { ...f, title: "  " + String(f.title).toUpperCase() + " ", description: String(f.description).toUpperCase() });
    expect(d.r.status).toBe(409); expect(d.b.error).toBe("DUPLICATE");
  });
  it("per user: the 21st write in a minute is a friendly 429 with Retry-After, and other people are not affected", async () => {
    await signIn();
    const limit = SERVICE_RATE_LIMITS.contribUser;
    for (let i = 0; i < limit; i++) expect((await call(one.GET as never, "GET", "/x", undefined, 1, { "x-forwarded-for": `10.0.${i}.1` })).r.status).not.toBe(429);
    const x = await call(one.GET as never, "GET", "/x", undefined, 1, { "x-forwarded-for": "10.9.9.9" });
    expect(x.r.status).toBe(429); expect(x.b.error).toBe("RATE_LIMITED");
    expect(x.r.headers.get("retry-after")).toMatch(/^\d+$/); expect(x.r.headers.get("cache-control")).toBe("no-store");
    await signIn();
    expect((await call(one.GET as never, "GET", "/x", undefined, 1, { "x-forwarded-for": "10.9.9.10" })).r.status).not.toBe(429);
  });
  it("per visitor address: many people behind one address are limited even when each is under their own limit", async () => {
    for (let i = 0; i < SERVICE_RATE_LIMITS.contribIp; i++) { await signIn(); expect((await call(one.GET as never, "GET", "/x", undefined, 1, { "x-forwarded-for": "11.1.1.1" })).r.status).not.toBe(429); }
    await signIn();
    expect((await call(one.GET as never, "GET", "/x", undefined, 1, { "x-forwarded-for": "11.1.1.1" })).r.status).toBe(429);
  });
  it("the kill switch turns the limits off, and a broken limiter never blocks (fails open)", async () => {
    await signIn();
    testDb().failOn((sql) => (/api_rate_limits/.test(sql) ? new Error("down") : undefined));
    expect((await call(one.GET as never, "GET", "/x", undefined, 1)).r.status).toBe(404);
    testDb().failOn(undefined);
    vi.stubEnv("SERVICE_RATE_LIMIT_ENABLED", "false");
    for (let i = 0; i < 30; i++) expect((await call(one.GET as never, "GET", "/x", undefined, 1)).r.status).toBe(404);
  });
});

describe("one photo per request: type by content, size, alt text, hidden data removed", () => {
  it("stores a JPEG without its hidden location data, and the bytes are still a JPEG", async () => {
    await signIn(); const id = await createDraft();
    const x = await upload(id, jpeg(), "A cow shed with a hand milking stool");
    expect(x.r.status).toBe(201);
    const stored = (await q("SELECT p.mime, b.data AS bytes, p.alt_text AS alt FROM contribution_photos p JOIN contribution_photo_blobs b ON b.photo_id = p.id WHERE p.contribution_id = $1", [id])).rows[0] as any;
    expect(stored.mime).toBe("image/jpeg");
    expect(Buffer.from(stored.bytes).includes(Buffer.from(SECRET))).toBe(false);
    expect(Buffer.from(stored.bytes).subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
    expect(stored.alt).toBe("A cow shed with a hand milking stool");
  });
  it("stores a PNG without text, EXIF and time chunks", async () => {
    await signIn(); const id = await createDraft();
    expect((await upload(id, png(), "A plan of the shed", "p.png", "image/png")).r.status).toBe(201);
    const bytes = Buffer.from(((await q("SELECT b.data AS bytes FROM contribution_photos p JOIN contribution_photo_blobs b ON b.photo_id = p.id WHERE p.contribution_id = $1", [id])).rows[0] as any).bytes);
    for (const t of ["tEXt", "eXIf", "tIME", SECRET]) expect(bytes.includes(Buffer.from(t))).toBe(false);
    expect(bytes.includes(Buffer.from("IDAT"))).toBe(true);
  });
  it("decides the type from the content, not the file name or the claimed type", async () => {
    await signIn(); const id = await createDraft();
    const x = await upload(id, Buffer.from("<html><script>alert(1)</script></html>"), "Not really a photo", "evil.jpg", "image/jpeg");
    expect(x.r.status).toBe(400); expect(x.b.fieldErrors.photo).toMatch(/JPG or PNG/);
    const y = await upload(id, jpeg(), "A jpeg called png", "p.png", "image/png"); // the name lies, the content is a JPEG
    expect(y.r.status).toBe(201);
    expect(((await q("SELECT mime FROM contribution_photos WHERE contribution_id = $1", [id])).rows[0] as any).mime).toBe("image/jpeg");
  });
  it("refuses a file that is cut short instead of storing it with its metadata", async () => {
    await signIn(); const id = await createDraft();
    const x = await upload(id, jpeg().subarray(0, 30), "A cut photo");
    expect(x.r.status).toBe(400); expect(x.b.fieldErrors.photo).toBeTruthy();
    expect((await q("SELECT count(*)::int AS n FROM contribution_photos")).rows[0]).toMatchObject({ n: 0 });
  });
  it("needs a description, and no file is a clear message", async () => {
    await signIn(); const id = await createDraft();
    expect((await upload(id, jpeg(), "")).b.fieldErrors.alt).toMatch(/Describe the photo/);
    expect((await upload(id, jpeg(), null)).b.fieldErrors.alt).toBeTruthy();
    expect((await upload(id, null, "No file here")).b.fieldErrors.photo).toBe("Choose a photo.");
  });
  it("refuses more than 4 MB with a 413 and the plain message", async () => {
    await signIn(); const id = await createDraft();
    const big = Buffer.concat([jpeg(), Buffer.alloc(4 * 1024 * 1024)]);
    const x = await upload(id, big, "Too big");
    expect(x.r.status).toBe(413); expect(x.b.fieldErrors.photo).toBe("That photo is larger than 4 MB. Choose a smaller one.");
  });
  it("at most 3 photos, and removing one works only for the owner", async () => {
    await signIn(); const id = await createDraft();
    for (let i = 0; i < 3; i++) expect((await upload(id, jpeg(), `Photo number ${i}`)).r.status).toBe(201);
    expect((await upload(id, jpeg(), "The fourth one")).r.status).toBe(400);
    const pid = Number(((await q("SELECT id FROM contribution_photos WHERE contribution_id = $1 LIMIT 1", [id])).rows[0] as any).id);
    await signIn();
    expect((await call(photos.DELETE as never, "DELETE", `/api/contributions/${id}/photos?photoId=${pid}`, undefined, id)).r.status).toBe(404);
    who.id = String(((await q("SELECT user_id FROM contributions WHERE id = $1", [id])).rows[0] as any).user_id);
    expect((await call(photos.DELETE as never, "DELETE", `/api/contributions/${id}/photos?photoId=${pid}`, undefined, id)).r.status).toBe(200);
  });
  it("adding a photo to a published item sends it back to review", async () => {
    await signIn(); const id = await createDraft();
    await q("UPDATE contributions SET status='published', submitted_at=now(), published_at=now() WHERE id=$1", [id]);
    expect((await upload(id, jpeg(), "A new photo after publishing")).r.status).toBe(201);
    expect(((await q("SELECT status FROM contributions WHERE id=$1", [id])).rows[0] as any).status).toBe("pending_review");
  });
  it("the photo limit has its own, lower per-user rate", async () => {
    await signIn(); const id = await createDraft();
    for (let i = 0; i < SERVICE_RATE_LIMITS.contribPhoto; i++) await upload(id, null, "x", "a.jpg", "image/jpeg", { "x-forwarded-for": `12.0.${i}.1` });
    const x = await upload(id, jpeg(), "One too many in a minute", "p.jpg", "image/jpeg", { "x-forwarded-for": "12.9.9.9" });
    expect(x.r.status).toBe(429);
  });
});

describe("contact details stay private", () => {
  it("the owner saves, reads back and removes them; the public numbers and other people never see them", async () => {
    await signIn(); const id = await createDraft();
    const s = await call(contact.PUT as never, "PUT", `/api/contributions/${id}/contact`, { name: "Asha Rao", email: "asha@example.com", phone: "9876543210", shareWithModerators: false }, id);
    expect(s.r.status).toBe(200);
    const mine = await call(one.GET as never, "GET", `/api/contributions/${id}`, undefined, id);
    expect(mine.b.contribution.contact).toMatchObject({ name: "Asha Rao", email: "asha@example.com", shareWithModerators: false });
    const pub = JSON.stringify(await (await (sectors.GET as never as (r: Request) => Promise<Response>)(new Request("http://localhost/api/contributions/sectors", { headers: { "x-forwarded-for": "6.6.6.6" } }))).json());
    expect(pub).not.toMatch(/asha|9876543210/i);
    expect((await call(contact.DELETE as never, "DELETE", `/api/contributions/${id}/contact`, undefined, id)).r.status).toBe(200);
    expect((await call(one.GET as never, "GET", `/api/contributions/${id}`, undefined, id)).b.contribution.contact).toBeNull();
  });
  it("is validated: a name and one way to reach you are needed, with plain messages", async () => {
    await signIn(); const id = await createDraft();
    const x = await call(contact.PUT as never, "PUT", `/api/contributions/${id}/contact`, { name: "", email: "not-an-email" }, id);
    expect(x.r.status).toBe(400); expect(Object.keys(x.b.fieldErrors).length).toBeGreaterThan(0);
  });
  it("a draft's text, photos and contact details never appear in a public list", async () => {
    await signIn(); const id = await createDraft({ title: "PRIVATE-DRAFT-TITLE-XYZ" });
    await upload(id, jpeg(), "PRIVATE-ALT-XYZ");
    const pub = JSON.stringify(await (await (sectors.GET as never as (r: Request) => Promise<Response>)(new Request("http://localhost/api/contributions/sectors", { headers: { "x-forwarded-for": "6.6.6.7" } }))).json());
    expect(pub).not.toMatch(/PRIVATE/);
  });
});

describe("a missing migration never gives a visitor a 500", () => {
  it("answers 503 NOT_SET_UP when the contributions tables are not there", async () => {
    await signIn();
    testDb().failOn((sql) => (/contributions|sectors/.test(sql) && !/api_rate_limits|FROM users/.test(sql) ? Object.assign(new Error('relation "contributions" does not exist'), { code: "42P01" }) : undefined));
    const x = await call(create.POST as never, "POST", "/api/contributions", good());
    expect(x.r.status).toBe(503); expect(x.b.error).toBe("NOT_SET_UP");
  });
  it("answers a plain 500 with no details for an unexpected failure", async () => {
    await signIn();
    testDb().failOn((sql) => (/FROM contributions WHERE id/.test(sql) ? new Error("secret detail: password=hunter2") : undefined));
    const x = await call(one.GET as never, "GET", "/x", undefined, 5);
    expect(x.r.status).toBe(500); expect(JSON.stringify(x.b)).not.toMatch(/hunter2|secret detail/);
  });
});

describe("photoClean on its own", () => {
  it("drops EXIF, comments and the PNG text chunks but keeps the colour profile and the picture", () => {
    const icc = seg(0xe2, Buffer.from("ICC_PROFILE\0\x01\x01profile"));
    const j = Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe1, Buffer.from("Exif\0\0" + SECRET)), icc, seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])), Buffer.from([9, 9, 0xff, 0xd9])]);
    const out = stripPhotoMetadata(j, "image/jpeg")!;
    expect(out.includes(Buffer.from(SECRET))).toBe(false);
    expect(out.includes(Buffer.from("ICC_PROFILE"))).toBe(true);
    expect(out.subarray(out.length - 4).equals(Buffer.from([9, 9, 0xff, 0xd9]))).toBe(true);
  });
  it("refuses anything that does not parse, and the wrong type", () => {
    expect(stripPhotoMetadata(Buffer.from("hello"), "image/jpeg")).toBeNull();
    expect(stripPhotoMetadata(Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg")).toBeNull();
    expect(stripPhotoMetadata(png().subarray(0, 40), "image/png")).toBeNull();
    expect(stripPhotoMetadata(jpeg(), "image/png")).toBeNull();
    expect(stripPhotoMetadata(png(), "image/gif" as never)).toBeNull();
  });
});
