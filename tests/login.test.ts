// Login / logout API against an in-process PostgreSQL (real SQL, real migrations; see tests/helpers.ts).
import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakePool, pgError, seedUser, testDb } from "./helpers";
import { MAX_FAILURES } from "../src/lib/loginThrottle";
import { SESSION_COOKIE, verifySessionToken } from "../src/lib/session";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });

import { POST as login } from "../src/app/api/auth/login/route";
import { POST as logout } from "../src/app/api/auth/logout/route";

const PASSWORD = "correct horse";
const post = (body: unknown, headers: Record<string, string> = {}, raw?: string) =>
  login(new Request("http://localhost/api/auth/login", { method: "POST", headers, body: raw ?? JSON.stringify(body) }));
const cookieOf = (res: Response) => res.headers.get("set-cookie") ?? "";
const attemptRow = async (email: string) => ((await testDb().raw.query("select failures, locked_until from login_attempts where email = $1", [email])).rows[0] ?? null) as any;

let ctx: ReturnType<typeof makeFakePool>;
let logs: string[];
beforeEach(() => {
  ctx = makeFakePool();
  vi.stubEnv("SESSION_SECRET", "unit-test-secret-unit-test-secret-1234");
  logs = [];
  for (const fn of ["log", "error", "warn", "info"] as const) vi.spyOn(console, fn).mockImplementation((...a) => void logs.push(a.map(String).join(" ")));
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("POST /api/auth/login – success", () => {
  it("signs in, sets a signed HttpOnly session cookie, and never returns the hash", async () => {
    const u = await seedUser();
    const res = await post({ email: "Asha@Example.com", password: PASSWORD });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, user: { id: u.id, fullName: "Asha Rao", email: "asha@example.com", role: "TC" }, redirectTo: "/dashboard" });
    expect(JSON.stringify(body)).not.toMatch(/hash|\$2[aby]\$|password/i);

    const c = cookieOf(res);
    expect(c).toMatch(new RegExp(`^${SESSION_COOKIE}=`));
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=lax/i);
    expect(c).toMatch(/Path=\//i);
    expect(c).not.toMatch(/Max-Age|Expires/i); // browser-session cookie when "remember" is off
    const token = c.split(";")[0].split("=")[1];
    expect(verifySessionToken(token)).toMatchObject({ sub: u.id, role: "TC" });
    expect(token).not.toContain(PASSWORD);
  });

  it("'remember me' makes a 30-day persistent cookie", async () => {
    await seedUser();
    expect(cookieOf(await post({ email: "asha@example.com", password: PASSWORD, remember: true }))).toMatch(/Max-Age=2592000/i);
  });

  it("marks the cookie Secure in production", async () => {
    await seedUser();
    vi.stubEnv("NODE_ENV", "production");
    expect(cookieOf(await post({ email: "asha@example.com", password: PASSWORD }))).toMatch(/Secure/i);
  });

  it("normalises the email and queries with parameters only", async () => {
    await seedUser();
    await post({ email: "  ASHA@Example.COM ", password: PASSWORD });
    const q = ctx.calls.find((c) => /FROM users/.test(c.sql))!;
    expect(q.params).toEqual(["asha@example.com"]);
    expect(q.sql).toMatch(/\$1/);
    expect(q.sql).not.toMatch(/asha/i);
  });

  it("takes the role from the database; a client-supplied role is ignored", async () => {
    await seedUser();
    const res = await post({ email: "asha@example.com", password: PASSWORD, role: "SA", isAdmin: true });
    expect((await res.json()).user.role).toBe("TC");
    const token = cookieOf(res).split(";")[0].split("=")[1];
    expect(verifySessionToken(token)!.role).toBe("TC");
  });
});

describe("POST /api/auth/login – invalid input", () => {
  it.each([
    ["missing email", { password: PASSWORD }, "email"],
    ["blank email", { email: "  ", password: PASSWORD }, "email"],
    ["malformed email", { email: "not-an-email", password: PASSWORD }, "email"],
    ["missing password", { email: "asha@example.com" }, "password"],
    ["empty password", { email: "asha@example.com", password: "" }, "password"],
    ["non-string password", { email: "asha@example.com", password: 12345678 }, "password"],
  ])("400 for %s, without touching the database or counting an attempt", async (_n, body, field) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect((await res.json()).fieldErrors[field]).toBeTruthy();
    expect(ctx.calls).toHaveLength(0);
    expect(cookieOf(res)).toBe("");
  });

  it("400 for invalid JSON, 413 for oversized bodies", async () => {
    expect((await post(null, {}, "{nope")).status).toBe(400);
    expect((await post({ email: "a@b.co", password: "x".repeat(6000) })).status).toBe(413);
    expect(ctx.calls).toHaveLength(0);
  });
});

