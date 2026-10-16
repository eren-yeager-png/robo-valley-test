// Email OTP service. Codes are generated and checked here; delivery is done by the caller
// (src/lib/email.ts for Resend). Provider is chosen explicitly with OTP_PROVIDER:
//
//   OTP_PROVIDER=resend  real email through Resend. The code is NEVER returned by the API.
//   OTP_PROVIDER=mock    development/testing only (blocked in production): no email is sent and
//                        the API returns the code. Legacy MOCK_OTP=true is treated the same way
//                        when OTP_PROVIDER is unset.
//   anything else        OTP is disabled (501). There is no silent fallback between providers.
//
// State lives in server memory: it resets on every restart and does not work across multiple
// server instances. Move it to Redis/a database table before scaling out.
// A mock OTP is NOT proof of email ownership or real guardian consent.

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export type OtpPurpose = "signup" | "guardian";
export const OTP_PURPOSES: OtpPurpose[] = ["signup", "guardian"];
export type OtpProvider = "resend" | "mock" | "none";
/** How an identity was verified; stored in the database. */
export type VerifiedVia = "email" | "mock";

export const OTP_TTL_MS = 10 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 30 * 1000;
export const MAX_ATTEMPTS = 5;
export const LOCKOUT_MS = 30 * 60 * 1000;
export const VERIFIED_TTL_MS = 30 * 60 * 1000;
export const MAX_SENDS_PER_HOUR = 6;

export class OtpError extends Error {
  constructor(
    public code:
      | "OTP_DISABLED"
      | "RESEND_COOLDOWN"
      | "TOO_MANY_REQUESTS"
      | "OTP_NOT_FOUND"
      | "OTP_EXPIRED"
      | "OTP_INVALID"
      | "OTP_LOCKED",
    message: string,
    public status: number,
    public retryAfterSeconds?: number,
    public attemptsLeft?: number
  ) {
    super(message);
  }
}

export function getOtpProvider(env: NodeJS.ProcessEnv = process.env): OtpProvider {
  const isProd = env.NODE_ENV === "production";
  const p = env.OTP_PROVIDER?.trim().toLowerCase();
  if (p === "resend") return "resend";
  if (p === "mock") return isProd ? "none" : "mock"; // mock can never run in production
  if (p) return "none"; // unknown value: refuse rather than guess
  return env.MOCK_OTP === "true" && !isProd ? "mock" : "none";
}
export const isMockOtpEnabled = (env: NodeJS.ProcessEnv = process.env) => getOtpProvider(env) === "mock";

type OtpRecord = {
  hash: string;
  expiresAt: number;
  attempts: number;
  lastSentAt: number;
  lockedUntil: number;
  sends: number[]; // send timestamps in the last hour
};
type VerifiedRecord = { purpose: OtpPurpose; email: string; via: VerifiedVia; expiresAt: number };

type Store = { otps: Map<string, OtpRecord>; verified: Map<string, VerifiedRecord>; secret: Buffer };
const g = globalThis as typeof globalThis & { __emailOtpStore?: Store };
const store: Store = (g.__emailOtpStore ??= {
  otps: new Map(),
  verified: new Map(),
  secret: randomBytes(32), // per-process secret: stored hashes are useless outside this process
});

/** Test helper only. */
export function __resetOtpStore() {
  store.otps.clear();
  store.verified.clear();
}

const keyOf = (purpose: OtpPurpose, email: string) => `${purpose}:${email}`;
const hashOtp = (purpose: OtpPurpose, email: string, code: string) =>
  createHmac("sha256", store.secret).update(`${purpose}|${email}|${code}`).digest("hex");
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export type RequestOtpResult = {
  provider: Exclude<OtpProvider, "none">;
  /** The plaintext code, for the caller to deliver. Never log it; only return it to clients in mock mode. */
  code: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  /** Undo this request (used when email delivery fails) so a failed send does not burn the cooldown. */
  rollback: () => void;
};

