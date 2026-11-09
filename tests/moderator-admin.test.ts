// The admin-only moderator route (POST /api/admin/moderators) and the self-service profile route, with real SQL on the
// in-process database (tests/helpers.ts). No real database, email or network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";
import { createSessionToken } from "../src/lib/session";

const m = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "rv_session" && m.cookie ? { name: n, value: m.cookie } : undefined) }),
}));

import { POST as moderators } from "../src/app/api/admin/moderators/route";
import { PATCH as profile } from "../src/app/api/account/profile/route";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const tokenFor = (id: string, role: string) => createSessionToken({ id, role }, false, Date.now(), { SESSION_SECRET: SECRET } as never).token;
const signIn = (id: string, role: string) => { m.cookie = tokenFor(id, role); };
const call = (handler: (r: Request) => Promise<Response>, method: string, body: unknown, headers: Record<string, string> = {}) =>
  handler(new Request("http://localhost/api/x", { method, headers: { "content-type": "application/json", host: "localhost", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p);
const flag = async (id: string) => ((await q("select is_moderator f from users where id=$1", [id])).rows[0] as any).f as boolean;
const auditRows = async () => (await q("select admin_id::text a, target_user_id::text t, granted g from moderator_audit order by id")).rows as any[];
let logs: string[];

async function people() {
  const admin = await seedUser({ email: "admin@robovalley.com", role: "admin", fullName: "Olga Admin" });
  const admin2 = await seedUser({ email: "second.admin@example.com", role: "admin", fullName: "Dev Admin" });
  const user = await seedUser({ email: "ravi@example.com", role: "TC", fullName: "Ravi Kumar" });
  const mod = await seedUser({ email: "meera@example.com", role: "TC", fullName: "Meera Moderator" });
  await q("update users set is_moderator = true where id = $1", [mod.id]);
  await q("delete from moderator_audit"); // start the test from a clean trail
  return { admin, admin2, user, mod };
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  m.cookie = undefined;
  logs = [];
  for (const fn of ["log", "error", "warn", "info"] as const) vi.spyOn(console, fn).mockImplementation((...a) => void logs.push(a.map(String).join(" ")));
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("POST /api/admin/moderators: who can use it", () => {
  it("401 without a session and for a forged cookie; nothing changes", async () => {
    const { user, admin } = await people();
    expect((await call(moderators, "POST", { userId: user.id, moderator: true })).status).toBe(401);
    m.cookie = tokenFor(admin.id, "admin").slice(0, -3) + "AAA";
    expect((await call(moderators, "POST", { userId: user.id, moderator: true })).status).toBe(401);
    expect(await flag(user.id)).toBe(false);
    expect(await auditRows()).toEqual([]);
  });

  it("403 for an ordinary user and for a moderator who is not an admin; nobody can make themselves one", async () => {
    const { user, mod } = await people();
    signIn(user.id, "TC");
    expect((await call(moderators, "POST", { userId: user.id, moderator: true })).status).toBe(403); // self-grant by an ordinary user
    expect(await flag(user.id)).toBe(false);
    signIn(mod.id, "TC");
    expect((await call(moderators, "POST", { userId: user.id, moderator: true })).status).toBe(403);
    expect((await call(moderators, "POST", { userId: mod.id, moderator: false })).status).toBe(403);
    expect(await flag(mod.id)).toBe(true);
    expect(await auditRows()).toEqual([]);
  });

  it("the role comes from the database, not from the cookie: a forged 'admin' role for an ordinary user is refused", async () => {
    const { user } = await people();
    signIn(user.id, "admin"); // a token that claims admin for a user whose real role is TC
    expect((await call(moderators, "POST", { userId: user.id, moderator: true })).status).toBe(403);
    expect(await flag(user.id)).toBe(false);
  });

  it("a request from a foreign website origin is refused even for an admin", async () => {
    const { admin, user } = await people();
    signIn(admin.id, "admin");
    expect((await call(moderators, "POST", { userId: user.id, moderator: true }, { origin: "https://evil.example" })).status).toBe(403);
    expect(await flag(user.id)).toBe(false);
  });
});

describe("POST /api/admin/moderators: what an admin can do", () => {
  it("grants and removes the flag for another user, and every change is audited with the admin's id", async () => {
    const { admin, admin2, user } = await people();
    signIn(admin.id, "admin");
    let r = await call(moderators, "POST", { userId: user.id, moderator: true });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ success: true, userId: Number(user.id), moderator: true, changed: true });
    expect(await flag(user.id)).toBe(true);
    r = await call(moderators, "POST", { userId: user.id, moderator: true }); // repeat: nothing to change
    expect((await r.json()).changed).toBe(false);
    signIn(admin2.id, "admin");
    r = await call(moderators, "POST", { userId: user.id, moderator: false });
    expect((await r.json()).changed).toBe(true);
    expect(await flag(user.id)).toBe(false);
    expect(await auditRows()).toEqual([{ a: admin.id, t: user.id, g: true }, { a: admin2.id, t: user.id, g: false }]);
  });

  it("an admin cannot change their own flag (403), and nothing is recorded", async () => {
    const { admin } = await people();
    signIn(admin.id, "admin");
    const r = await call(moderators, "POST", { userId: admin.id, moderator: true });
    expect(r.status).toBe(403);
    expect(await flag(admin.id)).toBe(false);
    expect(await auditRows()).toEqual([]);
  });

  it("the role is not changed by the flag", async () => {
    const { admin, user } = await people();
    signIn(admin.id, "admin");
    await call(moderators, "POST", { userId: user.id, moderator: true });
    expect(((await q("select role from users where id=$1", [user.id])).rows[0] as any).role).toBe("TC");
  });

  it("400 for a bad body, 404 for an unknown user, and 413/400 for oversized or invalid JSON", async () => {
    const { admin } = await people();
    signIn(admin.id, "admin");
    for (const body of [{}, { userId: "x", moderator: true }, { userId: 5 }, { userId: 5, moderator: "true" }, { userId: -1, moderator: true }, { userId: 1.5, moderator: true }, [], null]) {
      expect((await call(moderators, "POST", body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await call(moderators, "POST", { userId: 999999, moderator: true })).status).toBe(404);
    expect((await call(moderators, "POST", "{not json")).status).toBe(400);
    expect((await call(moderators, "POST", { userId: 1, moderator: true, pad: "x".repeat(2000) })).status).toBe(413);
  });

  it("logs no ids, names, emails or SQL, and the audit table holds ids only", async () => {
    const { admin, user } = await people();
    signIn(admin.id, "admin");
    await call(moderators, "POST", { userId: user.id, moderator: true });
    await call(moderators, "POST", { userId: admin.id, moderator: true });
    await call(moderators, "POST", "{bad");
    expect(logs.join("\n")).not.toMatch(/ravi|olga|admin@|@example|moderator_audit|select |update /i);
  });
});

describe("a user cannot reach the flag through their own profile", () => {
  it("PATCH /api/account/profile rejects isModerator / is_moderator / role, and the flag stays off", async () => {
    const { user } = await people();
    signIn(user.id, "TC");
    for (const body of [{ isModerator: true }, { is_moderator: true }, { moderator: true }, { role: "admin" }, { fullName: "Ravi K", isModerator: true }]) {
      const r = await call(profile, "PATCH", body, { origin: "http://localhost" });
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect(await flag(user.id)).toBe(false);
    expect(((await q("select role from users where id=$1", [user.id])).rows[0] as any).role).toBe("TC");
    expect(await auditRows()).toEqual([]);
  });

  it("a normal profile edit works and leaves the flag exactly as it was", async () => {
    const { user, mod } = await people();
    signIn(mod.id, "TC");
    const r = await call(profile, "PATCH", { fullName: "Meera M" }, { origin: "http://localhost" });
    expect(r.status).toBe(200);
    expect(await flag(mod.id)).toBe(true);
    expect(await flag(user.id)).toBe(false);
    expect(await auditRows()).toEqual([]); // changing a name is not a change of the flag
  });
});
