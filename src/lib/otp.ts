// Email OTP service, stored in PostgreSQL so that every serverless instance sees the same state.
// Codes are generated and checked here; delivery is done by the caller (src/lib/email.ts for Resend).
//
// Provider is chosen explicitly with OTP_PROVIDER:
//   OTP_PROVIDER=resend  real email through Resend. The code is NEVER returned by the API.
//   OTP_PROVIDER=mock    development/testing only (blocked in production): no email is sent and
//                        the API returns the code. Legacy MOCK_OTP=true is treated the same way
//                        when OTP_PROVIDER is unset.
//   anything else        OTP is disabled (501). There is no silent fallback between providers.
//
// Storage (tables from db/migrations/003_otp_and_login_throttle.sql):
//   otp_challenges      one row per (purpose, email): HMAC of the code, expiry, attempts, lock, cooldown
//   email_verifications single-use proof of a verified email: SHA-256 of a random token
// Nothing secret is stored in plaintext: no OTP code and no verification token ever touches the database.
// The OTP hash key is derived from SESSION_SECRET (so every instance computes the same hash) with a
// fixed label, which keeps it separate from the key that signs session cookies.
//
// Times come from the database clock unless a `now` (ms since epoch) is passed, which keeps all
// instances consistent and lets tests move time. A mock OTP is NOT proof of email ownership.

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { pool } from "./db";

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

/** Anything shaped like a pg Pool/Client query function (the app's pool, or a test database). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- query result rows are untyped (pg returns plain objects)
export type Queryable = { query(text: string, params?: unknown[]): Promise<{ rows: any[] }> };
/** A Queryable that can also check out a connection for a transaction (pg Pool). */
export type Db = Queryable & { connect(): Promise<Queryable & { release(err?: Error | boolean): void }> };

