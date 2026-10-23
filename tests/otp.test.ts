// OTP service against an in-process PostgreSQL (real SQL; see tests/helpers.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import { testDb } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });

import {
  claimVerification, cleanupExpired, getOtpProvider, LOCKOUT_MS, MAX_ATTEMPTS, MAX_SENDS_PER_HOUR, OTP_TTL_MS, OtpError,
  RESEND_COOLDOWN_MS, requestOtp, verifyOtp, VERIFIED_TTL_MS,
} from "../src/lib/otp";

const E = "asha@example.com";
const T0 = Date.UTC(2030, 0, 1, 12, 0, 0); // a fixed "now" far from the real clock
const errOf = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { return (e as OtpError).code; } return "NO_ERROR"; };
const rows = async (sql: string, p: unknown[] = []) => (await testDb().raw.query(sql, p as never)).rows as any[];

afterEach(() => vi.unstubAllEnvs());

describe("OTP service (mock provider, PostgreSQL storage)", () => {
  it("generates a 6-digit code and accepts the correct one", async () => {
    const { code } = await requestOtp("signup", E);
    expect(code).toMatch(/^\d{6}$/);
    const r = await verifyOtp("signup", E, code);
    expect(r.verificationToken).toMatch(/^[0-9a-f]{64}$/);
    expect(r.via).toBe("mock");
  });

  it("rejects an incorrect OTP and reports attempts left", async () => {
    const { code } = await requestOtp("signup", E);
    const wrong = code === "000000" ? "111111" : "000000";
    const e: OtpError = await verifyOtp("signup", E, wrong).catch((x) => x);
    expect(e.code).toBe("OTP_INVALID");
    expect(e.attemptsLeft).toBe(MAX_ATTEMPTS - 1);
    expect(e.status).toBe(400);
  });

  it("rejects an expired OTP (10 minutes)", async () => {
    const { code } = await requestOtp("signup", E, T0);
    expect(await errOf(() => verifyOtp("signup", E, code, T0 + OTP_TTL_MS - 1000))).toBe("NO_ERROR");
    const { code: c2 } = await requestOtp("guardian", E, T0);
    expect(await errOf(() => verifyOtp("guardian", E, c2, T0 + OTP_TTL_MS))).toBe("OTP_EXPIRED");
  });

  it("rejects OTP reuse after success", async () => {
    const { code } = await requestOtp("signup", E);
    await verifyOtp("signup", E, code);
    expect(await errOf(() => verifyOtp("signup", E, code))).toBe("OTP_EXPIRED");
  });

  it("rejects a missing OTP", async () => {
    expect(await errOf(() => verifyOtp("signup", E, "123456"))).toBe("OTP_NOT_FOUND");
  });

  it("is bound to the email address and to the purpose", async () => {
    const { code } = await requestOtp("signup", E);
    expect(await errOf(() => verifyOtp("signup", "someone.else@example.com", code))).toBe("OTP_NOT_FOUND");
    expect(await errOf(() => verifyOtp("guardian", E, code))).toBe("OTP_NOT_FOUND");
  });

  it("enforces the 30-second resend cooldown", async () => {
    await requestOtp("signup", E, T0);
    const e: OtpError = await requestOtp("signup", E, T0 + 1000).catch((x) => x);
    expect(e.code).toBe("RESEND_COOLDOWN");
    expect(e.status).toBe(429);
    expect(e.retryAfterSeconds).toBe(29);
    expect(await errOf(() => requestOtp("signup", E, T0 + RESEND_COOLDOWN_MS - 1))).toBe("RESEND_COOLDOWN");
    expect(await errOf(() => requestOtp("signup", E, T0 + RESEND_COOLDOWN_MS))).toBe("NO_ERROR");
  });

  it("a new request invalidates the previous code", async () => {
    const first = await requestOtp("signup", E, T0);
    const second = await requestOtp("signup", E, T0 + RESEND_COOLDOWN_MS);
    if (first.code !== second.code) expect(await errOf(() => verifyOtp("signup", E, first.code, T0 + RESEND_COOLDOWN_MS + 1))).toBe("OTP_INVALID");
    expect(await errOf(() => verifyOtp("signup", E, second.code, T0 + RESEND_COOLDOWN_MS + 2))).toBe("NO_ERROR");
  });

  it("caps requests at 6 per hour, then allows again after the hour", async () => {
    for (let i = 0; i < MAX_SENDS_PER_HOUR; i++) await requestOtp("signup", E, T0 + i * 40_000);
    const e: OtpError = await requestOtp("signup", E, T0 + 6 * 40_000).catch((x) => x);
    expect(e.code).toBe("TOO_MANY_REQUESTS");
    expect(e.retryAfterSeconds).toBeGreaterThan(0);
    expect(await errOf(() => requestOtp("signup", E, T0 + 3600_000 + 1000))).toBe("NO_ERROR");
  });

  it("locks after 5 wrong attempts for 30 minutes, even for the right code, then recovers", async () => {
    const { code } = await requestOtp("signup", E, T0);
    const wrong = code === "111111" ? "222222" : "111111";
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) expect(await errOf(() => verifyOtp("signup", E, wrong, T0))).toBe("OTP_INVALID");
    const fifth: OtpError = await verifyOtp("signup", E, wrong, T0).catch((x) => x);
    expect(fifth.code).toBe("OTP_LOCKED");
    expect(fifth.retryAfterSeconds).toBe(LOCKOUT_MS / 1000);
    expect(fifth.attemptsLeft).toBe(0);
    expect(await errOf(() => verifyOtp("signup", E, code, T0 + 1000))).toBe("OTP_LOCKED"); // right code, still locked
    expect(await errOf(() => requestOtp("signup", E, T0 + RESEND_COOLDOWN_MS + 1))).toBe("OTP_LOCKED"); // cannot request around the lock
    const fresh = await requestOtp("signup", E, T0 + LOCKOUT_MS + 1);
    expect(await errOf(() => verifyOtp("signup", E, fresh.code, T0 + LOCKOUT_MS + 2))).toBe("NO_ERROR");
  });

  it("parallel guesses cannot beat the attempt limit (the row is locked while each guess is counted)", async () => {
    const { code } = await requestOtp("signup", E, T0);
    const wrongs = Array.from({ length: 12 }, (_, i) => String(100000 + i)).filter((c) => c !== code);
    const results = await Promise.all(wrongs.map((w) => errOf(() => verifyOtp("signup", E, w, T0))));
    expect(results.filter((r) => r === "OTP_INVALID")).toHaveLength(MAX_ATTEMPTS - 1);
    expect(results.filter((r) => r === "OTP_LOCKED").length).toBe(wrongs.length - (MAX_ATTEMPTS - 1));
    const [row] = await rows("select attempts, code_hash from otp_challenges");
    expect(Number(row.attempts)).toBe(MAX_ATTEMPTS);
    expect(row.code_hash).toBeNull(); // the code is dead after lockout
  });

  it("rollback() voids a code whose email could not be sent, and clears its cooldown", async () => {
    const r = await requestOtp("signup", E, T0);
    await r.rollback();
    expect(await errOf(() => verifyOtp("signup", E, r.code, T0 + 1))).toBe("OTP_EXPIRED"); // void
    expect(await errOf(() => requestOtp("signup", E, T0 + 1000))).toBe("NO_ERROR"); // no cooldown left behind
  });

  it("rollback() never voids a newer code", async () => {
    const first = await requestOtp("signup", E, T0);
    const second = await requestOtp("signup", E, T0 + RESEND_COOLDOWN_MS);
    await first.rollback(); // stale: must not touch the newer code
    expect(await errOf(() => verifyOtp("signup", E, second.code, T0 + RESEND_COOLDOWN_MS + 1))).toBe("NO_ERROR");
  });

  it("keeps student and guardian verification separate", async () => {
    const g = "parent@example.com";
    const s = await requestOtp("signup", E);
    const gd = await requestOtp("guardian", g);
    const st = (await verifyOtp("signup", E, s.code)).verificationToken;
    expect(await claimVerification(st, "guardian", g)).toBeNull();
    expect(await claimVerification(st, "signup", g)).toBeNull();
    expect(await claimVerification(st, "signup", E)).not.toBeNull();
    expect((await verifyOtp("guardian", g, gd.code)).verificationToken).not.toBe(st);
  });
});

