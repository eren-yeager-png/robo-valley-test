// Password reset through the real routes, the real migrations (020) and real bcrypt, with the e-mail module replaced by a recorder.
import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";
import { createSessionToken } from "../src/lib/session";

const h = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  pending: [] as Array<() => Promise<void>>,
  resetMails: [] as Array<{ to: string; link: string; minutes: number }>,
  changedMails: [] as Array<{ to: string; url: string }>,
  failSend: false,
}));
vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "rv_session" && h.cookie ? { name: n, value: h.cookie } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => Promise<void>) => { h.pending.push(fn); } }));
vi.mock("../src/lib/email", async (orig) => {
  const real = await orig<typeof import("../src/lib/email")>();
  return {
    ...real,
    sendPasswordResetEmail: vi.fn(async (to: string, link: string, minutes: number) => { if (h.failSend) throw new real.EmailSendError("boom"); h.resetMails.push({ to, link, minutes }); return "sent"; }),
    sendPasswordChangedEmail: vi.fn(async (to: string, url: string) => { h.changedMails.push({ to, url }); return "sent"; }),
  };
});

import { POST as forgot } from "../src/app/api/auth/password/forgot/route";
import { POST as reset } from "../src/app/api/auth/password/reset/route";
import { POST as login } from "../src/app/api/auth/login/route";
import { getCurrentUser } from "../src/lib/currentUser";
import { hashToken, resetAvailable, resetConfigured } from "../src/lib/passwordReset";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
const APP = "https://app.example.test";
let ipn = 0;
const ip = () => `70.${Math.floor(++ipn / 250)}.${ipn % 250}.9`;
const post = async (fn: (r: Request) => Promise<Response>, path: string, body: unknown, headers: Record<string, string> = {}) => {
  const r = await fn(new Request("http://localhost" + path, { method: "POST", headers: { host: "localhost", "content-type": "application/json", "x-forwarded-for": ip(), ...headers }, body: JSON.stringify(body) }));
  return { r, b: (await r.json()) as any };
};
const flush = async () => { while (h.pending.length) await h.pending.shift()!(); };
const tokenOf = (link: string) => /#token=([A-Za-z0-9_-]+)$/.exec(link)?.[1] ?? "";
let seq = 0;
const account = async (password = "old password 1") => {
  const email = `reset${++seq}@example.com`;
  const u = await seedUser({ email, role: "ST", fullName: "Reset Person" });
  await q("UPDATE users SET password_hash = $2, email_verification = 'email' WHERE id = $1", [u.id, await bcrypt.hash(password, 4)]);
  return { id: String(u.id), email };
};
const askFor = async (email: string, headers?: Record<string, string>) => { const x = await post(forgot, "/api/auth/password/forgot", { email }, headers); await flush(); return x; };
const linkFor = async (email: string) => { h.resetMails.length = 0; await askFor(email); return h.resetMails[0]?.link ?? ""; };
const choose = (token: string, password: string, confirmPassword = password, headers?: Record<string, string>) => post(reset, "/api/auth/password/reset", { token, password, confirmPassword }, headers);
const hashOf = async (id: string) => String((await q("SELECT password_hash FROM users WHERE id = $1", [id])).rows[0] && ((await q("SELECT password_hash FROM users WHERE id = $1", [id])).rows[0] as any).password_hash);

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("APP_URL", APP);
  h.cookie = undefined; h.pending.length = 0; h.resetMails.length = 0; h.changedMails.length = 0; h.failSend = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  await q("DELETE FROM api_rate_limits");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); testDb().failOn(undefined); });

