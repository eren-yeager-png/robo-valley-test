// The error reporting that shows up in the VS Code terminal: readable in development, one safe JSON line elsewhere,
// secrets masked, repeats summarised, plus the start-up environment check and Next's request-error hook.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkEnvironment } from "../src/lib/envCheck";
import { adviceFor, formatEntry, logError, logWarn, resetLogDedupe } from "../src/lib/logger";
import { describeError } from "../src/lib/diagnostics";
import { onRequestError, register } from "../src/instrumentation";

const SECRETS = {
  url: "postgresql://neondb_owner:SuperSecretPw9@ep-cool-123456.us-east-2.aws.neon.tech/neondb?sslmode=require",
  email: "asha.private@example.com",
  apiKey: "re_AbCdEf123456_SECRETKEYVALUE",
  code: "483920",
  token: "9f2b7c1d4e6a8b0c3d5e7f9a1b2c4d6e8f0a1b3c5d7e9f1a2b4c6d8e0f2a4b6c",
};
const leaky = () => Object.assign(new Error(`connect failed ${SECRETS.url} for ${SECRETS.email} key ${SECRETS.apiKey} code ${SECRETS.code} token ${SECRETS.token}`), { code: "ECONNREFUSED" });

let out: string[];
beforeEach(() => {
  resetLogDedupe();
  out = [];
  vi.spyOn(console, "error").mockImplementation((...a) => void out.push(a.map(String).join(" ")));
  vi.spyOn(console, "warn").mockImplementation((...a) => void out.push(a.map(String).join(" ")));
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("development output (npm run dev)", () => {
  beforeEach(() => vi.stubEnv("NODE_ENV", "development"));

  it("says what failed, where, why and what to check, with a timestamp, category and request id", () => {
    const requestId = logError({ category: "DATABASE", where: "admin/overview", what: "Could not load the overview", err: Object.assign(new Error('relation "login_events" does not exist'), { code: "42P01", table: "login_events" }) });
    const text = out.join("\n");
    expect(text).toMatch(/^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] ERROR DATABASE {2}admin\/overview {2}\(request [0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}\)/);
    expect(text).toContain("What:   Could not load the overview");
    expect(text).toMatch(/Why: {4}Error \/ 42P01 \/ table login_events - relation "login_events" does not exist/);
    expect(text).toMatch(/Check: {2}A database table is missing \(table "login_events"\).*migration 008 or 009.*--status/);
    expect(text).toContain("Stack:");
    expect(text).toContain(requestId);
  });

  it("includes a short stack trace but masks every kind of secret in the message and the stack", () => {
    logError({ category: "API", where: "api/x", what: "Failed", err: leaky() });
    const text = out.join("\n");
    for (const v of Object.values(SECRETS)) expect(text).not.toContain(v);
    expect(text).toMatch(/\[url\]/);
    expect(text.split("\n").filter((l) => /^\s+at /.test(l) || /Stack:/.test(l)).length).toBeGreaterThan(1);
    expect(text.split("\n").length).toBeLessThan(20);
    expect(text).toMatch(/The database cannot be reached/);
  });

  it("prints only the facts it is given", () => {
    logError({ category: "UPLOAD", where: "api/admin/attachments", what: "Failed", context: { stage: "store", size: 12 } });
    expect(out.join("\n")).toContain("Facts:  stage=store size=12");
  });
});

describe("production and test output (what hosted logs and tests see)", () => {
  for (const env of ["production", "test"]) {
    it(`${env}: one JSON line, no message, no stack trace, no secrets`, () => {
      vi.stubEnv("NODE_ENV", env);
      logError({ category: "DATABASE", where: "api/x", what: "Failed", err: leaky(), context: { stage: "s" }, requestId: "aaaa-bbbb-cccc" });
      expect(out).toHaveLength(1);
      const line = out[0]!;
      expect(line).not.toContain("\n");
      const j = JSON.parse(line);
      expect(j).toMatchObject({ level: "ERROR", category: "DATABASE", where: "api/x", what: "Failed", requestId: "aaaa-bbbb-cccc", stage: "s", error: { name: "Error", code: "ECONNREFUSED" } });
      expect(j.error.message).toBeUndefined();
      expect(j.hint).toMatch(/cannot be reached/);
      expect(line).not.toMatch(/ at |Stack/);
      for (const v of Object.values(SECRETS)) expect(line).not.toContain(v);
      expect(line).not.toContain("connect failed");
    });
  }
});

describe("advice", () => {
  const code = (c: string, extra: object = {}) => adviceFor({ name: "Error", message: "", code: c, ...extra });
  it("gives a next step for the common database and network failures", () => {
    expect(code("42P01")).toMatch(/migration/);
    expect(code("42703")).toMatch(/column/);
    expect(code("ECONNREFUSED")).toMatch(/PostgreSQL is running/);
    expect(code("28P01")).toMatch(/user name or password/);
    expect(code("3D000")).toMatch(/does not exist/);
    expect(code("23505", { constraint: "users_email_key" })).toMatch(/users_email_key/);
    expect(code("53300")).toMatch(/too many connections/);
    expect(code("NOPE")).toBeUndefined();
  });
  it("never includes a connection string, user name or host", () => {
    for (const c of ["42P01", "ECONNREFUSED", "28P01", "3D000", "53300"]) expect(code(c)).not.toMatch(/postgres(ql)?:\/\/|@|\.neon\./i);
  });
});

describe("not noisy", () => {
  it("prints the same problem once and then summarises the repeats", () => {
    vi.stubEnv("NODE_ENV", "development");
    const e = Object.assign(new Error("x"), { code: "ECONNREFUSED" });
    for (let i = 0; i < 50; i++) logError({ category: "DATABASE", where: "admin/users", what: "Could not load", err: e });
    expect(out).toHaveLength(1);
    vi.useFakeTimers({ now: Date.now() + 31_000, toFake: ["Date"] });
    logError({ category: "DATABASE", where: "admin/users", what: "Could not load", err: e });
    vi.useRealTimers();
    expect(out).toHaveLength(2);
    expect(out[1]).toMatch(/49 similar messages in the last 30s not shown/);
  });
  it("different problems are all shown", () => {
    logError({ category: "API", where: "a", what: "one" });
    logError({ category: "API", where: "b", what: "one" });
    logWarn({ category: "MIGRATION", where: "c", what: "two" });
    expect(out).toHaveLength(3);
  });
  it("warnings go to console.warn, errors to console.error", () => {
    logWarn({ category: "MIGRATION", where: "x", what: "w" });
    logError({ category: "API", where: "y", what: "e" });
    expect(vi.mocked(console.warn)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.error)).toHaveBeenCalledTimes(1);
  });
});

