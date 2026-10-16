import bcrypt from "bcryptjs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetLoginThrottle, MAX_FAILURES } from "../src/lib/loginThrottle";
import { SESSION_COOKIE, verifySessionToken } from "../src/lib/session";

const m = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/lib/db", () => ({ pool: { query: m.query } }));

import { POST as login } from "../src/app/api/auth/login/route";
import { POST as logout } from "../src/app/api/auth/logout/route";

const PASSWORD = "correct horse";
let HASH: string;
beforeAll(async () => { HASH = await bcrypt.hash(PASSWORD, 4); }); // low cost: speed only

const row = (over: Record<string, unknown> = {}) => ({
  id: "7", full_name: "Asha Rao", email: "asha@example.com", role: "TC", password_hash: HASH, email_verification: "email", ...over,
});
const post = (body: unknown, headers: Record<string, string> = {}, raw?: string) =>
  login(new Request("http://localhost/api/auth/login", { method: "POST", headers, body: raw ?? JSON.stringify(body) }));
const cookieOf = (res: Response) => res.headers.get("set-cookie") ?? "";

let logs: string[];
beforeEach(() => {
  __resetLoginThrottle();
  m.query.mockReset().mockResolvedValue({ rows: [row()] });
  vi.stubEnv("SESSION_SECRET", "unit-test-secret-unit-test-secret-1234");
  logs = [];
  for (const fn of ["log", "error", "warn", "info"] as const) vi.spyOn(console, fn).mockImplementation((...a) => void logs.push(a.map(String).join(" ")));
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("POST /api/auth/login – success", () => {
  it("signs in, sets a signed HttpOnly session cookie, and never returns the hash", async () => {
    const res = await post({ email: "Asha@Example.com", password: PASSWORD });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, user: { id: "7", fullName: "Asha Rao", email: "asha@example.com", role: "TC" }, redirectTo: "/dashboard" });
    expect(JSON.stringify(body)).not.toMatch(/hash|\$2[aby]\$|password/i);

    const c = cookieOf(res);
    expect(c).toMatch(new RegExp(`^${SESSION_COOKIE}=`));
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=lax/i);
    expect(c).toMatch(/Path=\//i);
    expect(c).not.toMatch(/Max-Age|Expires/i); // browser-session cookie when "remember" is off
    const token = c.split(";")[0].split("=")[1];
    expect(verifySessionToken(token)).toMatchObject({ sub: "7", role: "TC" });
    expect(token).not.toContain(PASSWORD);
  });

  it("'remember me' makes a 30-day persistent cookie", async () => {
    const res = await post({ email: "asha@example.com", password: PASSWORD, remember: true });
    expect(cookieOf(res)).toMatch(/Max-Age=2592000/i);
  });

  it("marks the cookie Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(cookieOf(await post({ email: "asha@example.com", password: PASSWORD }))).toMatch(/Secure/i);
  });

  it("normalises the email and queries with parameters only", async () => {
    await post({ email: "  ASHA@Example.COM ", password: PASSWORD });
    const [sql, params] = m.query.mock.calls[0];
    expect(params).toEqual(["asha@example.com"]);
    expect(sql).toMatch(/\$1/);
    expect(sql).not.toMatch(/asha/i);
  });

  it("takes the role from the database; a client-supplied role is ignored", async () => {
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
  ])("400 for %s, without touching the database", async (_n, body, field) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect((await res.json()).fieldErrors[field]).toBeTruthy();
    expect(m.query).not.toHaveBeenCalled();
    expect(cookieOf(res)).toBe("");
  });

  it("400 for invalid JSON, 413 for oversized bodies", async () => {
    expect((await post(null, {}, "{nope")).status).toBe(400);
    expect((await post({ email: "a@b.co", password: "x".repeat(6000) })).status).toBe(413);
  });
});

