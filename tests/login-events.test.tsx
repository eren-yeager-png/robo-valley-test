// Stage 5: the login activity log. Recording is best effort and privacy-minimal; the page and the clean-up are admin/secret only.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adultPayload, makeFakePool, pgError, seedUser, testDb } from "./helpers";
import { createSessionToken } from "../src/lib/session";

const m = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "rv_session" && m.cookie ? { name: n, value: m.cookie } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error("REDIRECT:" + to); },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import { POST as login } from "../src/app/api/auth/login/route";
import { POST as logout } from "../src/app/api/auth/logout/route";
import { POST as signup } from "../src/app/api/auth/signup/route";
import { POST as otpRequest } from "../src/app/api/auth/otp/request/route";
import { POST as otpVerify } from "../src/app/api/auth/otp/verify/route";
import { GET as purge } from "../src/app/api/cron/purge-login-events/route";
import LoginActivityPage from "../src/app/admin/login-activity/page";
import { otpReason, recordLoginEvent, sessionUserId, uaFamily } from "../src/lib/loginEvents";
import { testPool } from "./helpers";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const PW = "correct horse";
const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p);
const events = async () => (await q("select event_type, user_id, reason, purpose, ua_family from login_events order by id")).rows as any[];
const req = (url: string, body: unknown, headers: Record<string, string> = {}) => new Request("http://localhost" + url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const doLogin = (email: string, password: string, headers: Record<string, string> = {}) => login(req("/api/auth/login", { email, password }, headers));
const tokenFor = (id: string, role: string) => createSessionToken({ id, role }, false, Date.now(), { SESSION_SECRET: SECRET } as never).token;

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("OTP_PROVIDER", "mock");
  m.cookie = undefined;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("helpers", () => {
  it("reduces a user-agent to a browser family only", () => {
    expect(uaFamily("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0")).toBe("edge");
    expect(uaFamily("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36")).toBe("chrome");
    expect(uaFamily("Mozilla/5.0 (Macintosh) AppleWebKit/605 Version/17.0 Safari/605.1.15")).toBe("safari");
    expect(uaFamily("Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/121.0")).toBe("firefox");
    expect(uaFamily("curl/8.0")).toBe("other");
    expect(uaFamily(null)).toBe("other");
  });
  it("maps OTP error codes to the fixed reasons", () => {
    expect(otpReason("OTP_INVALID")).toBe("wrong_code");
    expect(otpReason("OTP_EXPIRED")).toBe("expired");
    expect(otpReason("OTP_LOCKED")).toBe("locked");
    expect(otpReason("RESEND_COOLDOWN")).toBe("rate_limited");
    expect(otpReason("TOO_MANY_REQUESTS")).toBe("rate_limited");
    expect(otpReason("SOMETHING_ELSE")).toBe("server_error");
  });
  it("reads the account from a signed session cookie only", () => {
    const ok = new Request("http://x", { headers: { cookie: `a=b; rv_session=${encodeURIComponent(tokenFor("42", "ST"))}` } });
    expect(sessionUserId(ok)).toBe("42");
    expect(sessionUserId(new Request("http://x", { headers: { cookie: "rv_session=forged.token" } }))).toBeNull();
    expect(sessionUserId(new Request("http://x"))).toBeNull();
  });
});

describe("recordLoginEvent never gets in the way", () => {
  it("drops values the table does not allow instead of failing", async () => {
    await recordLoginEvent(testPool(), { type: "login_success", reason: "bad_credentials", purpose: "signup", userId: "abc" });
    await recordLoginEvent(testPool(), { type: "otp_failed", reason: "nonsense" as never, purpose: "other" });
    expect(await events()).toEqual([
      { event_type: "login_success", user_id: null, reason: null, purpose: null, ua_family: "other" },
      { event_type: "otp_failed", user_id: null, reason: null, purpose: null, ua_family: "other" },
    ]);
  });
  it("swallows database errors and logs no values", async () => {
    const boom = { query: async () => { throw Object.assign(new Error("secret sql text a@b.com"), { code: "42P01" }); } };
    await expect(recordLoginEvent(boom, { type: "logout", userId: "1" })).resolves.toBeUndefined();
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).not.toContain("a@b.com");
  });
  it("gives up quickly when the database hangs", async () => {
    vi.useFakeTimers();
    const hang = { query: () => new Promise<never>(() => undefined) };
    const p = recordLoginEvent(hang, { type: "logout", userId: "1" });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toBeUndefined();
  });
});