describe("formatEntry is safe for odd input", () => {
  it("handles non-Error values", () => {
    vi.stubEnv("NODE_ENV", "development");
    for (const err of ["a string", 42, null, undefined, { weird: true }, Object.assign(Object.create(null), { code: 1 })]) expect(() => formatEntry("ERROR", { category: "API", where: "x", what: "y", err })).not.toThrow();
    expect(describeError(new AggregateError([Object.assign(new Error("a"), { code: "ECONNREFUSED" })])).code).toBe("ECONNREFUSED");
  });
});

describe("environment check", () => {
  const ok = { NODE_ENV: "development", DATABASE_URL: "postgresql://u:p@localhost:5433/db", SESSION_SECRET: "x".repeat(40), OTP_PROVIDER: "mock" } as NodeJS.ProcessEnv;
  const keys = (env: NodeJS.ProcessEnv) => checkEnvironment(env).map((i) => `${i.level}:${i.key}`);

  it("a correct local setup has no errors", () => {
    expect(checkEnvironment(ok).filter((i) => i.level === "ERROR")).toEqual([]);
  });
  it("reports missing and invalid settings by name, in plain words", () => {
    expect(keys({} as NodeJS.ProcessEnv)).toEqual(expect.arrayContaining(["ERROR:DATABASE_URL", "ERROR:SESSION_SECRET"]));
    expect(keys({ ...ok, DATABASE_URL: "not a url" })).toContain("ERROR:DATABASE_URL");
    expect(keys({ ...ok, DATABASE_URL: "mysql://u:p@h/db" })).toContain("ERROR:DATABASE_URL");
    expect(keys({ ...ok, DATABASE_URL: "postgresql://u:p@h" })).toContain("ERROR:DATABASE_URL");
    expect(keys({ ...ok, SESSION_SECRET: "short" })).toContain("ERROR:SESSION_SECRET");
    expect(keys({ ...ok, OTP_PROVIDER: "sms" })).toContain("ERROR:OTP_PROVIDER");
    expect(keys({ ...ok, OTP_PROVIDER: "resend" })).toContain("ERROR:RESEND_API_KEY");
    expect(keys({ ...ok, NODE_ENV: "production", OTP_PROVIDER: "mock" })).toContain("ERROR:OTP_PROVIDER");
    expect(keys({ ...ok, CRON_SECRET: "short" })).toContain("WARN:CRON_SECRET");
    expect(keys({ ...ok, SITE_URL: "ftp://x" })).toContain("WARN:SITE_URL");
    expect(keys({ ...ok, DATABASE_URL: "postgresql://u:p@x-pooler.neon.tech/db" })).toContain("WARN:DATABASE_URL");
  });
  it("never repeats a setting's value", () => {
    const secretish = { ...ok, SESSION_SECRET: "tiny-secret", DATABASE_URL: "postgresql://admin:Sup3rPw@h-pooler.x.tech/db", RESEND_API_KEY: "re_SECRETSECRET1234", OTP_PROVIDER: "resend", CRON_SECRET: "cronpw" };
    const text = JSON.stringify(checkEnvironment(secretish));
    for (const v of ["tiny-secret", "Sup3rPw", "re_SECRETSECRET1234", "cronpw", "admin:"]) expect(text).not.toContain(v);
  });
});

