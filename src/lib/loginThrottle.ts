// Brute-force limiter for the login endpoint, keyed by normalized email, stored in PostgreSQL
// (table login_attempts from db/migrations/003) so every serverless instance shares the same counter.
// Policy is unchanged: 5 failed attempts lock that email for 15 minutes; a successful login clears the counter.
//
// How it counts: every login attempt is counted BEFORE the password is checked (reserveAttempt), and the
// counter is cleared when the password turns out to be right (recordSuccess). Counting first means a burst of
// parallel requests cannot all be checked before the first failure is recorded: the 6th and later are refused.
// Trade-off (unchanged): someone can lock a victim's login for 15 minutes by failing on purpose.
//
// Times come from the database clock unless `now` (ms since epoch) is passed.

import { pool } from "./db";
import type { Queryable } from "./otp";

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;
export const LOCKOUT_MS = 15 * 60 * 1000;

const nowParam = (now?: number) => (now === undefined ? null : new Date(now).toISOString());

/** Test helper only: empties the table of the given (test) database. */
export const __resetLoginThrottle = async (db: Queryable = pool) => void (await db.query("DELETE FROM login_attempts"));

// The counter restarts when the 15-minute window has passed and no lock is active.
const RESET = `((a.locked_until IS NULL OR a.locked_until <= EXCLUDED.window_started_at)
                AND EXCLUDED.window_started_at - a.window_started_at >= interval '15 minutes')`;
const NEXT_FAILURES = `(CASE WHEN ${RESET} THEN 1 ELSE LEAST(a.failures + 1, 1000) END)`;

const RESERVE_SQL = `
WITH t AS (SELECT COALESCE($2::timestamptz, now()) AS n)
INSERT INTO login_attempts AS a (email, failures, window_started_at, locked_until)
SELECT $1, 1, t.n, NULL FROM t
ON CONFLICT (email) DO UPDATE SET
  failures = ${NEXT_FAILURES},
  window_started_at = CASE WHEN ${RESET} THEN EXCLUDED.window_started_at ELSE a.window_started_at END,
  locked_until = CASE
    WHEN a.locked_until > EXCLUDED.window_started_at THEN a.locked_until            -- already locked: stay locked
    WHEN ${NEXT_FAILURES} >= ${MAX_FAILURES} THEN EXCLUDED.window_started_at + interval '15 minutes'
    ELSE NULL END
RETURNING a.failures, a.locked_until, (SELECT n FROM t) AS n`;

/**
 * Counts one login attempt for this email. `allowed` is false once the email is locked (the 6th attempt and
 * later within the lock), with `retryAfterSeconds` for the Retry-After header.
 */
export async function reserveAttempt(key: string, now?: number, db: Queryable = pool): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const { rows } = await db.query(RESERVE_SQL, [key, nowParam(now)]);
  const r = rows[0];
  if (Number(r.failures) <= MAX_FAILURES) return { allowed: true, retryAfterSeconds: 0 };
  const lockedUntil = r.locked_until ? new Date(r.locked_until).getTime() : 0;
  const n = new Date(r.n).getTime();
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((lockedUntil - n) / 1000)) };
}

/** Seconds the caller must wait, or 0 if attempts are allowed. Read-only (does not count an attempt). */
export async function retryAfterSeconds(key: string, now?: number, db: Queryable = pool): Promise<number> {
  const { rows } = await db.query(
    `SELECT GREATEST(CEIL(EXTRACT(EPOCH FROM (a.locked_until - t.n)))::int, 0) AS s
       FROM login_attempts a, (SELECT COALESCE($2::timestamptz, now()) AS n) t
      WHERE a.email = $1 AND a.locked_until > t.n`,
    [key, nowParam(now)]
  );
  return rows[0] ? Number(rows[0].s) : 0;
}

/** Records one failure (same effect as reserveAttempt; kept for callers that count after the fact). */
export async function recordFailure(key: string, now?: number, db: Queryable = pool): Promise<void> {
  await reserveAttempt(key, now, db);
}

/** The password was right: clear this email's counter. */
export async function recordSuccess(key: string, db: Queryable = pool): Promise<void> {
  await db.query("DELETE FROM login_attempts WHERE email = $1", [key]);
}

/** Opportunistic tidying of old rows (serverless has no background job). Never throws. */
export async function maybeCleanupLoginAttempts(db: Queryable = pool, random: () => number = Math.random): Promise<void> {
  if (random() >= 0.05) return;
  try {
    await db.query(`DELETE FROM login_attempts WHERE ctid IN (
      SELECT ctid FROM login_attempts
       WHERE window_started_at < now() - interval '1 day' AND (locked_until IS NULL OR locked_until < now()) LIMIT 100)`);
  } catch { /* tidying must never break a login */ }
}
