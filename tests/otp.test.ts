import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetOtpStore, claimVerification, getOtpProvider, LOCKOUT_MS, MAX_ATTEMPTS, OTP_TTL_MS, OtpError,
  RESEND_COOLDOWN_MS, requestOtp, verifyOtp,
} from "../src/lib/otp";

const E = "asha@example.com";
const errOf = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as OtpError).code; } return "NO_ERROR"; };

beforeEach(() => __resetOtpStore());
afterEach(() => vi.unstubAllEnvs());

describe("OTP service (mock provider)", () => {
  it("generates a 6-digit code and accepts the correct one", () => {
    const { code } = requestOtp("signup", E);
    expect(code).toMatch(/^\d{6}$/);
    const r = verifyOtp("signup", E, code);
    expect(r.verificationToken).toHaveLength(64);
    expect(r.via).toBe("mock");
  });

  it("rejects an incorrect OTP and reports attempts left", () => {
    const { code } = requestOtp("signup", E);
    const wrong = code === "000000" ? "111111" : "000000";
    try { verifyOtp("signup", E, wrong); expect.unreachable(); } catch (e) {
      expect((e as OtpError).code).toBe("OTP_INVALID");
      expect((e as OtpError).attemptsLeft).toBe(MAX_ATTEMPTS - 1);
    }
  });

  it("rejects an expired OTP", () => {
    const t = 1_000_000;
    const { code } = requestOtp("signup", E, t);
    expect(errOf(() => verifyOtp("signup", E, code, t + OTP_TTL_MS + 1))).toBe("OTP_EXPIRED");
  });

  it("rejects OTP reuse after success", () => {
    const { code } = requestOtp("signup", E);
    verifyOtp("signup", E, code);
    expect(errOf(() => verifyOtp("signup", E, code))).toBe("OTP_EXPIRED");
  });

  it("rejects a missing OTP", () => {
    expect(errOf(() => verifyOtp("signup", E, "123456"))).toBe("OTP_NOT_FOUND");
  });

  it("is bound to the email address (normalised by the caller)", () => {
    const { code } = requestOtp("signup", E);
    expect(errOf(() => verifyOtp("signup", "someone.else@example.com", code))).toBe("OTP_NOT_FOUND");
  });

  it("is bound to the purpose", () => {
    const { code } = requestOtp("signup", E);
    expect(errOf(() => verifyOtp("guardian", E, code))).toBe("OTP_NOT_FOUND");
  });

  it("enforces the resend cooldown", () => {
    const t = 5_000_000;
    requestOtp("signup", E, t);
    expect(errOf(() => requestOtp("signup", E, t + 1000))).toBe("RESEND_COOLDOWN");
    expect(errOf(() => requestOtp("signup", E, t + RESEND_COOLDOWN_MS))).toBe("NO_ERROR");
  });

  it("a new request invalidates the previous code", () => {
    const t = 7_000_000;
    const first = requestOtp("signup", E, t).code;
    const second = requestOtp("signup", E, t + RESEND_COOLDOWN_MS).code;
    if (first !== second) expect(errOf(() => verifyOtp("signup", E, first, t + RESEND_COOLDOWN_MS + 1))).toBe("OTP_INVALID");
    expect(errOf(() => verifyOtp("signup", E, second, t + RESEND_COOLDOWN_MS + 2))).toBe("NO_ERROR");
  });

  it("locks after too many wrong attempts, even for the right code", () => {
    const t = 9_000_000;
    const { code } = requestOtp("signup", E, t);
    const wrong = code === "111111" ? "222222" : "111111";
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) expect(errOf(() => verifyOtp("signup", E, wrong, t))).toBe("OTP_INVALID");
    expect(errOf(() => verifyOtp("signup", E, wrong, t))).toBe("OTP_LOCKED");
    expect(errOf(() => verifyOtp("signup", E, code, t + 1000))).toBe("OTP_LOCKED");
    expect(errOf(() => requestOtp("signup", E, t + RESEND_COOLDOWN_MS + 1))).toBe("OTP_LOCKED");
    const fresh = requestOtp("signup", E, t + LOCKOUT_MS + 1);
    expect(errOf(() => verifyOtp("signup", E, fresh.code, t + LOCKOUT_MS + 2))).toBe("NO_ERROR");
  });

  it("rollback() undoes a request so a failed email send does not burn the cooldown", () => {
    const t = 3_000_000;
    const r = requestOtp("signup", E, t);
    r.rollback();
    expect(errOf(() => verifyOtp("signup", E, r.code, t + 1))).toBe("OTP_NOT_FOUND"); // code no longer valid
    expect(errOf(() => requestOtp("signup", E, t + 1000))).toBe("NO_ERROR"); // no cooldown left behind
  });

  it("rollback() restores the previous code if one existed", () => {
    const t = 3_500_000;
    const first = requestOtp("signup", E, t);
    const second = requestOtp("signup", E, t + RESEND_COOLDOWN_MS);
    second.rollback();
    expect(errOf(() => verifyOtp("signup", E, first.code, t + RESEND_COOLDOWN_MS + 1))).toBe("NO_ERROR");
  });

  it("keeps student and guardian verification separate", () => {
    const g = "parent@example.com";
    const s = requestOtp("signup", E);
    const gd = requestOtp("guardian", g);
    const st = verifyOtp("signup", E, s.code).verificationToken;
    expect(claimVerification(st, "guardian", g)).toBeNull();
    expect(claimVerification(st, "signup", g)).toBeNull();
    expect(claimVerification(st, "signup", E)).not.toBeNull();
    expect(verifyOtp("guardian", g, gd.code).verificationToken).not.toBe(st);
  });

  it("verification tokens are single use, restorable, and expire", () => {
    const { code } = requestOtp("signup", E, 100);
    const { verificationToken } = verifyOtp("signup", E, code, 100);
    const c = claimVerification(verificationToken, "signup", E, 200)!;
    expect(claimVerification(verificationToken, "signup", E, 200)).toBeNull();
    c.restore();
    expect(claimVerification(verificationToken, "signup", E, 200)).not.toBeNull();
    c.restore();
    expect(claimVerification(verificationToken, "signup", E, 100 + 31 * 60_000)).toBeNull(); // expired
    expect(claimVerification("x".repeat(64), "signup", E)).toBeNull();
    expect(claimVerification(true, "signup", E)).toBeNull();
  });

  it("stores no plaintext code in the store", () => {
    const { code } = requestOtp("signup", E);
    const store = (globalThis as unknown as { __emailOtpStore: { otps: Map<string, unknown> } }).__emailOtpStore;
    expect(JSON.stringify([...store.otps.values()])).not.toContain(code);
  });
});