describe("POST /api/auth/login – bad credentials", () => {
  it("wrong password and unknown email give the identical generic 401", async () => {
    await seedUser();
    const wrong = await post({ email: "asha@example.com", password: "wrong password" });
    const unknown = await post({ email: "nobody@example.com", password: "whatever123" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(cookieOf(wrong)).toBe("");
    expect(cookieOf(unknown)).toBe("");
  });

  it("still runs a bcrypt comparison for unknown emails (no timing shortcut)", async () => {
    const spy = vi.spyOn(bcrypt, "compare");
    await post({ email: "nobody@example.com", password: "whatever123" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("rejects passwords longer than 72 bytes (bcrypt truncation) even if the prefix matches", async () => {
    await seedUser();
    expect((await post({ email: "asha@example.com", password: PASSWORD + "x".repeat(80) })).status).toBe(401);
  });
});

describe("POST /api/auth/login – lockout (stored in PostgreSQL)", () => {
  it("5 wrong attempts are 401, the 6th is 429 with Retry-After and the 'Too many failed attempts' message", async () => {
    await seedUser();
    for (let i = 0; i < MAX_FAILURES; i++) expect((await post({ email: "asha@example.com", password: "bad" + i })).status).toBe(401);
    const sixth = await post({ email: "asha@example.com", password: "bad6" });
    const b = await sixth.json();
    expect(sixth.status).toBe(429);
    expect(b.error).toBe("TOO_MANY_ATTEMPTS");
    expect(b.message).toMatch(/^Too many failed attempts/);
    expect(Number(sixth.headers.get("Retry-After"))).toBeGreaterThan(14 * 60); // ~15 minutes
    expect(Number(sixth.headers.get("Retry-After"))).toBeLessThanOrEqual(15 * 60);
    expect(b.retryAfterSeconds).toBe(Number(sixth.headers.get("Retry-After")));
  });

  it("while locked, even the right password is refused (and gets no cookie); other emails are unaffected", async () => {
    await seedUser();
    await seedUser({ email: "other@example.com", fullName: "Other" });
    for (let i = 0; i < MAX_FAILURES; i++) await post({ email: "asha@example.com", password: "bad" + i });
    const locked = await post({ email: "asha@example.com", password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(cookieOf(locked)).toBe("");
    expect((await post({ email: "other@example.com", password: PASSWORD })).status).toBe(200);
  });

  it("the counter lives in the database and is visible to a brand-new server instance", async () => {
    await seedUser();
    for (let i = 0; i < MAX_FAILURES; i++) await post({ email: "asha@example.com", password: "bad" + i });
    expect(await attemptRow("asha@example.com")).toMatchObject({ failures: 5 });
    vi.resetModules(); // simulate another serverless instance: no shared memory at all
    const { POST: freshLogin } = await import("../src/app/api/auth/login/route");
    const res = await freshLogin(new Request("http://localhost/api/auth/login", { method: "POST", body: JSON.stringify({ email: "asha@example.com", password: PASSWORD }) }));
    expect(res.status).toBe(429);
  });

  it("a successful login before the limit clears the counter", async () => {
    await seedUser();
    for (let i = 0; i < MAX_FAILURES - 1; i++) await post({ email: "asha@example.com", password: "bad" + i });
    expect(await attemptRow("asha@example.com")).toMatchObject({ failures: 4 });
    expect((await post({ email: "asha@example.com", password: PASSWORD })).status).toBe(200);
    expect(await attemptRow("asha@example.com")).toBeNull();
    for (let i = 0; i < MAX_FAILURES; i++) expect((await post({ email: "asha@example.com", password: "bad" + i })).status).toBe(401);
  });

  it("failed logins for unknown emails are counted too (no account enumeration through the limiter)", async () => {
    for (let i = 0; i < MAX_FAILURES; i++) expect((await post({ email: "ghost@example.com", password: "x" + i })).status).toBe(401);
    expect((await post({ email: "ghost@example.com", password: "x6" })).status).toBe(429);
  });

  it("a burst of parallel guesses is cut off at the limit", async () => {
    await seedUser();
    const codes = await Promise.all(Array.from({ length: 12 }, (_, i) => post({ email: "asha@example.com", password: "guess" + i }).then((r) => r.status)));
    expect(codes.filter((c) => c === 401)).toHaveLength(MAX_FAILURES);
    expect(codes.filter((c) => c === 429)).toHaveLength(12 - MAX_FAILURES);
  });
});

describe("POST /api/auth/login – verification policy", () => {
  it("refuses accounts whose email is not verified (after a correct password) without counting it as a failure", async () => {
    await seedUser({ emailVerification: "none" });
    const res = await post({ email: "asha@example.com", password: PASSWORD });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("EMAIL_NOT_VERIFIED");
    expect(cookieOf(res)).toBe("");
    expect(await attemptRow("asha@example.com")).toBeNull();
  });

  it("does not reveal verification status for a wrong password", async () => {
    await seedUser({ emailVerification: "none" });
    expect((await post({ email: "asha@example.com", password: "nope nope" })).status).toBe(401);
  });

  it("mock-verified accounts can sign in outside production but not in production", async () => {
    await seedUser({ emailVerification: "mock" });
    expect((await post({ email: "asha@example.com", password: PASSWORD })).status).toBe(200);
    vi.stubEnv("NODE_ENV", "production");
    expect((await post({ email: "asha@example.com", password: PASSWORD })).status).toBe(403);
  });
});

describe("POST /api/auth/login – failures and hardening", () => {
  it("503 without SESSION_SECRET and no cookie, and the database is not touched", async () => {
    await seedUser();
    ctx.calls.length = 0;
    vi.stubEnv("SESSION_SECRET", "");
    const res = await post({ email: "asha@example.com", password: PASSWORD });
    expect(res.status).toBe(503);
    expect(cookieOf(res)).toBe("");
    expect(ctx.calls).toHaveLength(0);
  });

  it("safe 500 when the user lookup fails; nothing sensitive in the response or logs", async () => {
    await seedUser();
    ctx = makeFakePool((sql) => (/FROM users/.test(sql) ? Object.assign(new Error('relation "users" secret-host'), { code: "42P01" }) : undefined));
    const res = await post({ email: "asha@example.com", password: PASSWORD });
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toMatch(/relation|secret-host|42P01/);
    expect(logs.join("\n")).not.toMatch(new RegExp(`${PASSWORD}|asha@example.com|secret-host`));
  });

  it("fails closed when the lockout table is unavailable: no login without the limiter", async () => {
    await seedUser();
    ctx = makeFakePool((sql) => (/login_attempts/.test(sql) ? pgError("42P01") : undefined));
    const res = await post({ email: "asha@example.com", password: PASSWORD });
    expect(res.status).toBe(500);
    expect(cookieOf(res)).toBe("");
  });

  it("never logs the password, even on failures", async () => {
    await post({ email: "asha@example.com", password: "very-secret-guess" });
    expect(logs.join("\n")).not.toContain("very-secret-guess");
  });

  it("blocks cross-origin browser requests before touching the database", async () => {
    await seedUser();
    ctx.calls.length = 0;
    const res = await post({ email: "asha@example.com", password: PASSWORD }, { origin: "https://evil.example", host: "localhost" });
    expect(res.status).toBe(403);
    expect(ctx.calls).toHaveLength(0);
    expect((await post({ email: "asha@example.com", password: PASSWORD }, { origin: "http://localhost", host: "localhost" })).status).toBe(200);
  });
});

describe("POST /api/auth/logout", () => {
  it("expires the session cookie", async () => {
    const res = await logout(new Request("http://localhost/api/auth/logout", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(cookieOf(res)).toMatch(new RegExp(`${SESSION_COOKIE}=;`));
    expect(cookieOf(res)).toMatch(/Max-Age=0/i);
    expect(cookieOf(res)).toMatch(/HttpOnly/i);
  });
  it("blocks cross-origin logout", async () => {
    const res = await logout(new Request("http://localhost/x", { method: "POST", headers: { origin: "https://evil.example", host: "localhost" } }));
    expect(res.status).toBe(403);
  });
});