describe("verification tokens", () => {
  it("are single use, restorable, and expire after 30 minutes", async () => {
    const { code } = await requestOtp("signup", E, T0);
    const { verificationToken: tok } = await verifyOtp("signup", E, code, T0);
    const c = (await claimVerification(tok, "signup", E, T0 + 1000))!;
    expect(c.via).toBe("mock");
    expect(await claimVerification(tok, "signup", E, T0 + 1000)).toBeNull(); // consumed
    await c.restore();
    expect(await claimVerification(tok, "signup", E, T0 + VERIFIED_TTL_MS)).toBeNull(); // expired exactly at 30 min
    await c.restore();
    expect(await claimVerification(tok, "signup", E, T0 + VERIFIED_TTL_MS - 1000)).not.toBeNull();
  });

  it("rejects malformed, unknown and non-string tokens without error", async () => {
    for (const bad of [undefined, null, 5, "", "x".repeat(64), "a".repeat(64), "A".repeat(64), "a".repeat(63), {}, true]) {
      expect(await claimVerification(bad, "signup", E)).toBeNull();
    }
  });

  it("claiming inside a transaction that rolls back leaves the token valid", async () => {
    const { code } = await requestOtp("signup", E);
    const { verificationToken: tok } = await verifyOtp("signup", E, code);
    const c = await testDb().pool.connect();
    await c.query("BEGIN");
    expect(await claimVerification(tok, "signup", E, undefined, c as never)).not.toBeNull();
    await c.query("ROLLBACK");
    c.release();
    expect(await claimVerification(tok, "signup", E)).not.toBeNull();
  });
});

