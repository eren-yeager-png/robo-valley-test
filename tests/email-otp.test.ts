// Resend email OTP. The `resend` SDK is mocked: these tests NEVER send a real email.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakePool } from "./helpers";
import { __resetOtpStore, MAX_ATTEMPTS, RESEND_COOLDOWN_MS } from "../src/lib/otp";

const m = vi.hoisted(() => ({ send: vi.fn(), ctorKeys: [] as string[], pool: undefined as unknown }));
vi.mock("resend", () => ({
  Resend: class { constructor(key: string) { m.ctorKeys.push(key); } emails = { send: m.send }; },
}));
vi.mock("../src/lib/db", () => ({ get pool() { return m.pool; } }));

import { POST as requestRoute } from "../src/app/api/auth/otp/request/route";
import { POST as verifyRoute } from "../src/app/api/auth/otp/verify/route";
import { POST as signupRoute } from "../src/app/api/auth/signup/route";
import { DEFAULT_FROM, getFromAddress, sendOtpEmail } from "../src/lib/email";

const KEY = "re_test_key_not_real";
const post = (route: typeof requestRoute, body: unknown) =>
  route(new Request("http://t/x", { method: "POST", body: JSON.stringify(body) }));
const ask = (email = "asha@example.com", purpose = "signup") => post(requestRoute, { email, purpose });
const sentCode = () => (m.send.mock.calls.at(-1)![0].text as string).match(/\b(\d{6})\b/)![1];

let logs: string[];
beforeEach(() => {
  __resetOtpStore();
  m.send.mockReset().mockResolvedValue({ data: { id: "email_1" }, error: null });
  m.ctorKeys.length = 0;
  vi.stubEnv("OTP_PROVIDER", "resend");
  vi.stubEnv("RESEND_API_KEY", KEY);
  vi.stubEnv("RESEND_FROM_EMAIL", "");
  logs = [];
  for (const fn of ["log", "error", "warn", "info"] as const) vi.spyOn(console, fn).mockImplementation((...a) => void logs.push(a.map(String).join(" ")));
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("sending through Resend", () => {
  it("emails a 6-digit code to the normalised address and never returns it", async () => {
    const res = await ask("  Asha@Example.COM ");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, provider: "resend", emailSent: true, resendAfterSeconds: 30 });
    expect(Object.keys(body)).not.toContain("devOtp");
    expect(JSON.stringify(body)).not.toMatch(/\d{6}/);

    expect(m.send).toHaveBeenCalledTimes(1);
    const arg = m.send.mock.calls[0][0];
    expect(arg.to).toBe("asha@example.com");
    expect(arg.from).toBe(DEFAULT_FROM);
    expect(arg.from).toContain("onboarding@resend.dev");
    expect(arg.subject).not.toMatch(/\d{6}/); // code is in the body only
    expect(sentCode()).toMatch(/^\d{6}$/);
    expect(arg.html).toContain(sentCode());
    expect(m.ctorKeys).toEqual([KEY]);
  });

  it("uses RESEND_FROM_EMAIL when configured", async () => {
    vi.stubEnv("RESEND_FROM_EMAIL", "RoboValley <no-reply@mail.example.org>");
    await ask();
    expect(m.send.mock.calls[0][0].from).toBe("RoboValley <no-reply@mail.example.org>");
    expect(getFromAddress({} as NodeJS.ProcessEnv)).toBe(DEFAULT_FROM);
  });

  it("verifies the emailed code, then the response never contains the mock flag", async () => {
    await ask();
    const v = await post(verifyRoute, { email: "asha@example.com", purpose: "signup", code: sentCode() });
    const vb = await v.json();
    expect(v.status).toBe(200);
    expect(vb.verificationToken).toHaveLength(64);
    expect(vb.mock).toBeUndefined();
  });

  it("never logs the OTP, the API key or the address", async () => {
    await ask();
    const code = sentCode();
    await post(verifyRoute, { email: "asha@example.com", purpose: "signup", code });
    m.send.mockResolvedValueOnce({ data: null, error: { name: "validation_error", message: `bad ${KEY}` } });
    await ask("other@example.com");
    const all = logs.join("\n");
    expect(all).not.toContain(code);
    expect(all).not.toContain(KEY);
    expect(all).not.toContain("asha@example.com");
    expect(all).not.toContain("other@example.com");
  });
});