export class OtpError extends Error {
  constructor(
    public code:
      | "OTP_DISABLED"
      | "OTP_NOT_CONFIGURED"
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

// ---------------------------------------------------------------------------------------------
// hashing (stable across instances: derived from SESSION_SECRET, never stored)
// ---------------------------------------------------------------------------------------------
function otpKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const s = env.SESSION_SECRET;
  if (!s || s.length < 32) throw new OtpError("OTP_NOT_CONFIGURED", "The verification service is not configured.", 503);
  return createHmac("sha256", s).update("robovalley:otp-hash:v1").digest();
}
const hashOtp = (key: Buffer, purpose: OtpPurpose, email: string, code: string) =>
  createHmac("sha256", key).update(`${purpose}|${email}|${code}`).digest("hex");
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
/** `null` tells SQL to use the database clock; a number pins "now" (tests). */
const nowParam = (now?: number) => (now === undefined ? null : new Date(now).toISOString());
export const isWellFormedToken = (t: unknown): t is string => typeof t === "string" && /^[0-9a-f]{64}$/.test(t);

// ---------------------------------------------------------------------------------------------
// housekeeping: expired rows are already ignored by every query, so this is only tidying.
// Serverless has no background process, so it runs opportunistically on ~1 in 20 requests.
// ---------------------------------------------------------------------------------------------
export async function cleanupExpired(db: Queryable = pool): Promise<void> {
  await db.query(`DELETE FROM otp_challenges WHERE ctid IN (
    SELECT ctid FROM otp_challenges
     WHERE last_sent_at < now() - interval '1 day' AND expires_at < now() - interval '1 day'
       AND (locked_until IS NULL OR locked_until < now()) LIMIT 100)`);
  await db.query(`DELETE FROM email_verifications WHERE ctid IN (
    SELECT ctid FROM email_verifications WHERE expires_at < now() - interval '1 day' LIMIT 100)`);
}
export async function maybeCleanup(db: Queryable = pool, random: () => number = Math.random): Promise<void> {
  if (random() >= 0.05) return;
  try { await cleanupExpired(db); } catch { /* tidying must never break a request */ }
}

/** Test helper only: empties the OTP tables of the given (test) database. */
export async function __resetOtpStore(db: Queryable = pool): Promise<void> {
  await db.query("DELETE FROM otp_challenges");
  await db.query("DELETE FROM email_verifications");
}

// ---------------------------------------------------------------------------------------------
// request
// ---------------------------------------------------------------------------------------------
export type RequestOtpResult = {
  provider: Exclude<OtpProvider, "none">;
  /** The plaintext code, for the caller to deliver. Never log it; only return it to clients in mock mode. */
  code: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  /** Void this code and clear its cooldown (used when email delivery fails). */
  rollback: () => Promise<void>;
};

// One atomic statement decides whether a new code may be issued (cooldown, lock, hourly cap) and stores it.
// If a conflicting row exists and the WHERE clause is false, nothing is updated and no row is returned.
const ISSUE_SQL = `
WITH t AS (SELECT COALESCE($4::timestamptz, now()) AS n)
INSERT INTO otp_challenges AS c
  (purpose, email, code_hash, expires_at, attempts, locked_until, last_sent_at, window_started_at, sends_in_window)
SELECT $1, $2, $3, t.n + interval '10 minutes', 0, NULL, t.n, t.n, 1 FROM t
ON CONFLICT (purpose, email) DO UPDATE SET
  code_hash = EXCLUDED.code_hash,
  expires_at = EXCLUDED.expires_at,
  attempts = 0,
  last_sent_at = EXCLUDED.last_sent_at,
  window_started_at = CASE WHEN EXCLUDED.last_sent_at - c.window_started_at >= interval '1 hour'
                           THEN EXCLUDED.last_sent_at ELSE c.window_started_at END,
  sends_in_window   = CASE WHEN EXCLUDED.last_sent_at - c.window_started_at >= interval '1 hour'
                           THEN 1 ELSE LEAST(c.sends_in_window + 1, 1000) END
WHERE (c.locked_until IS NULL OR c.locked_until <= EXCLUDED.last_sent_at)
  AND c.last_sent_at + interval '30 seconds' <= EXCLUDED.last_sent_at
  AND (EXCLUDED.last_sent_at - c.window_started_at >= interval '1 hour' OR c.sends_in_window < ${MAX_SENDS_PER_HOUR})
RETURNING c.purpose`;

// Why was a request refused? Same priority as before: locked, then cooldown, then hourly cap.
const WHY_SQL = `
SELECT GREATEST(CEIL(EXTRACT(EPOCH FROM (c.locked_until - t.n)))::int, 0) AS lock_s,
       GREATEST(CEIL(EXTRACT(EPOCH FROM (c.last_sent_at + interval '30 seconds' - t.n)))::int, 0) AS cool_s,
       GREATEST(CEIL(EXTRACT(EPOCH FROM (c.window_started_at + interval '1 hour' - t.n)))::int, 0) AS hour_s
  FROM otp_challenges c, (SELECT COALESCE($3::timestamptz, now()) AS n) t
 WHERE c.purpose = $1 AND c.email = $2`;

export async function requestOtp(purpose: OtpPurpose, email: string, now?: number, db: Queryable = pool): Promise<RequestOtpResult> {
  const provider = getOtpProvider();
  if (provider === "none") throw new OtpError("OTP_DISABLED", "OTP delivery is not available.", 501);
  const key = otpKey();

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const hash = hashOtp(key, purpose, email, code);

  await maybeCleanup(db);
  let issued = false;
  for (let attempt = 0; attempt < 2 && !issued; attempt++) {
    const r = await db.query(ISSUE_SQL, [purpose, email, hash, nowParam(now)]);
    if (r.rows.length) { issued = true; break; }
    const why = (await db.query(WHY_SQL, [purpose, email, nowParam(now)])).rows[0];
    if (!why) continue; // the row vanished between the two statements (cleanup): try once more
    if (why.lock_s > 0) throw new OtpError("OTP_LOCKED", "Too many wrong attempts. Try again later.", 429, why.lock_s);
    if (why.cool_s > 0) throw new OtpError("RESEND_COOLDOWN", "Please wait before requesting another code.", 429, why.cool_s);
    throw new OtpError("TOO_MANY_REQUESTS", "Too many code requests. Try again later.", 429, Math.max(why.hour_s, 1));
  }
  if (!issued) throw new OtpError("RESEND_COOLDOWN", "Please wait before requesting another code.", 429, 1);

  return {
    provider,
    code,
    expiresInSeconds: OTP_TTL_MS / 1000,
    resendAfterSeconds: RESEND_COOLDOWN_MS / 1000,
    rollback: async () => {
      // only if this code is still the current one: never clobber a newer request
      await db.query(
        `UPDATE otp_challenges
            SET code_hash = NULL, expires_at = last_sent_at,
                last_sent_at = last_sent_at - interval '1 hour',
                sends_in_window = GREATEST(sends_in_window - 1, 0)
          WHERE purpose = $1 AND email = $2 AND code_hash = $3`,
        [purpose, email, hash]
      );
    },
  };
}

// ---------------------------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------------------------
type Outcome =
  | { ok: true; token: string; via: VerifiedVia }
  | { ok: false; error: OtpError };

/**
 * Checks the code. On success the OTP is destroyed (no reuse) and a single-use verification token is
 * returned. The row is locked (FOR UPDATE) for the whole check, so parallel guesses are counted one by one:
 * a burst of requests cannot test more codes than the attempt limit allows.
 */
export async function verifyOtp(purpose: OtpPurpose, email: string, code: string, now?: number, db: Db = pool): Promise<{ verificationToken: string; via: VerifiedVia }> {
  const provider = getOtpProvider();
  if (provider === "none") throw new OtpError("OTP_DISABLED", "OTP verification is not available.", 501);
  const key = otpKey();

  const c = await db.connect();
  let outcome: Outcome;
  try {
    await c.query("BEGIN");
    try {
      const { rows } = await c.query(
        `SELECT code_hash, expires_at, attempts, locked_until, COALESCE($3::timestamptz, now()) AS n
           FROM otp_challenges WHERE purpose = $1 AND email = $2 FOR UPDATE`,
        [purpose, email, nowParam(now)]
      );
      const row = rows[0];
      if (!row) {
        outcome = { ok: false, error: new OtpError("OTP_NOT_FOUND", "No code was requested for this email. Request a new code.", 400) };
      } else {
        const n = new Date(row.n).getTime();
        const nIso = new Date(row.n).toISOString();
        const lockedUntil = row.locked_until ? new Date(row.locked_until).getTime() : 0;
        if (lockedUntil > n) {
          outcome = { ok: false, error: new OtpError("OTP_LOCKED", "Too many wrong attempts. Try again later.", 429, Math.ceil((lockedUntil - n) / 1000)) };
        } else if (!row.code_hash || new Date(row.expires_at).getTime() <= n) {
          // never issued, already used, voided, or past its 10 minutes: all look the same to the caller
          outcome = { ok: false, error: new OtpError("OTP_EXPIRED", "This code has expired. Request a new code.", 400) };
        } else if (!safeEq(String(row.code_hash), hashOtp(key, purpose, email, code))) {
          const attempts = Number(row.attempts) + 1;
          if (attempts >= MAX_ATTEMPTS) {
            await c.query(
              `UPDATE otp_challenges SET attempts = $3, code_hash = NULL, expires_at = $4::timestamptz,
                      locked_until = $4::timestamptz + interval '30 minutes'
                WHERE purpose = $1 AND email = $2`,
              [purpose, email, attempts, nIso]
            );
            outcome = { ok: false, error: new OtpError("OTP_LOCKED", "Too many wrong attempts. Try again later.", 429, LOCKOUT_MS / 1000, 0) };
          } else {
            await c.query("UPDATE otp_challenges SET attempts = $3 WHERE purpose = $1 AND email = $2", [purpose, email, attempts]);
            outcome = { ok: false, error: new OtpError("OTP_INVALID", "That code is not correct.", 400, undefined, MAX_ATTEMPTS - attempts) };
          }
        } else {
          // correct: burn the code (keep the cooldown history) and issue a single-use token
          const via: VerifiedVia = provider === "resend" ? "email" : "mock";
          const token = randomBytes(32).toString("hex");
          await c.query("UPDATE otp_challenges SET code_hash = NULL, expires_at = $3::timestamptz WHERE purpose = $1 AND email = $2", [purpose, email, nIso]);
          await c.query(
            `INSERT INTO email_verifications (token_hash, purpose, email, via, expires_at)
             VALUES ($1, $2, $3, $4, $5::timestamptz + interval '30 minutes')`,
            [hashToken(token), purpose, email, via, nIso]
          );
          outcome = { ok: true, token, via };
        }
      }
      await c.query("COMMIT"); // wrong-attempt counters must be saved even though we throw below
    } catch (err) {
      await c.query("ROLLBACK").catch(() => undefined);
      throw err;
    }
  } finally {
    c.release();
  }
  if ("error" in outcome) throw outcome.error;
  return { verificationToken: outcome.token, via: outcome.via };
}

// ---------------------------------------------------------------------------------------------
// claim (used by signup)
// ---------------------------------------------------------------------------------------------
/**
 * Atomically consumes a verification token for (purpose, email) with one DELETE ... RETURNING, so two
 * parallel signups cannot both use it. Pass the signup transaction's client as `db`: if the signup then
 * fails and is rolled back, the token is automatically still valid (no restore needed).
 * Returns null if the token is malformed, unknown, expired, already used, or bound to something else.
 * `restore` re-inserts the token for callers that claimed it outside a transaction.
 */
export async function claimVerification(
  token: unknown, purpose: OtpPurpose, email: string, now?: number, db: Queryable = pool
): Promise<{ restore: () => Promise<void>; via: VerifiedVia } | null> {
  if (!isWellFormedToken(token)) return null;
  const h = hashToken(token);
  const { rows } = await db.query(
    `DELETE FROM email_verifications
      WHERE token_hash = $1 AND purpose = $2 AND email = $3 AND expires_at > COALESCE($4::timestamptz, now())
      RETURNING via, expires_at`,
    [h, purpose, email, nowParam(now)]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    via: row.via as VerifiedVia,
    restore: async () => {
      await db.query(
        `INSERT INTO email_verifications (token_hash, purpose, email, via, expires_at)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (token_hash) DO NOTHING`,
        [h, purpose, email, row.via, new Date(row.expires_at).toISOString()]
      );
    },
  };
}