describe("state is shared by every instance (the serverless requirement)", () => {
  it("a code requested by one module instance is verified by a completely fresh one", async () => {
    const { code } = await requestOtp("signup", E);
    vi.resetModules(); // a brand-new "serverless instance": no module state at all
    const fresh = await import("../src/lib/otp");
    const { verificationToken } = await fresh.verifyOtp("signup", E, code);
    vi.resetModules();
    const another = await import("../src/lib/otp");
    expect(await another.claimVerification(verificationToken, "signup", E)).not.toBeNull();
  });

  it("the cooldown and lockout are also visible to a fresh instance", async () => {
    await requestOtp("signup", E, T0);
    vi.resetModules();
    const fresh = await import("../src/lib/otp");
    expect(await errOf(() => fresh.requestOtp("signup", E, T0 + 1000))).toBe("RESEND_COOLDOWN");
  });
});

describe("what is stored, and the hash key", () => {
  it("never stores the OTP code or the verification token in plaintext (checked across every column)", async () => {
    const { code } = await requestOtp("signup", E);
    const { verificationToken } = await verifyOtp("signup", E, code);
    const { code: pending } = await requestOtp("guardian", E);
    for (const table of ["otp_challenges", "email_verifications", "login_attempts"]) {
      const dump = JSON.stringify(await rows(`select * from ${table}`));
      expect(dump, table).not.toContain(verificationToken);
      expect(dump, table).not.toContain(`"${code}"`);
      expect(dump, table).not.toContain(`"${pending}"`);
    }
    const [ch] = await rows("select code_hash from otp_challenges where purpose = 'guardian'");
    expect(ch.code_hash).toMatch(/^[0-9a-f]{64}$/);
    const [ev] = await rows("select token_hash from email_verifications");
    expect(ev.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(ev.token_hash).not.toBe(verificationToken);
  });

  it("hashes are keyed by SESSION_SECRET: the same inputs under another secret do not verify", async () => {
    vi.stubEnv("SESSION_SECRET", "first-secret-first-secret-first-secret-1");
    const { code } = await requestOtp("signup", E);
    const [h1] = await rows("select code_hash h from otp_challenges");
    vi.stubEnv("SESSION_SECRET", "second-secret-second-secret-second-sec-2");
    expect(await errOf(() => verifyOtp("signup", E, code))).toBe("OTP_INVALID"); // right code, wrong key
    vi.stubEnv("SESSION_SECRET", "first-secret-first-secret-first-secret-1");
    expect(await errOf(() => verifyOtp("signup", E, code))).toBe("NO_ERROR"); // the same key on any instance works
    expect(h1.h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the hash depends on purpose and email too (domain separation)", async () => {
    await requestOtp("signup", "a@example.com", T0);
    await requestOtp("signup", "b@example.com", T0);
    const hs = (await rows("select code_hash h from otp_challenges")).map((r) => r.h);
    expect(new Set(hs).size).toBe(2);
  });

  it("refuses to run without a strong SESSION_SECRET (no insecure default)", async () => {
    for (const bad of ["", "short"]) {
      vi.stubEnv("SESSION_SECRET", bad);
      const e: OtpError = await requestOtp("signup", E).catch((x) => x);
      expect(e.code).toBe("OTP_NOT_CONFIGURED");
      expect(e.status).toBe(503);
      expect(await errOf(() => verifyOtp("signup", E, "123456"))).toBe("OTP_NOT_CONFIGURED");
    }
    expect(await rows("select * from otp_challenges")).toHaveLength(0); // nothing stored
  });
});

describe("housekeeping", () => {
  it("cleanupExpired removes old rows only, never fresh or still-locked ones", async () => {
    const raw = testDb().raw;
    await raw.exec(`
      insert into otp_challenges (purpose,email,code_hash,expires_at,last_sent_at,window_started_at) values
        ('signup','old@e.co',null, now()-interval '3 days', now()-interval '3 days', now()-interval '3 days'),
        ('signup','fresh@e.co',repeat('a',64), now()+interval '5 minutes', now(), now());
      insert into otp_challenges (purpose,email,code_hash,expires_at,last_sent_at,window_started_at,locked_until) values
        ('guardian','locked@e.co',null, now()-interval '3 days', now()-interval '3 days', now()-interval '3 days', now()+interval '10 minutes');
      insert into email_verifications (token_hash,purpose,email,via,expires_at) values
        (repeat('b',64),'signup','old@e.co','mock', now()-interval '3 days'),
        (repeat('c',64),'signup','fresh@e.co','mock', now()+interval '10 minutes');`);
    await cleanupExpired(testDb().pool);
    expect((await rows("select email from otp_challenges order by email")).map((r) => r.email)).toEqual(["fresh@e.co", "locked@e.co"]);
    expect((await rows("select email from email_verifications")).map((r) => r.email)).toEqual(["fresh@e.co"]);
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
  it("requests and verification fail with OTP_DISABLED when no provider is active", async () => {
    vi.stubEnv("OTP_PROVIDER", "");
    vi.stubEnv("MOCK_OTP", "");
    expect(await errOf(() => requestOtp("signup", E))).toBe("OTP_DISABLED");
    expect(await errOf(() => verifyOtp("signup", E, "123456"))).toBe("OTP_DISABLED");
    expect(await rows("select * from otp_challenges")).toHaveLength(0);
  });
  it("mock is refused in production at request time", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OTP_PROVIDER", "mock");
    expect(await errOf(() => requestOtp("signup", E))).toBe("OTP_DISABLED");
  });
});
