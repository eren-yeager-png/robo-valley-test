// A session issued BEFORE the person's password last changed (a reset) is refused; everything else keeps working.
// users.password_changed_at is read in the same query that already loads the user, so this costs no extra database round trip.
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";
import { createSessionToken, sessionRevoked } from "../src/lib/session";

const m = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "rv_session" && m.cookie ? { name: n, value: m.cookie } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error("REDIRECT:" + to); } }));

import { getCurrentUser } from "../src/lib/currentUser";
import { getAdminContext } from "../src/lib/admin";
import { GET as sessionRoute } from "../src/app/api/auth/session/route";
import { GET as meRoute } from "../src/app/api/auth/me/route";
import { GET as mineRoute } from "../src/app/api/contributions/mine/route";
import { GET as queueRoute } from "../src/app/api/review/queue/route";
import { POST as moderatorsRoute } from "../src/app/api/admin/moderators/route";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
const NOW = Date.now();
const tokenAt = (id: number | string, role: string, atMs: number) => createSessionToken({ id: String(id), role }, false, atMs, { SESSION_SECRET: SECRET } as never).token;
const setCookie = (t: string | undefined) => { m.cookie = t; };
/** A correctly SIGNED cookie that has no iat at all, like one issued by an older build. */
function tokenWithoutIat(id: number | string, role: string): string {
  const body = Buffer.from(JSON.stringify({ v: 1, sub: String(id), role, exp: Math.floor(NOW / 1000) + 3600, rem: false })).toString("base64url");
  return `${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
}
const changedAt = (id: number, ms: number) => q("UPDATE users SET password_changed_at = $2 WHERE id = $1", [id, new Date(ms).toISOString()]);
let seq = 0;
const person = async (role = "ST") => Number((await seedUser({ email: `s${++seq}@example.com`, role, fullName: `Person ${seq}` })).id);
let ipn = 0;
const hdr = () => ({ host: "localhost", "x-forwarded-for": `60.0.0.${++ipn % 250}` });

beforeEach(() => { vi.stubEnv("SESSION_SECRET", SECRET); vi.spyOn(console, "error").mockImplementation(() => undefined); setCookie(undefined); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); testDb().failOn(undefined); });

describe("sessionRevoked (the rule)", () => {
  const t = Date.parse("2026-03-01T10:00:00.700Z"), sec = Math.floor(t / 1000);
  it("no change on record: never refused, with or without an iat", () => {
    expect(sessionRevoked({ iat: 1 }, null)).toBe(false);
    expect(sessionRevoked({ iat: 1 }, undefined)).toBe(false);
    expect(sessionRevoked({}, null)).toBe(false);
    expect(sessionRevoked({ iat: "x" }, null)).toBe(false);
  });
  it("a change on record: refused when issued earlier, kept when issued in the same second or later", () => {
    const d = new Date(t);
    expect(sessionRevoked({ iat: sec - 1 }, d)).toBe(true);
    expect(sessionRevoked({ iat: sec - 3600 }, d)).toBe(true);
    expect(sessionRevoked({ iat: sec }, d)).toBe(false); // signed in 0.2 s after the reset: must work
    expect(sessionRevoked({ iat: sec + 1 }, d)).toBe(false);
    expect(sessionRevoked({ iat: sec + 86400 }, d)).toBe(false);
  });
  it("a change on record and no usable iat: refused", () => {
    for (const s of [{}, { iat: undefined }, { iat: null }, { iat: "123" }, { iat: NaN }, { iat: Infinity }]) expect(sessionRevoked(s as never, new Date(t))).toBe(true);
  });
  it("accepts the date as a Date or as text; an unreadable date fails closed", () => {
    expect(sessionRevoked({ iat: sec - 1 }, new Date(t).toISOString())).toBe(true);
    expect(sessionRevoked({ iat: sec + 1 }, new Date(t).toISOString())).toBe(false);
    expect(sessionRevoked({ iat: sec + 1 }, "not a date")).toBe(true);
  });
});

describe("getCurrentUser", () => {
  it("an old session is refused after a reset; a session issued after it works; another user is unaffected", async () => {
    const a = await person(), b = await person();
    const oldA = tokenAt(a, "ST", NOW - 600_000), oldB = tokenAt(b, "ST", NOW - 600_000);
    setCookie(oldA); expect((await getCurrentUser())?.id).toBe(String(a)); // before the reset it works
    await changedAt(a, NOW - 300_000); // A resets 5 minutes ago
    setCookie(oldA); expect(await getCurrentUser()).toBeNull(); // old session refused
    setCookie(tokenAt(a, "ST", NOW - 120_000)); expect((await getCurrentUser())?.id).toBe(String(a)); // signed in after the reset
    setCookie(oldB); expect((await getCurrentUser())?.id).toBe(String(b)); // B never reset: the same old cookie still works
  });
  it("a cookie WITHOUT iat stays valid unless that user has a password_changed_at", async () => {
    const a = await person(), b = await person();
    setCookie(tokenWithoutIat(a, "ST")); expect((await getCurrentUser())?.id).toBe(String(a)); // nobody is signed out by the deploy
    setCookie(tokenWithoutIat(b, "ST")); expect((await getCurrentUser())?.id).toBe(String(b));
    await changedAt(a, NOW - 60_000);
    setCookie(tokenWithoutIat(a, "ST")); expect(await getCurrentUser()).toBeNull(); // A reset: an old-style cookie cannot prove it is newer
    setCookie(tokenWithoutIat(b, "ST")); expect((await getCurrentUser())?.id).toBe(String(b)); // B is unaffected
  });
  it("a session issued in the same second as the change is kept", async () => {
    const a = await person();
    const t = NOW - 5_000; await changedAt(a, t);
    setCookie(tokenAt(a, "ST", t + 200)); // 0.2 s later, same second at worst
    expect((await getCurrentUser())?.id).toBe(String(a));
  });
  it("the check adds no database query: exactly one query per call, with or without a change on record", async () => {
    const a = await person(); let asked = 0;
    testDb().failOn(() => { asked += 1; return undefined; });
    setCookie(tokenAt(a, "ST", NOW)); await getCurrentUser();
    expect(asked).toBe(1);
    await changedAt(a, NOW - 100_000); asked = 0;
    setCookie(tokenAt(a, "ST", NOW)); await getCurrentUser();
    expect(asked).toBe(1);
  });
  it("before migration 020 (no column) it falls back to the old query: nobody is signed out", async () => {
    const a = await person(); setCookie(tokenAt(a, "ST", NOW - 3600_000));
    testDb().failOn((sql) => (/password_changed_at/.test(sql) ? Object.assign(new Error('column "password_changed_at" does not exist'), { code: "42703" }) : undefined));
    expect((await getCurrentUser())?.id).toBe(String(a));
  });
  it("a different database error is still a refusal, not a pass", async () => {
    const a = await person(); setCookie(tokenAt(a, "ST", NOW));
    testDb().failOn((sql) => (/FROM users/.test(sql) ? Object.assign(new Error("down"), { code: "08006" }) : undefined));
    expect(await getCurrentUser()).toBeNull();
  });
  it("a forged or tampered cookie is still refused, and the role still comes from the database", async () => {
    const a = await person("ST"); setCookie(tokenAt(a, "admin", NOW)); // claims admin
    const u = await getCurrentUser(); expect(u?.role).toBe("ST");
    setCookie(tokenAt(a, "ST", NOW).replace(/.$/, (c) => (c === "A" ? "B" : "A"))); expect(await getCurrentUser()).toBeNull();
  });
});

describe("every protected entry point honours it", () => {
  const call = (fn: unknown, method: string, url: string, body?: unknown) =>
    (fn as (r: Request) => Promise<Response>)(new Request("http://localhost" + url, { method, headers: { ...hdr(), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));

  it("pages and APIs answer an old session like a signed-out visitor, and a new one (or an untouched account) normally", async () => {
    const admin = await person("admin"), other = await person("admin");
    await changedAt(admin, NOW - 300_000);
    const oldTok = tokenAt(admin, "admin", NOW - 600_000), newTok = tokenAt(admin, "admin", NOW - 60_000);

    // refused: the same answers a visitor gets
    setCookie(oldTok);
    expect((await getAdminContext()).status).toBe("anonymous");
    expect((await call(mineRoute, "GET", "/api/contributions/mine")).status).toBe(401);
    expect((await call(queueRoute, "GET", "/api/review/queue")).status).toBe(401);
    expect((await call(moderatorsRoute, "POST", "/api/admin/moderators", { userId: other, moderator: true })).status).toBe(401);
    expect((await call(meRoute, "GET", "/api/auth/me")).status).toBeLessThan(500);
    const me = await (await call(meRoute, "GET", "/api/auth/me")).json();
    expect(JSON.stringify(me)).not.toMatch(/admin/i);
    const s1 = await sessionRoute(new NextRequest("http://localhost/api/auth/session", { headers: { cookie: `rv_session=${oldTok}`, host: "localhost" } }));
    expect(s1.status).toBe(401);

    // allowed: a session issued after the reset
    setCookie(newTok);
    expect((await getAdminContext()).status).toBe("ok");
    expect((await call(mineRoute, "GET", "/api/contributions/mine")).status).toBe(200);
    expect((await call(queueRoute, "GET", "/api/review/queue")).status).toBe(200);
    const s2 = await sessionRoute(new NextRequest("http://localhost/api/auth/session", { headers: { cookie: `rv_session=${newTok}`, host: "localhost" } }));
    expect(s2.status).toBe(200);
    expect((await s2.json()).authenticated).toBe(true);

    // allowed: the other administrator never reset, so even an old cookie works
    setCookie(tokenAt(other, "admin", NOW - 600_000));
    expect((await getAdminContext()).status).toBe("ok");
    expect((await call(queueRoute, "GET", "/api/review/queue")).status).toBe(200);
  });

  it("the WordPress session check answers 401 for an old session and 200 for a cookie without iat when nothing was reset", async () => {
    const a = await person();
    const res = (tok: string) => sessionRoute(new NextRequest("http://localhost/api/auth/session", { headers: { cookie: `rv_session=${tok}`, host: "localhost" } }));
    expect((await res(tokenWithoutIat(a, "ST"))).status).toBe(200);
    await changedAt(a, NOW - 10_000);
    expect((await res(tokenWithoutIat(a, "ST"))).status).toBe(401);
    expect((await res(tokenAt(a, "ST", NOW - 3600_000))).status).toBe(401);
    expect((await res(tokenAt(a, "ST", NOW))).status).toBe(200);
  });
});