describe("provider failures (no silent fallback to mock)", () => {
  it("Resend API error → 502, no code in the response, no mock fallback, cooldown rolled back", async () => {
    vi.stubEnv("MOCK_OTP", "true"); // would enable legacy mock if fallback existed
    m.send.mockResolvedValueOnce({ data: null, error: { name: "validation_error", message: "You can only send testing emails to your own email address" } });
    const res = await ask();
    const text = await res.text();
    expect(res.status).toBe(502);
    expect(JSON.parse(text)).toMatchObject({ success: false, error: "EMAIL_SEND_FAILED" });
    expect(text).not.toMatch(/devOtp|\d{6}|testing emails|validation_error/);

    // the failed attempt did not start a cooldown, and the retry works
    const retry = await ask();
    expect(retry.status).toBe(200);
    expect(m.send).toHaveBeenCalledTimes(2);
  });

  it("a code from a failed send cannot be verified", async () => {
    m.send.mockRejectedValueOnce(new Error("network down"));
    const res = await ask();
    expect(res.status).toBe(502);
    const v = await post(verifyRoute, { email: "asha@example.com", purpose: "signup", code: "123456" });
    expect((await v.json()).error).toBe("OTP_NOT_FOUND");
  });

  it("missing RESEND_API_KEY → 503 and nothing is sent", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("MOCK_OTP", "true");
    const res = await ask();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("EMAIL_NOT_CONFIGURED");
    expect(m.send).not.toHaveBeenCalled();
  });

  it("times out a hung Resend call", async () => {
    vi.useFakeTimers();
    m.send.mockReturnValueOnce(new Promise(() => {}));
    const p = sendOtpEmail("a@example.com", "123456", { RESEND_API_KEY: KEY } as never).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10_500);
    const err = await p;
    vi.useRealTimers();
    expect(err.reason).toBe("timeout");
  });

  it("Resend mode in production still works and never exposes the code", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await ask();
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toMatch(/devOtp|\d{6}/);
  });
});

describe("OTP rules with email delivery", () => {
  it("enforces the resend cooldown without sending a second email", async () => {
    await ask();
    const res = await ask();
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("RESEND_COOLDOWN");
    expect(m.send).toHaveBeenCalledTimes(1);
  });

  it("incorrect code → 400; attempt limit → 429 lockout, even for the right code", async () => {
    await ask();
    const good = sentCode();
    const wrong = good === "111111" ? "222222" : "111111";
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      expect((await post(verifyRoute, { email: "asha@example.com", purpose: "signup", code: wrong })).status).toBe(400);
    }
    expect((await post(verifyRoute, { email: "asha@example.com", purpose: "signup", code: wrong })).status).toBe(429);
    expect((await post(verifyRoute, { email: "asha@example.com", purpose: "signup", code: good })).status).toBe(429);
  });

  it("expired code is rejected", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await ask();
    const code = sentCode();
    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1000);
    const res = await post(verifyRoute, { email: "asha@example.com", purpose: "signup", code });
    vi.useRealTimers();
    expect((await res.json()).error).toBe("OTP_EXPIRED");
  });

  it("a used code cannot be used again; another email or purpose cannot use it", async () => {
    await ask();
    const code = sentCode();
    expect((await post(verifyRoute, { email: "other@example.com", purpose: "signup", code })).status).toBe(400);
    expect((await post(verifyRoute, { email: "asha@example.com", purpose: "guardian", code })).status).toBe(400);
    expect((await post(verifyRoute, { email: "asha@example.com", purpose: "signup", code })).status).toBe(200);
    expect((await post(verifyRoute, { email: "asha@example.com", purpose: "signup", code })).status).toBe(400);
  });

  it("allows another email after the cooldown window for the same address", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await ask();
    vi.setSystemTime(Date.now() + RESEND_COOLDOWN_MS + 1000);
    expect((await ask()).status).toBe(200);
    vi.useRealTimers();
    expect(m.send).toHaveBeenCalledTimes(2);
  });
});

