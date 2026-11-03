// Safe diagnostics for unexpected failures: the OTP routes' generic 500 now leaves a useful, secret-free log line.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakePool, testDb } from "./helpers";
import { describeError, newRequestId, redact } from "../src/lib/diagnostics";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });

import { POST as requestRoute } from "../src/app/api/auth/otp/request/route";
import { POST as verifyRoute } from "../src/app/api/auth/otp/verify/route";

const call = (route: typeof requestRoute, body: unknown, headers: Record<string, string> = {}) =>
  route(new Request("http://t/x", { method: "POST", headers, body: JSON.stringify(body) }));

let logs: string[];
beforeEach(() => {
  vi.stubEnv("OTP_PROVIDER", "mock");
  logs = [];
  for (const fn of ["log", "error", "warn", "info"] as const) vi.spyOn(console, fn).mockImplementation((...a) => void logs.push(a.map(String).join(" ")));
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

// Things that must NEVER appear in a log line or a response body.
const SECRETS = {
  url: "postgresql://neondb_owner:SuperSecretPw9@ep-cool-123456.us-east-2.aws.neon.tech/neondb?sslmode=require",
  email: "asha.private@example.com",
  apiKey: "re_AbCdEf123456_SECRETKEYVALUE",
  code: "483920",
  token: "9f2b7c1d4e6a8b0c3d5e7f9a1b2c4d6e8f0a1b3c5d7e9f1a2b4c6d8e0f2a4b6c",
  sessionSecret: "unit-test-secret-unit-test-secret-1234",
};

describe("describeError / redact", () => {
  it("masks URLs, emails, API keys, 6-digit codes and long tokens", () => {
    const text = `failed for ${SECRETS.url} user ${SECRETS.email} key ${SECRETS.apiKey} code ${SECRETS.code} token ${SECRETS.token}`;
    const out = redact(text);
    for (const v of Object.values(SECRETS)) expect(out).not.toContain(v);
    expect(out).toContain("[url]");
    expect(out).toContain("[email]");
    expect(out).toContain("[api-key]");
    expect(out).toContain("[6-digits]");
    expect(out).toContain("[long-token]");
  });

  it("keeps useful PostgreSQL facts (code, table, constraint) and the name of the error", () => {
    const e = Object.assign(new Error('relation "otp_challenges" does not exist'), { name: "error", code: "42P01", table: "otp_challenges", constraint: "x_check", routine: "parserOpenTable" });
    expect(describeError(e)).toEqual({ name: "error", code: "42P01", table: "otp_challenges", constraint: "x_check", routine: "parserOpenTable", message: 'relation "otp_challenges" does not exist' });
  });

  it("ignores a malformed x-vercel-id header instead of logging it", async () => {
    makeFakePool(() => new Error("x"));
    await call(requestRoute, { email: "someone@example.com", purpose: "signup" }, { "x-vercel-id": "evil id with spaces <script>" });
    const line = logs.find((l) => l.startsWith("otp.request.failed"))!;
    expect(JSON.parse(line.slice(line.indexOf("{"))).vercelId).toBeUndefined();
  });

  it("takes the code from an AggregateError (IPv4 + IPv6 connection failures)", () => {
    const agg = new AggregateError([Object.assign(new Error("connect ECONNREFUSED ::1:5432"), { code: "ECONNREFUSED" })], "");
    expect(describeError(agg)).toMatchObject({ name: "AggregateError", code: "ECONNREFUSED" });
  });

  it("only accepts identifier-shaped values for code/table/constraint (no free text can sneak in)", () => {
    const e = { name: "Error", code: "has spaces and @ symbols", table: `x${SECRETS.email}`, message: "m" };
    const d = describeError(e);
    expect(d.code).toBeUndefined();
    expect(d.table).toBeUndefined();
  });

  it("is safe for non-Error values", () => {
    for (const v of [undefined, null, "boom", 42, {}]) expect(() => describeError(v)).not.toThrow();
    expect(describeError(undefined).message).toBe("");
  });

  it("truncates long messages to 200 characters", () => {
    expect(describeError(new Error("a ".repeat(500))).message.length).toBeLessThanOrEqual(200);
  });

  it("request ids are short, URL-safe, unique, and can never contain six digits in a row", () => {
    const ids = new Set(Array.from({ length: 2000 }, newRequestId));
    expect(ids.size).toBe(2000);
    for (const id of ids) expect(id).not.toMatch(/d{6}/);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
  });
});

describe("OTP request: the production 500 is now diagnosable", () => {
  it("REPRODUCES the reported 500 when the OTP tables are missing, and the log names the cause (42P01)", async () => {
    // in-process test database only: hide the table to simulate an unmigrated database, and always put it back
    await testDb().raw.exec("ALTER TABLE otp_challenges RENAME TO otp_challenges_hidden");
    let res: Response;
    try {
      res = await call(requestRoute, { email: SECRETS.email, purpose: "signup" }, { "x-vercel-id": "bom1::abcde-1792760917805-7e89d3b41bd6" });
    } finally {
      await testDb().raw.exec("ALTER TABLE otp_challenges_hidden RENAME TO otp_challenges");
    }
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body).toMatchObject({ success: false, error: "SERVER_ERROR", message: "Could not send the code." }); // same body as production
    expect(body.requestId).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);

    const line = logs.find((l) => l.startsWith("otp.request.failed"))!;
    expect(line).toBeTruthy();
    const entry = JSON.parse(line.slice("otp.request.failed ".length));
    expect(entry.requestId).toBe(body.requestId); // the response and the log can be matched
    expect(entry.vercelId).toBe("bom1::abcde-1792760917805-7e89d3b41bd6");
    expect(entry.stage).toBe("store-code");
    expect(entry.purpose).toBe("signup");
    expect(entry.error.code).toBe("42P01"); // "undefined_table": the table does not exist
    expect(entry.error.message).toMatch(/otp_challenges.*does not exist/);
    expect(line).not.toContain(SECRETS.email); // the address being verified is never logged
  });

  it("a connection failure is logged with its code but with every sensitive value masked", async () => {
    makeFakePool(() => Object.assign(
      new Error(`connect ECONNREFUSED to ${SECRETS.url} for ${SECRETS.email}, key ${SECRETS.apiKey}, code ${SECRETS.code}, token ${SECRETS.token}`),
      { code: "ECONNREFUSED" }
    ));
    const res = await call(requestRoute, { email: "someone@example.com", purpose: "guardian" });
    const text = await res.text();
    expect(res.status).toBe(500);
    const all = logs.join("\n") + text;
    for (const v of Object.values(SECRETS)) expect(all, v).not.toContain(v);
    expect(logs.join("\n")).toContain("ECONNREFUSED");
    expect(logs.join("\n")).toContain("otp.request.failed");
    expect(text).not.toMatch(/ECONNREFUSED|postgresql|neon/); // the client never sees the cause
  });

  it("an authentication failure from the database is logged by code (28P01) without the user name", async () => {
    makeFakePool(() => Object.assign(new Error('password authentication failed for user "neondb_owner"'), { code: "28P01" }));
    const res = await call(requestRoute, { email: "someone@example.com", purpose: "signup" });
    expect(res.status).toBe(500);
    const line = logs.find((l) => l.startsWith("otp.request.failed"))!;
    expect(JSON.parse(line.slice(line.indexOf("{"))).error.code).toBe("28P01");
  });

  it("expected problems (cooldown, bad input, disabled) are NOT logged as failures", async () => {
    await call(requestRoute, { email: "someone@example.com", purpose: "signup" });
    await call(requestRoute, { email: "someone@example.com", purpose: "signup" }); // 429 cooldown
    await call(requestRoute, { email: "bad", purpose: "signup" }); // 400
    vi.stubEnv("OTP_PROVIDER", "");
    vi.stubEnv("MOCK_OTP", "");
    await call(requestRoute, { email: "someone@example.com", purpose: "signup" }); // 501
    expect(logs.filter((l) => l.startsWith("otp.request.failed"))).toHaveLength(0);
  });

  it("a successful request logs nothing and never exposes the code outside mock mode", async () => {
    const res = await call(requestRoute, { email: "someone@example.com", purpose: "signup" });
    expect(res.status).toBe(200);
    expect(logs).toHaveLength(0);
  });
});

describe("OTP verify: same treatment", () => {
  it("a database failure gives the generic 500 with a request id and a safe log line", async () => {
    makeFakePool((sql) => (/otp_challenges/.test(sql) ? Object.assign(new Error(`bad: ${SECRETS.email} ${SECRETS.url}`), { code: "XX000" }) : undefined));
    const res = await call(verifyRoute, { email: "someone@example.com", purpose: "signup", code: SECRETS.code });
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body).toMatchObject({ error: "SERVER_ERROR", message: "Could not verify the code." });
    expect(body.requestId).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
    const all = logs.join("\n");
    expect(all).toContain("otp.verify.failed");
    expect(all).toContain("XX000");
    for (const v of Object.values(SECRETS)) expect(all, v).not.toContain(v);
  });
});