describe("POST /api/auth/login – bad credentials", () => {
  it("wrong password and unknown email give the identical generic 401", async () => {
    const wrong = await post({ email: "asha@example.com", password: "wrong password" });
    m.query.mockResolvedValue({ rows: [] });
    const unknown = await post({ email: "nobody@example.com", password: "whatever123" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(cookieOf(wrong)).toBe("");
    expect(cookieOf(unknown)).toBe("");
  });

  it("still runs a bcrypt comparison for unknown emails (no timing shortcut)", async () => {
    const spy = vi.spyOn(bcrypt, "compare");
    m.query.mockResolvedValue({ rows: [] });
    await post({ email: "nobody@example.com", password: "whatever123" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("rejects passwords longer than 72 bytes (bcrypt truncation) even if the prefix matches", async () => {
    const res = await post({ email: "asha@example.com", password: PASSWORD + "x".repeat(80) });
    expect(res.status).toBe(401);
  });

  it("locks an email after repeated failures, even for the right password, with Retry-After", async () => {
    for (let i = 0; i < MAX_FAILURES; i++) expect((await post({ email: "asha@example.com", password: "bad" + i })).status).toBe(401);
    const locked = await post({ email: "asha@example.com", password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(cookieOf(locked)).toBe("");
    expect((await post({ email: "other@example.com", password: PASSWORD })).status).toBe(200); // other emails unaffected
  });

  it("a successful login resets the failure counter", async () => {
    for (let i = 0; i < MAX_FAILURES - 1; i++) await post({ email: "asha@example.com", password: "bad" + i });
    expect((await post({ email: "asha@example.com", password: PASSWORD })).status).toBe(200);
    for (let i = 0; i < MAX_FAILURES - 1; i++) expect((await post({ email: "asha@example.com", password: "bad" + i })).status).toBe(401);
  });
});

describe("POST /api/auth/login – verification policy", () => {
  it("refuses accounts whose email is not verified (after a correct password)", async () => {
    m.query.mockResolvedValue({ rows: [row({ email_verification: "none" })] });
    const res = await post({ email: "asha@example.com", password: PASSWORD });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("EMAIL_NOT_VERIFIED");
    expect(cookieOf(res)).toBe("");
  });

  it("does not reveal verification status for a wrong password", async () => {
    m.query.mockResolvedValue({ rows: [row({ email_verification: "none" })] });
    expect((await post({ email: "asha@example.com", password: "nope nope" })).status).toBe(401);
  });

  it("mock-verified accounts can sign in outside production but not in production", async () => {
    m.query.mockResolvedValue({ rows: [row({ email_verification: "mock" })] });
    expect((await post({ email: "asha@example.com", password: PASSWORD })).status).toBe(200);
    vi.stubEnv("NODE_ENV", "production");
    expect((await post({ email: "asha@example.com", password: PASSWORD })).status).toBe(403);
  });
});

describe("POST /api/auth/login – failures and hardening", () => {
  it("503 without SESSION_SECRET and no cookie", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    const res = await post({ email: "asha@example.com", password: PASSWORD });
    expect(res.status).toBe(503);
    expect(cookieOf(res)).toBe("");
    expect(m.query).not.toHaveBeenCalled();
  });

  it("safe 500 on database errors; nothing sensitive in the response or logs", async () => {
    m.query.mockRejectedValue(Object.assign(new Error('relation "users" secret-host'), { code: "42P01" }));
    const res = await post({ email: "asha@example.com", password: PASSWORD });
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toMatch(/relation|secret-host|42P01/);
    expect(logs.join("\n")).not.toMatch(new RegExp(`${PASSWORD}|asha@example.com|secret-host`));
  });

  it("never logs the password, even on failures", async () => {
    await post({ email: "asha@example.com", password: "very-secret-guess" });
    expect(logs.join("\n")).not.toContain("very-secret-guess");
  });

  it("blocks cross-origin browser requests", async () => {
    const res = await post({ email: "asha@example.com", password: PASSWORD }, { origin: "https://evil.example", host: "localhost" });
    expect(res.status).toBe(403);
    expect(m.query).not.toHaveBeenCalled();
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