describe("provider selection (no silent fallback, mock never in production)", () => {
  const p = (env: Record<string, string | undefined>) => getOtpProvider(env as NodeJS.ProcessEnv);
  it("OTP_PROVIDER=resend selects Resend, even if MOCK_OTP=true", () => {
    expect(p({ OTP_PROVIDER: "resend", MOCK_OTP: "true" })).toBe("resend");
    expect(p({ OTP_PROVIDER: "Resend", NODE_ENV: "production" })).toBe("resend");
  });
  it("OTP_PROVIDER=mock works outside production only", () => {
    expect(p({ OTP_PROVIDER: "mock", NODE_ENV: "development" })).toBe("mock");
    expect(p({ OTP_PROVIDER: "mock", NODE_ENV: "production" })).toBe("none");
  });
  it("legacy MOCK_OTP=true works only when OTP_PROVIDER is unset and not in production", () => {
    expect(p({ MOCK_OTP: "true" })).toBe("mock");
    expect(p({ MOCK_OTP: "true", NODE_ENV: "production" })).toBe("none");
    expect(p({ MOCK_OTP: "yes" })).toBe("none");
    expect(p({})).toBe("none");
  });
  it("an unknown OTP_PROVIDER disables OTP instead of guessing", () => {
    expect(p({ OTP_PROVIDER: "twilio", MOCK_OTP: "true" })).toBe("none");
  });
  it("requests and verification fail with OTP_DISABLED when no provider is active", () => {
    vi.stubEnv("OTP_PROVIDER", "");
    vi.stubEnv("MOCK_OTP", "");
    expect(errOf(() => requestOtp("signup", E))).toBe("OTP_DISABLED");
    expect(errOf(() => verifyOtp("signup", E, "123456"))).toBe("OTP_DISABLED");
  });
  it("mock is refused in production at request time", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OTP_PROVIDER", "mock");
    expect(errOf(() => requestOtp("signup", E))).toBe("OTP_DISABLED");
  });
});