describe("sign-in routes record events without changing their behaviour", () => {
  it("records a successful login with the account id, and a failed one for a known and an unknown address", async () => {
    const u = await seedUser({ email: "asha@example.com", role: "ST" });
    expect((await doLogin("asha@example.com", PW, { "user-agent": "Mozilla/5.0 Firefox/121.0" })).status).toBe(200);
    expect((await doLogin("asha@example.com", "wrong password")).status).toBe(401);
    expect((await doLogin("nobody@example.com", "whatever pw")).status).toBe(401);
    const ev = await events();
    expect(ev).toEqual([
      { event_type: "login_success", user_id: u.id, reason: null, purpose: null, ua_family: "firefox" },
      { event_type: "login_failed", user_id: u.id, reason: "bad_credentials", purpose: null, ua_family: "other" },
      { event_type: "login_failed", user_id: null, reason: "bad_credentials", purpose: null, ua_family: "other" },
    ]);
  });

  it("records unverified accounts and throttling", async () => {
    await seedUser({ email: "mock@example.com", emailVerification: "none" });
    expect((await doLogin("mock@example.com", PW)).status).toBe(403);
    await seedUser({ email: "busy@example.com" });
    let last = 200;
    for (let i = 0; i < 12 && last !== 429; i++) last = (await doLogin("busy@example.com", "bad password " + i)).status;
    expect(last).toBe(429);
    const reasons = (await events()).map((e) => e.reason);
    expect(reasons).toContain("not_verified");
    expect(reasons).toContain("throttled");
  });

  it("stores nothing personal: no e-mail, password or IP anywhere in the table", async () => {
    await seedUser({ email: "asha@example.com" });
    await doLogin("asha@example.com", "wrong password", { "x-forwarded-for": "203.0.113.9", "user-agent": "Chrome/1" });
    await doLogin("asha@example.com", PW, { "x-forwarded-for": "203.0.113.9" });
    const dump = JSON.stringify((await q("select * from login_events")).rows);
    expect(dump).not.toMatch(/asha@|wrong password|correct horse|203\.0\.113|Chrome\/1/);
    const cols = (await q("select column_name from information_schema.columns where table_name = 'login_events'")).rows.map((r: any) => r.column_name).sort();
    expect(cols).toEqual(["created_at", "event_type", "id", "purpose", "reason", "ua_family", "user_id"]);
  });

  it("login still works exactly the same when the log table is missing", async () => {
    await seedUser({ email: "asha@example.com" });
    await q("alter table login_events rename to login_events_hidden");
    try {
      const res = await doLogin("asha@example.com", PW);
      expect(res.status).toBe(200);
      expect((await res.json()).success).toBe(true);
      expect(res.headers.get("set-cookie")).toContain("rv_session=");
      expect((await doLogin("asha@example.com", "nope nope")).status).toBe(401);
    } finally { await q("alter table login_events_hidden rename to login_events"); }
  });

  it("login still works when writing the event fails", async () => {
    await seedUser({ email: "asha@example.com" });
    makeFakePool((sql) => (sql.includes("INSERT INTO login_events") ? pgError("53300") : undefined));
    const res = await doLogin("asha@example.com", PW);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("rv_session=");
  });
});