describe("start-up and request-error hooks (instrumentation)", () => {
  it("register() reports configuration problems in the terminal and installs the process hooks once", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SESSION_SECRET", "short");
    const had = { r: new Set(process.listeners("unhandledRejection")), x: new Set(process.listeners("uncaughtExceptionMonitor")) };
    await register();
    await register();
    const added = { r: process.listeners("unhandledRejection").filter((l) => !had.r.has(l)), x: process.listeners("uncaughtExceptionMonitor").filter((l) => !had.x.has(l)) };
    // clean up only what this test added, so the test runner's own handlers stay
    added.r.forEach((l) => process.removeListener("unhandledRejection", l)); added.x.forEach((l) => process.removeListener("uncaughtExceptionMonitor", l));
    (globalThis as { __rvProcessHooks?: boolean }).__rvProcessHooks = undefined;
    expect(out.join("\n")).toContain("SESSION_SECRET is shorter than 32 characters");
    expect(out.join("\n")).not.toContain('"short"');
    expect(added.r).toHaveLength(1); // two calls, one hook
    expect(added.x).toHaveLength(1);
  });

  it("onRequestError names the route and method, uses only the path (never the query string) and masks secrets", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const err = Object.assign(leaky(), { digest: "d1g3st" });
    await onRequestError(err, { path: "/api/admin/attachments?token=SUPERSECRET&email=a@b.c", method: "POST", headers: { cookie: "rv_session=SESSIONCOOKIE" } } as never, { routerKind: "App Router", routePath: "/api/admin/attachments", routeType: "route", renderSource: undefined, revalidateReason: undefined } as never);
    const text = out.join("\n");
    expect(text).toContain("POST /api/admin/attachments");
    expect(text).toContain("digest=d1g3st");
    expect(text).not.toMatch(/SUPERSECRET|SESSIONCOOKIE|a@b\.c|rv_session/);
    for (const v of Object.values(SECRETS)) expect(text).not.toContain(v);
  });
});