export function requestOtp(purpose: OtpPurpose, email: string, now = Date.now()): RequestOtpResult {
  const provider = getOtpProvider();
  if (provider === "none") throw new OtpError("OTP_DISABLED", "OTP delivery is not available.", 501);

  const key = keyOf(purpose, email);
  const prev = store.otps.get(key);
  if (prev) {
    if (prev.lockedUntil > now) {
      throw new OtpError("OTP_LOCKED", "Too many wrong attempts. Try again later.", 429, Math.ceil((prev.lockedUntil - now) / 1000));
    }
    const wait = prev.lastSentAt + RESEND_COOLDOWN_MS - now;
    if (wait > 0) {
      throw new OtpError("RESEND_COOLDOWN", "Please wait before requesting another code.", 429, Math.ceil(wait / 1000));
    }
    const recent = prev.sends.filter((t) => now - t < 3600_000);
    if (recent.length >= MAX_SENDS_PER_HOUR) {
      throw new OtpError("TOO_MANY_REQUESTS", "Too many code requests. Try again later.", 429, Math.ceil((recent[0] + 3600_000 - now) / 1000));
    }
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  store.otps.set(key, {
    hash: hashOtp(purpose, email, code),
    expiresAt: now + OTP_TTL_MS,
    attempts: 0,
    lastSentAt: now,
    lockedUntil: prev?.lockedUntil ?? 0,
    sends: [...(prev?.sends ?? []).filter((t) => now - t < 3600_000), now],
  });
  return {
    provider,
    code,
    expiresInSeconds: OTP_TTL_MS / 1000,
    resendAfterSeconds: RESEND_COOLDOWN_MS / 1000,
    rollback: () => void (prev ? store.otps.set(key, prev) : store.otps.delete(key)),
  };
}

/**
 * Checks the code. On success the OTP is destroyed (no reuse) and a single-use
 * verification token is returned. The signup API requires this token; a client-side
 * "verified: true" flag is never trusted.
 */
export function verifyOtp(purpose: OtpPurpose, email: string, code: string, now = Date.now()): { verificationToken: string; via: VerifiedVia } {
  const provider = getOtpProvider();
  if (provider === "none") throw new OtpError("OTP_DISABLED", "OTP verification is not available.", 501);

  const key = keyOf(purpose, email);
  const rec = store.otps.get(key);
  if (!rec) throw new OtpError("OTP_NOT_FOUND", "No code was requested for this email. Request a new code.", 400);
  if (rec.lockedUntil > now) {
    throw new OtpError("OTP_LOCKED", "Too many wrong attempts. Try again later.", 429, Math.ceil((rec.lockedUntil - now) / 1000));
  }
  if (rec.expiresAt <= now) {
    store.otps.delete(key);
    throw new OtpError("OTP_EXPIRED", "This code has expired. Request a new code.", 400);
  }
  if (!safeEq(rec.hash, hashOtp(purpose, email, code))) {
    rec.attempts += 1;
    const left = MAX_ATTEMPTS - rec.attempts;
    if (left <= 0) {
      rec.lockedUntil = now + LOCKOUT_MS;
      rec.hash = ""; // invalidate the code
      rec.expiresAt = 0;
      throw new OtpError("OTP_LOCKED", "Too many wrong attempts. Try again later.", 429, LOCKOUT_MS / 1000, 0);
    }
    throw new OtpError("OTP_INVALID", "That code is not correct.", 400, undefined, left);
  }
  // success: burn the OTP (keep cooldown/send history), issue a single-use token
  rec.hash = "";
  rec.expiresAt = 0;
  const via: VerifiedVia = provider === "resend" ? "email" : "mock";
  const token = randomBytes(32).toString("hex");
  store.verified.set(hashToken(token), { purpose, email, via, expiresAt: now + VERIFIED_TTL_MS });
  return { verificationToken: token, via };
}

/**
 * Atomically claims a verification token for (purpose, email). Returns `restore` to call if the
 * signup later fails so the user need not re-verify, and `via` for the audit columns.
 * Returns null if the token is unknown, expired, already used or bound to something else.
 */
export function claimVerification(
  token: unknown, purpose: OtpPurpose, email: string, now = Date.now()
): { restore: () => void; via: VerifiedVia } | null {
  if (typeof token !== "string" || token.length !== 64) return null;
  const h = hashToken(token);
  const rec = store.verified.get(h);
  if (!rec || rec.expiresAt <= now || rec.purpose !== purpose || rec.email !== email) return null;
  store.verified.delete(h); // synchronous delete => two concurrent requests cannot both claim it
  return { via: rec.via, restore: () => void store.verified.set(h, rec) };
}