describe("OTP, signup and logout events", () => {
  it("records otp_sent, a rapid resend, a wrong code and a verified code with the purpose only", async () => {
    const r = await (await otpRequest(req("/api/auth/otp/request", { email: "asha@example.com", purpose: "signup" }))).json();
    expect((await otpRequest(req("/api/auth/otp/request", { email: "asha@example.com", purpose: "signup" }))).status).toBe(429);
    const wrong = r.devOtp === "123456" ? "654321" : "123456";
    expect((await otpVerify(req("/api/auth/otp/verify", { email: "asha@example.com", purpose: "signup", code: wrong }))).status).toBe(400);
    expect((await otpVerify(req("/api/auth/otp/verify", { email: "asha@example.com", purpose: "signup", code: r.devOtp }))).status).toBe(200);
    expect((await events()).map((e) => [e.event_type, e.reason, e.purpose])).toEqual([
      ["otp_sent", null, "signup"], ["otp_failed", "rate_limited", "signup"], ["otp_failed", "wrong_code", "signup"], ["otp_verified", null, "signup"],
    ]);
    const dump = JSON.stringify((await q("select * from login_events")).rows);
    expect(dump).not.toContain(r.devOtp);
    expect(dump).not.toContain(wrong);
    expect(dump).not.toContain("asha@");
  });

  it("does not record anything for requests that fail validation", async () => {
    await otpRequest(req("/api/auth/otp/request", { email: "not-an-email", purpose: "signup" }));
    await otpVerify(req("/api/auth/otp/verify", { email: "asha@example.com", purpose: "signup", code: "12" }));
    await doLogin("", "");
    expect(await events()).toEqual([]);
  });

  it("records a signup with the new account id", async () => {
    const res = await signup(req("/api/auth/signup", await adultPayload()));
    expect(res.status).toBe(201);
    const id = (await res.json()).user.id;
    expect(await events()).toEqual([{ event_type: "signup", user_id: String(id), reason: null, purpose: null, ua_family: "other" }]);
  });

  it("records a logout only when a valid session was signed in, and still clears the cookie", async () => {
    const u = await seedUser({ email: "asha@example.com" });
    const res = await logout(req("/api/auth/logout", {}, { cookie: "rv_session=" + encodeURIComponent(tokenFor(u.id, "TC")) }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("rv_session=;");
    expect((await logout(req("/api/auth/logout", {}))).status).toBe(200);
    expect((await logout(req("/api/auth/logout", {}, { cookie: "rv_session=forged" }))).status).toBe(200);
    expect(await events()).toEqual([{ event_type: "logout", user_id: u.id, reason: null, purpose: null, ua_family: "other" }]);
  });
});

describe("retention clean-up (scheduled)", () => {
  const call = (auth?: string) => purge(new Request("http://localhost/api/cron/purge-login-events", { headers: auth ? { authorization: auth } : {} }));
  beforeEach(async () => {
    await q("insert into login_events (event_type, created_at) values ('logout', now() - interval '200 days'), ('logout', now() - interval '10 days'), ('login_success', now())");
  });

  it("refuses to run when CRON_SECRET is not configured, or is too short", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "short");
    expect((await call("Bearer short")).status).toBe(503);
    expect((await q("select count(*)::int n from login_events")).rows[0]).toEqual({ n: 3 });
  });

  it("refuses a missing or wrong secret and deletes nothing", async () => {
    vi.stubEnv("CRON_SECRET", "a-long-enough-cron-secret");
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect((await call("a-long-enough-cron-secret")).status).toBe(401);
    expect((await q("select count(*)::int n from login_events")).rows[0]).toEqual({ n: 3 });
  });

  it("with the secret removes only events older than 180 days", async () => {
    vi.stubEnv("CRON_SECRET", "a-long-enough-cron-secret");
    const res = await call("Bearer a-long-enough-cron-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, retentionDays: 180, removed: 1 });
    expect((await q("select count(*)::int n from login_events")).rows[0]).toEqual({ n: 2 });
    expect((await q("select count(*)::int n from users")).rows[0]).toEqual({ n: 0 });
  });

  it("is a harmless no-op while the table does not exist", async () => {
    vi.stubEnv("CRON_SECRET", "a-long-enough-cron-secret");
    await q("alter table login_events rename to login_events_hidden");
    try {
      const res = await call("Bearer a-long-enough-cron-secret");
      expect(res.status).toBe(200);
      expect((await res.json()).removed).toBeNull();
    } finally { await q("alter table login_events_hidden rename to login_events"); }
  });

  it("is scheduled in vercel.json", async () => {
    const cfg = JSON.parse((await import("node:fs")).readFileSync("vercel.json", "utf8"));
    expect(cfg.crons).toEqual([{ path: "/api/cron/purge-login-events", schedule: expect.any(String) }]);
  });
});

describe("login activity page", () => {
  let admin: { id: string };
  const page = async (sp: object = {}) => renderToStaticMarkup((await LoginActivityPage({ searchParams: Promise.resolve(sp) })) as React.ReactElement);
  beforeEach(async () => {
    admin = await seedUser({ email: "boss@robovalley.com", role: "admin" });
    m.cookie = tokenFor(admin.id, "admin");
  });

  it("shows every event type with counts, reasons and the account, and nothing sensitive", async () => {
    const u = await seedUser({ email: "asha@example.com", role: "ST" });
    await q(`insert into login_events (event_type, user_id, reason, purpose, ua_family) values
      ('login_success',$1,null,null,'chrome'), ('login_failed',$1,'bad_credentials',null,'firefox'), ('login_failed',null,'throttled',null,'other'),
      ('otp_sent',null,null,'signup','safari'), ('otp_failed',null,'wrong_code','guardian','edge'), ('otp_verified',null,null,'signup','chrome'),
      ('signup',$1,null,null,'chrome'), ('logout',$1,null,null,'chrome')`, [u.id]);
    const h = await page();
    for (const t of ["Successful login", "Failed login", "OTP sent", "OTP failed", "OTP verified", "Signup", "Logout"]) expect(h, t).toContain(t);
    expect(h).toContain("Wrong email or password");
    expect(h).toContain("Too many attempts");
    expect(h).toContain("Wrong code");
    expect(h).toContain("parent/guardian");
    expect(h).toContain("asha@example.com");
    expect(h).toContain("Unknown account");
    expect(h).not.toMatch(/password_hash|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
    expect(h).toContain("No passwords, codes or IP addresses are recorded");
  });

  it("filters by type and period; ignores junk values", async () => {
    await q("insert into login_events (event_type, created_at) values ('logout', now()), ('login_success', now()), ('login_success', now() - interval '20 days')");
    const only = await page({ type: "logout" });
    expect((only.match(/<tr>/g) ?? []).length - 1).toBe(1); // header row + 1
    expect((await page({ range: "7" }).then((h) => h.match(/Successful login/g) ?? [])).length).toBeGreaterThan(0);
    const week = await page({ range: "7", type: "login_success" });
    expect((week.match(/<tr>/g) ?? []).length - 1).toBe(1);
    const month = await page({ range: "30", type: "login_success" });
    expect((month.match(/<tr>/g) ?? []).length - 1).toBe(2);
    expect(await page({ range: "bogus", type: "x'; drop table users; --" })).toContain("Last 30 days");
  });

  it("paginates and shows an empty state", async () => {
    expect(await page()).toContain("No activity in this period.");
    await q("insert into login_events (event_type) select 'logout' from generate_series(1, 30)");
    const h = await page();
    expect(h).toContain("Page 1 of 2");
  });

  it("shows a setup notice while migration 008 has not been applied", async () => {
    await q("alter table login_events rename to login_events_hidden");
    let h: string;
    try { h = await page(); } finally { await q("alter table login_events_hidden rename to login_events"); }
    expect(h).toContain("Login activity is not set up yet");
    expect(h).toContain("migration 008");
  });

  it("is closed to visitors and regular users", async () => {
    m.cookie = undefined;
    await expect(page()).rejects.toThrow("REDIRECT:/login");
    const u = await seedUser({ email: "t@example.com", role: "TC" });
    m.cookie = tokenFor(u.id, "TC");
    await expect(page()).rejects.toThrow("REDIRECT:/dashboard");
  });
});