describe("signup requires the verified email", () => {
  const body = (verification: unknown, over: Record<string, unknown> = {}) => ({
    role: "TC", fullName: "Asha Rao", mobile: "9876543210", email: "asha@example.com",
    password: "correct horse", confirmPassword: "correct horse", district: "Guntur", language: "English",
    ageCategory: "adult", consents: { privacy: true, terms: true },
    profile: { school: "ZP High", schoolCode: "12345", subjects: ["Maths"] }, verification, ...over,
  });
  const signup = (b: unknown) => signupRoute(new Request("http://t/s", { method: "POST", body: JSON.stringify(b) }));

  async function verifyEmail(email: string, purpose = "signup") {
    await post(requestRoute, { email, purpose });
    const code = sentCode();
    return (await (await post(verifyRoute, { email, purpose, code })).json()).verificationToken as string;
  }

  it("rejects signup without verification", async () => {
    const pool = makeFakePool(); m.pool = pool.pool;
    const res = await signup(body({}));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("VERIFICATION_REQUIRED");
    expect(pool.calls).toHaveLength(0);
  });

  it("rejects a token verified for a different email than the one being registered", async () => {
    const pool = makeFakePool(); m.pool = pool.pool;
    const token = await verifyEmail("someone.else@example.com");
    const res = await signup(body({ signup: token }));
    expect(res.status).toBe(403);
    expect(pool.calls).toHaveLength(0);
  });

  it("creates the account with the verified email and records email_verification='email'", async () => {
    const pool = makeFakePool(); m.pool = pool.pool;
    const token = await verifyEmail("asha@example.com");
    const res = await signup(body({ signup: token }, { email: "ASHA@example.com" }));
    expect(res.status).toBe(201);
    const ins = pool.calls.find((c) => /INSERT INTO users/.test(c.sql))!;
    expect(ins.params![1]).toBe("asha@example.com");
    expect(ins.params![11]).toBe("email");
    expect(ins.sql).toMatch(/email_verification/);
    // token is single-use
    expect((await signup(body({ signup: token }, { email: "asha@example.com" }))).status).toBe(403);
  });

  it("minor: the student's token cannot stand in for the guardian's", async () => {
    const pool = makeFakePool(); m.pool = pool.pool;
    const mine = await verifyEmail("ravi@example.com");
    const minor = {
      role: "ST", fullName: "Ravi", mobile: "9123456780", email: "ravi@example.com", password: "longenough1", confirmPassword: "longenough1",
      district: "Krishna", ageCategory: "minor", consents: { privacy: true, terms: true },
      guardian: { name: "Lakshmi", relationship: "Mother", mobile: "9988776655", email: "lakshmi@example.com" },
      profile: { class: "Class 9–10", school: "GHS" },
    };
    // student's token cannot stand in for the guardian
    expect((await signup({ ...minor, verification: { signup: mine, guardian: mine } })).status).toBe(403);
    expect(pool.calls).toHaveLength(0);
  });

  it("minor happy path: both emails verified through Resend", async () => {
    const pool = makeFakePool(); m.pool = pool.pool;
    const mine = await verifyEmail("ravi@example.com");
    const theirs = await verifyEmail("lakshmi@example.com", "guardian");
    const res = await signup({
      role: "ST", fullName: "Ravi", mobile: "9123456780", email: "ravi@example.com", password: "longenough1", confirmPassword: "longenough1",
      district: "Krishna", ageCategory: "minor", consents: { privacy: true, terms: true },
      guardian: { name: "Lakshmi", relationship: "Mother", mobile: "9988776655", email: "lakshmi@example.com" },
      profile: { class: "Class 9–10", school: "GHS" }, verification: { signup: mine, guardian: theirs },
    });
    expect(res.status).toBe(201);
    const g = pool.calls.find((c) => /INSERT INTO guardian_details/.test(c.sql))!;
    expect(g.sql).toMatch(/'pending',\$6,'test'/);
    expect(g.params).toEqual(["1", "Lakshmi", "Mother", "9988776655", "lakshmi@example.com", "email"]);
    expect(pool.calls.find((c) => /INSERT INTO users/.test(c.sql))!.params![8]).toBe(false); // guardian_consent not granted
  });

  it("OTP request for a guardian email equal to the student's is refused before any email is sent", async () => {
    const res = await post(requestRoute, { email: "a@example.com", purpose: "guardian", studentEmail: "A@example.com" });
    expect(res.status).toBe(400);
    expect(m.send).not.toHaveBeenCalled();
  });
});
