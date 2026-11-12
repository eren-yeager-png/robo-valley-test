// The whole Contribute journey across both portals, through the real route handlers, real sessions (signed cookies read by the real
// getCurrentUser, role and moderator flag read from the database) and real SQL with the real migrations (tests/helpers.ts).
//   visitor -> sector counts -> signed out cannot contribute -> member creates and submits for the chosen sector -> member cannot reach
//   any reviewing or admin route -> admin makes a moderator -> moderator verifies but cannot approve -> admin approves ->
//   the published count of that sector goes up. Role and origin checks are repeated on every step that matters.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";
import { createSessionToken } from "../src/lib/session";

const m = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "rv_session" && m.cookie ? { name: n, value: m.cookie } : undefined) }),
  headers: async () => new Headers(),
}));

import * as sectors from "../src/app/api/contributions/sectors/route";
import * as create from "../src/app/api/contributions/route";
import * as submit from "../src/app/api/contributions/[id]/submit/route";
import * as mine from "../src/app/api/contributions/mine/route";
import * as queue from "../src/app/api/review/queue/route";
import * as detail from "../src/app/api/review/[id]/route";
import * as decision from "../src/app/api/review/[id]/decision/route";
import { POST as makeModerator } from "../src/app/api/admin/moderators/route";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
const signInAs = (id: number | null, role = "ST") => { m.cookie = id === null ? undefined : createSessionToken({ id: String(id), role }, false, Date.now(), { SESSION_SECRET: SECRET } as never).token; };
let ipn = 0;
const ip = () => `30.${Math.floor(++ipn / 250)}.${ipn % 250}.1`;
type Fn = (r: Request, c?: unknown) => Promise<Response>;
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const call = async (fn: unknown, method: string, url: string, body?: unknown, id?: number | string, headers: Record<string, string> = {}) => {
  const r = await (fn as Fn)(new Request("http://localhost" + url, { method, headers: { "x-forwarded-for": ip(), host: "localhost", "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), id === undefined ? undefined : ctx(id));
  const ct = r.headers.get("content-type") ?? "";
  return { r, b: (ct.includes("json") ? await r.json() : null) as any };
};
let seq = 0;
const person = async (role: string, moderator = false) => {
  const u = await seedUser({ email: `wf${++seq}@example.com`, role, fullName: `Person ${seq}` });
  if (moderator) await q("UPDATE users SET is_moderator = true WHERE id = $1", [u.id]);
  return Number(u.id);
};
const status = async (id: number) => ((await q("SELECT status FROM contributions WHERE id=$1", [id])).rows[0] as any).status as string;
const publishedCount = async (slug: string) => {
  const x = await call(sectors.GET, "GET", "/api/contributions/sectors");
  expect(x.r.status).toBe(200);
  return (x.b.sectors as { slug: string; contributions: number }[]).find((s) => s.slug === slug)!.contributions;
};
const draft = () => ({ type: "problem", sectors: ["agriculture-dairy"], title: `Milking by hand takes hours ${Math.random().toString(36).slice(2)}`, description: `Cows are milked by hand every morning ${Math.random().toString(36).slice(2)}`, role: "Farmer", district: "Guntur" });

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  m.cookie = undefined;
  await q("DELETE FROM api_rate_limits");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("visitor to published: the whole workflow", () => {
  it("runs end to end, and every route refuses the wrong person at every step", async () => {
    const member = await person("ST"), moderator = await person("TC"), admin = await person("admin"), other = await person("ST");

    // 1-4. a visitor (nobody signed in) can read the public sector numbers, and the sector exists
    signInAs(null);
    expect(await publishedCount("agriculture-dairy")).toBe(0);

    // 5. signed out, the visitor cannot contribute or read anything private: every route answers 401, nothing is stored
    for (const x of [
      await call(create.POST, "POST", "/api/contributions", draft()),
      await call(mine.GET, "GET", "/api/contributions/mine"),
      await call(queue.GET, "GET", "/api/review/queue"),
      await call(makeModerator, "POST", "/api/admin/moderators", { userId: member, moderator: true }),
    ]) expect(x.r.status).toBe(401);
    expect(Number(((await q("SELECT count(*) c FROM contributions")).rows[0] as any).c)).toBe(0);

    // 6-7. after signing in the member creates the contribution for the chosen sector (the sector is what the server stores) and submits it
    signInAs(member);
    const made = await call(create.POST, "POST", "/api/contributions", draft());
    expect(made.r.status).toBe(201);
    const id = Number(made.b.id);
    expect(await status(id)).toBe("draft");
    expect(((await q("SELECT s.slug FROM contribution_scopes cs JOIN sectors s ON s.id = cs.sector_id WHERE cs.contribution_id=$1", [id])).rows as any[]).map((r) => r.slug)).toEqual(["agriculture-dairy"]);
    const sent = await call(submit.POST, "POST", `/api/contributions/${id}/submit`, {}, id);
    expect(sent.r.status).toBe(200);
    expect(await status(id)).toBe("pending_review");
    const list = await call(mine.GET, "GET", "/api/contributions/mine");
    expect(list.r.status).toBe(200);
    expect(JSON.stringify(list.b)).toContain("pending_review");
    expect(await publishedCount("agriculture-dairy")).toBe(0); // not counted until it is approved

    // an ordinary member cannot reach any reviewing or admin route, by URL or API, and cannot change the item
    for (const x of [
      await call(queue.GET, "GET", "/api/review/queue"),
      await call(detail.GET, "GET", `/api/review/${id}`, undefined, id),
      await call(decision.POST, "POST", `/api/review/${id}/decision`, { action: "approve" }, id),
      await call(decision.POST, "POST", `/api/review/${id}/decision`, { action: "verify" }, id),
      await call(makeModerator, "POST", "/api/admin/moderators", { userId: member, moderator: true }),
    ]) { expect(x.r.status).toBe(403); expect(x.r.headers.get("cache-control")).toContain("no-store"); }
    expect(await status(id)).toBe("pending_review");
    expect(((await q("SELECT is_moderator f FROM users WHERE id=$1", [member])).rows[0] as any).f).toBe(false);

    // another member cannot read or submit someone else's contribution
    signInAs(other);
    expect([403, 404]).toContain((await call(submit.POST, "POST", `/api/contributions/${id}/submit`, {}, id)).r.status);
    expect((await call(mine.GET, "GET", "/api/contributions/mine")).b.success).toBe(true);
    expect(JSON.stringify((await call(mine.GET, "GET", "/api/contributions/mine")).b)).not.toContain("Milking by hand");

    // a foreign website cannot act for a signed-in administrator
    signInAs(admin, "admin");
    expect((await call(makeModerator, "POST", "/api/admin/moderators", { userId: moderator, moderator: true }, undefined, { origin: "https://evil.example" })).r.status).toBe(403);
    expect(((await q("SELECT is_moderator f FROM users WHERE id=$1", [moderator])).rows[0] as any).f).toBe(false);

    // the administrator makes a moderator (audited); a moderator cannot make another
    const grant = await call(makeModerator, "POST", "/api/admin/moderators", { userId: moderator, moderator: true });
    expect(grant.r.status).toBe(200);
    expect(((await q("SELECT is_moderator f FROM users WHERE id=$1", [moderator])).rows[0] as any).f).toBe(true);
    expect(Number(((await q("SELECT count(*) c FROM moderator_audit WHERE target_user_id=$1 AND granted", [moderator])).rows[0] as any).c)).toBe(1);
    signInAs(moderator, "TC");
    expect((await call(makeModerator, "POST", "/api/admin/moderators", { userId: other, moderator: true })).r.status).toBe(403);

    // 8-9. the contribution is in the moderation queue; the moderator can read it, verify it, but cannot approve or publish it
    const qd = await call(queue.GET, "GET", "/api/review/queue");
    expect(qd.r.status).toBe(200);
    expect((qd.b.items as { id: number }[]).map((i) => i.id)).toContain(id);
    expect((await call(detail.GET, "GET", `/api/review/${id}`, undefined, id)).r.status).toBe(200);
    const mod = await call(decision.POST, "POST", `/api/review/${id}/decision`, { action: "approve" }, id);
    expect(mod.r.status).toBe(403);
    expect(mod.b.error).toBe("ADMIN_ONLY");
    expect(await status(id)).toBe("pending_review");
    expect((await call(decision.POST, "POST", `/api/review/${id}/decision`, { action: "verify" }, id)).r.status).toBe(200);
    expect(await status(id)).toBe("pending_review"); // verifying is a review step, not a publication
    expect(await publishedCount("agriculture-dairy")).toBe(0);

    // 10-11. the administrator approves and publishes it; the sector count goes up; the author sees it as published
    signInAs(admin, "admin");
    const ok = await call(decision.POST, "POST", `/api/review/${id}/decision`, { action: "approve" }, id);
    expect(ok.r.status).toBe(200);
    expect(ok.b.status).toBe("published");
    expect(await status(id)).toBe("published");
    signInAs(null);
    expect(await publishedCount("agriculture-dairy")).toBe(1);
    signInAs(member);
    expect(JSON.stringify((await call(mine.GET, "GET", "/api/contributions/mine")).b)).toContain("published");

    // the same item cannot be approved twice; every decision left an audit row with the right person
    signInAs(admin, "admin");
    const again = await call(decision.POST, "POST", `/api/review/${id}/decision`, { action: "approve" }, id);
    expect(again.r.status).toBeGreaterThanOrEqual(400);
    expect(await publishedCount("agriculture-dairy")).toBe(1);
    const audit = (await q("SELECT reviewer_id::text r, action FROM contribution_reviews WHERE contribution_id=$1 ORDER BY id", [id])).rows as { r: string; action: string }[];
    expect(audit).toEqual([{ r: String(moderator), action: "verify" }, { r: String(admin), action: "approve" }]);
  });

  it("a rejected or unpublished item never counts, and unpublishing removes it from the count again", async () => {
    const author = await person("ST"), admin = await person("admin");
    signInAs(author);
    const id = Number((await call(create.POST, "POST", "/api/contributions", draft())).b.id);
    await call(submit.POST, "POST", `/api/contributions/${id}/submit`, {}, id);
    signInAs(admin, "admin");
    expect((await call(decision.POST, "POST", `/api/review/${id}/decision`, { action: "reject", note: "Not a clear problem statement yet." }, id)).r.status).toBe(200);
    expect(await publishedCount("agriculture-dairy")).toBe(0);

    signInAs(author);
    const id2 = Number((await call(create.POST, "POST", "/api/contributions", draft())).b.id);
    await call(submit.POST, "POST", `/api/contributions/${id2}/submit`, {}, id2);
    signInAs(admin, "admin");
    await call(decision.POST, "POST", `/api/review/${id2}/decision`, { action: "approve" }, id2);
    expect(await publishedCount("agriculture-dairy")).toBe(1);
    expect((await call(decision.POST, "POST", `/api/review/${id2}/decision`, { action: "unpublish", note: "Needs a correction." }, id2)).r.status).toBe(200);
    expect(await publishedCount("agriculture-dairy")).toBe(0);
  });
});

describe("a contribution for several sectors", () => {
  it("counts once in each chosen sector and in no other; a repeated sector counts once; an unknown sector is refused and nothing is stored", async () => {
    await q("INSERT INTO sectors (slug, name, sort_order) VALUES ('education','Education',20), ('healthcare','Healthcare',30) ON CONFLICT DO NOTHING");
    const author = await person("ST"), admin = await person("admin");
    signInAs(author);

    // an unknown sector is refused (and nothing is stored); so is no sector at the moment of submitting
    const bad = await call(create.POST, "POST", "/api/contributions", { ...draft(), sectors: ["agriculture-dairy", "no-such-sector"] });
    expect(bad.r.status).toBe(400);
    expect(JSON.stringify(bad.b)).toMatch(/sector/i);
    expect(Number(((await q("SELECT count(*) c FROM contributions")).rows[0] as any).c)).toBe(0);

    // two sectors chosen, one of them listed twice: it is stored in each sector exactly once
    const made = await call(create.POST, "POST", "/api/contributions", { ...draft(), sectors: ["agriculture-dairy", "education", "education"] });
    expect(made.r.status).toBe(201);
    const id = Number(made.b.id);
    const stored = (await q("SELECT s.slug FROM contribution_scopes cs JOIN sectors s ON s.id = cs.sector_id WHERE cs.contribution_id = $1 ORDER BY s.slug", [id])).rows as { slug: string }[];
    expect(stored.map((x) => x.slug)).toEqual(["agriculture-dairy", "education"]);
    expect((await call(submit.POST, "POST", `/api/contributions/${id}/submit`, {}, id)).r.status).toBe(200);

    // pending items count nowhere; after the administrator approves it, each chosen sector counts it once and the third stays at 0
    signInAs(null);
    for (const slug of ["agriculture-dairy", "education", "healthcare"]) expect(await publishedCount(slug)).toBe(0);
    signInAs(admin, "admin");
    expect((await call(decision.POST, "POST", `/api/review/${id}/decision`, { action: "approve" }, id)).r.status).toBe(200);
    signInAs(null);
    expect(await publishedCount("agriculture-dairy")).toBe(1);
    expect(await publishedCount("education")).toBe(1);
    expect(await publishedCount("healthcare")).toBe(0);

    // unpublishing takes it out of every sector it was in
    signInAs(admin, "admin");
    expect((await call(decision.POST, "POST", `/api/review/${id}/decision`, { action: "unpublish", note: "Needs a correction." }, id)).r.status).toBe(200);
    signInAs(null);
    expect(await publishedCount("agriculture-dairy")).toBe(0);
    expect(await publishedCount("education")).toBe(0);
  });
});