describe("asking for a link", () => {
  it("answers exactly the same for an existing and an unknown address; only the existing one gets a mail and a token", async () => {
    const a = await account();
    const known = await askFor(a.email), unknown = await askFor("nobody-here@example.com");
    expect(known.r.status).toBe(200); expect(unknown.r.status).toBe(200);
    expect(known.b).toEqual(unknown.b);
    expect(known.b.message).toMatch(/If an account exists/);
    expect(h.resetMails).toHaveLength(1);
    expect(h.resetMails[0].to).toBe(a.email);
    expect(Number(((await q("SELECT count(*)::int n FROM password_reset_tokens")).rows[0] as any).n)).toBe(1);
  });

  it("the link points to APP_URL (never the request's Host), carries the token in the fragment, and only its hash is stored", async () => {
    const a = await account();
    await askFor(a.email, { host: "evil.example" }); // a forged Host header (as a script could send): the link must still use APP_URL
    const link = h.resetMails[0].link;
    expect(link.startsWith(`${APP}/reset-password#token=`)).toBe(true);
    const token = tokenOf(link);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = (await q("SELECT token_hash, expires_at - created_at AS life FROM password_reset_tokens")).rows as any[];
    expect(rows.map((r) => r.token_hash)).toEqual([hashToken(token)]);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(h.resetMails[0].minutes).toBe(45);
  });

  it("the address is case-insensitive like sign-in, and a malformed address is a plain 400", async () => {
    const a = await account();
    await askFor(a.email.toUpperCase());
    expect(h.resetMails).toHaveLength(1);
    expect((await post(forgot, "/api/auth/password/forgot", { email: "not an email" })).r.status).toBe(400);
  });

  it("a request from another website is refused (403) and sends nothing", async () => {
    const a = await account();
    const x = await askFor(a.email, { origin: "https://evil.example" });
    expect(x.r.status).toBe(403);
    expect(h.resetMails).toHaveLength(0);
  });

  it("per e-mail address: after 3 in an hour the answer stays the same but no more mail is sent", async () => {
    const a = await account();
    const answers = [];
    for (let i = 0; i < 5; i++) answers.push((await askFor(a.email)).b);
    expect(new Set(answers.map((b) => JSON.stringify(b))).size).toBe(1);
    expect(h.resetMails).toHaveLength(3);
  });

  it("per visitor address: the 6th request in 15 minutes from one address gets 429 with Retry-After", async () => {
    const same = { "x-forwarded-for": "9.9.9.9" };
    for (let i = 0; i < 5; i++) expect((await post(forgot, "/api/auth/password/forgot", { email: `x${i}@example.com` }, same)).r.status).toBe(200);
    const sixth = await post(forgot, "/api/auth/password/forgot", { email: "x9@example.com" }, same);
    expect(sixth.r.status).toBe(429);
    expect(Number(sixth.r.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await post(forgot, "/api/auth/password/forgot", { email: "x9@example.com" }, { "x-forwarded-for": "8.8.8.8" })).r.status).toBe(200);
  });

  it("a failed send changes nothing for the visitor and is logged without the address, the token or the link", async () => {
    const a = await account(); h.failSend = true;
    const x = await askFor(a.email);
    expect(x.r.status).toBe(200);
    const logged = JSON.stringify([(console.error as any).mock.calls, (console.log as any).mock.calls, (console.warn as any).mock.calls]);
    expect(logged).not.toContain(a.email);
    expect(logged).not.toMatch(/token=|reset-password#/);
  });
});

describe("choosing the new password", () => {
  it("a valid link changes the password, signs out older sessions, closes every open link, and sends the 'changed' mail", async () => {
    const a = await account("old password 1");
    const oldSession = createSessionToken({ id: a.id, role: "ST" }, false, Date.now() - 60_000, { SESSION_SECRET: SECRET } as never).token;
    h.cookie = oldSession; expect((await getCurrentUser())?.id).toBe(a.id);
    const first = tokenOf(await linkFor(a.email)), second = tokenOf(await linkFor(a.email));
    const ok = await choose(second, "brand new password");
    expect(ok.r.status).toBe(200);
    expect(ok.b.message).toMatch(/password was changed/i);
    expect(ok.r.headers.get("set-cookie")).toMatch(/rv_session=;/); // this browser's session cookie is cleared
    await flush();
    expect(await bcrypt.compare("brand new password", await hashOf(a.id))).toBe(true);
    expect(((await q("SELECT password_changed_at FROM users WHERE id = $1", [a.id])).rows[0] as any).password_changed_at).not.toBeNull();
    expect(h.changedMails).toEqual([{ to: a.email, url: `${APP}/forgot-password` }]);
    h.cookie = oldSession; expect(await getCurrentUser()).toBeNull(); // the old session no longer works
    expect((await choose(first, "another password 2")).b.error).toBe("INVALID_TOKEN"); // the other open link was closed too
    expect(Number(((await q("SELECT count(*)::int n FROM password_reset_tokens WHERE used_at IS NULL")).rows[0] as any).n)).toBe(0);
  });

  it("after the reset, signing in with the new password works and gives a working session; the old password no longer works", async () => {
    const a = await account("old password 1");
    await choose(tokenOf(await linkFor(a.email)), "brand new password");
    const bad = await post(login, "/api/auth/login", { email: a.email, password: "old password 1" });
    expect(bad.r.status).toBe(401);
    const good = await post(login, "/api/auth/login", { email: a.email, password: "brand new password" });
    expect(good.r.status).toBe(200);
    h.cookie = /rv_session=([^;]+)/.exec(good.r.headers.get("set-cookie") ?? "")?.[1];
    expect((await getCurrentUser())?.id).toBe(a.id);
  });

  it("a used link cannot be used again", async () => {
    const a = await account();
    const t = tokenOf(await linkFor(a.email));
    expect((await choose(t, "brand new password")).r.status).toBe(200);
    const again = await choose(t, "a third password");
    expect(again.r.status).toBe(400);
    expect(again.b.error).toBe("INVALID_TOKEN");
    expect(await bcrypt.compare("brand new password", await hashOf(a.id))).toBe(true);
  });

  it("an expired link is refused and changes nothing", async () => {
    const a = await account("old password 1");
    const t = tokenOf(await linkFor(a.email));
    await q("UPDATE password_reset_tokens SET created_at = now() - interval '50 minutes', expires_at = now() - interval '5 minutes'");
    const x = await choose(t, "brand new password");
    expect(x.b.error).toBe("INVALID_TOKEN");
    expect(await bcrypt.compare("old password 1", await hashOf(a.id))).toBe(true);
  });

  it("a tampered, truncated, made-up or missing token gets the same answer and changes nothing", async () => {
    const a = await account("old password 1");
    const t = tokenOf(await linkFor(a.email));
    const flipped = t.slice(0, -1) + (t.endsWith("A") ? "B" : "A");
    for (const bad of [flipped, t.slice(0, 42), "x".repeat(43), "", null, 12345, hashToken(t)]) {
      const x = await choose(bad as never, "brand new password");
      expect(x.r.status, String(bad)).toBe(400);
      expect(x.b).toEqual({ success: false, error: "INVALID_TOKEN", message: "This reset link is not valid any more. Please ask for a new one." });
    }
    expect(await bcrypt.compare("old password 1", await hashOf(a.id))).toBe(true);
    expect((await choose(t, "brand new password")).r.status).toBe(200); // the real token still worked afterwards
  });

  it("the sign-up password rules apply, and a refused password does NOT use up the link", async () => {
    const a = await account();
    const t = tokenOf(await linkFor(a.email));
    const short = await choose(t, "short");
    expect(short.r.status).toBe(400);
    expect(short.b.fieldErrors).toEqual({ password: "Password must contain at least 8 characters." });
    const mismatch = await choose(t, "brand new password", "something else");
    expect(mismatch.b.fieldErrors).toEqual({ confirmPassword: "Passwords do not match." });
    const tooLong = await choose(t, "é".repeat(40));
    expect(tooLong.b.fieldErrors).toEqual({ password: "Password is too long (max 72 bytes)." });
    expect((await choose(t, "brand new password")).r.status).toBe(200);
  });

  it("the 11th try in 15 minutes from one address gets 429", async () => {
    const same = { "x-forwarded-for": "7.7.7.7" };
    for (let i = 0; i < 10; i++) expect((await choose("x".repeat(43), "brand new password", "brand new password", same)).r.status).toBe(400);
    expect((await choose("x".repeat(43), "brand new password", "brand new password", same)).r.status).toBe(429);
  });

  it("other users are unaffected: their password and sessions stay as they were", async () => {
    const a = await account(), b = await account("b password 1");
    const bSession = createSessionToken({ id: b.id, role: "ST" }, false, Date.now() - 60_000, { SESSION_SECRET: SECRET } as never).token;
    await choose(tokenOf(await linkFor(a.email)), "brand new password");
    h.cookie = bSession; expect((await getCurrentUser())?.id).toBe(b.id);
    expect(await bcrypt.compare("b password 1", await hashOf(b.id))).toBe(true);
  });

  it("the token never appears in any log line, even when something fails", async () => {
    const a = await account();
    const t = tokenOf(await linkFor(a.email));
    testDb().failOn((sql) => (/UPDATE users SET password_hash/.test(sql) ? new Error("down") : undefined));
    const x = await choose(t, "brand new password");
    expect(x.r.status).toBe(500);
    const logged = JSON.stringify([(console.error as any).mock.calls, (console.log as any).mock.calls, (console.warn as any).mock.calls]);
    expect(logged).not.toContain(t);
    expect(logged).not.toContain(a.email);
  });
});

describe("switched OFF unless it can really work", () => {
  const prod = (vars: Record<string, string>) => ({ NODE_ENV: "production", ...vars }) as unknown as NodeJS.ProcessEnv;
  it("production needs RESEND_API_KEY, a real RESEND_FROM_EMAIL (not Resend's shared test sender) and an https APP_URL", () => {
    expect(resetConfigured(prod({})).ok).toBe(false);
    expect(resetConfigured(prod({ RESEND_API_KEY: "re_x", APP_URL: APP })).ok).toBe(false);
    expect(resetConfigured(prod({ RESEND_API_KEY: "re_x", RESEND_FROM_EMAIL: "RoboValley <onboarding@resend.dev>", APP_URL: APP })).ok).toBe(false);
    expect(resetConfigured(prod({ RESEND_API_KEY: "re_x", RESEND_FROM_EMAIL: "RoboValley <no-reply@techytree.in>" })).ok).toBe(false);
    expect(resetConfigured(prod({ RESEND_API_KEY: "re_x", RESEND_FROM_EMAIL: "RoboValley <no-reply@techytree.in>", APP_URL: "http://app.example.test" })).ok).toBe(false);
    expect(resetConfigured(prod({ RESEND_API_KEY: "re_x", RESEND_FROM_EMAIL: "RoboValley <no-reply@techytree.in>", APP_URL: APP })).ok).toBe(true);
  });
  it("in production without a sender both routes answer 503 'Password reset is not available yet' and nothing is stored or sent", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("RESEND_API_KEY", ""); vi.stubEnv("RESEND_FROM_EMAIL", "");
    const a = await account();
    const f = await askFor(a.email);
    expect(f.r.status).toBe(503);
    expect(f.b.message).toBe("Password reset is not available yet.");
    expect((await choose("x".repeat(43), "brand new password")).b.message).toBe("Password reset is not available yet.");
    expect(h.resetMails).toHaveLength(0);
    expect(Number(((await q("SELECT count(*)::int n FROM password_reset_tokens")).rows[0] as any).n)).toBe(0);
  });
  it("without migration 020 it reports itself unavailable instead of failing", async () => {
    const fake = { query: async () => ({ rows: [{ t: false, c: false }] }) };
    expect(await resetAvailable(fake as never, { NODE_ENV: "development", APP_URL: APP } as never)).toEqual({ ok: false, reason: "migration 020 is not applied" });
  });
});
