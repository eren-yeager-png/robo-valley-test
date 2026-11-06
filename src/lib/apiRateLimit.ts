// Per-visitor request limit for the PUBLIC Find a Service API (search and categories). A fixed one-minute window per address,
// counted in PostgreSQL (table api_rate_limits, migration 011) so every serverless instance shares the same counter.
//
// CHANGE THE LIMITS HERE, in this one place (requests per address per window):
export const SERVICE_RATE_LIMITS = {
  search: 60,
  categories: 30,
} as const;
export const RATE_WINDOW_SECONDS = 60;

// Privacy: the address is never stored. The key holds a keyed hash (HMAC-SHA-256 with the server secret, truncated), so it cannot be
// turned back into an address. Fail open: if the counter cannot be read or written, the request is allowed (a broken limiter must
// never take the search down). Old rows are tidied opportunistically (serverless has no background job).

import { createHmac } from "node:crypto";
import { pool } from "./db";
import { json } from "./http";
import { clientIp } from "./projectsRateLimit";
import type { Queryable } from "./otp";

export type RateScope = keyof typeof SERVICE_RATE_LIMITS;
export type RateDecision = { allowed: boolean; retryAfterSeconds: number };

/** Hash of the caller's address, hex, 32 characters. Keyed with SESSION_SECRET when it is set (it always is in production). */
export function hashAddress(ip: string, env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.SESSION_SECRET && env.SESSION_SECRET.length >= 32 ? env.SESSION_SECRET : "robovalley-rate-limit-no-secret";
  return createHmac("sha256", secret).update("robovalley:api-rate:v1|" + ip).digest("hex").slice(0, 32);
}

const nowParam = (now?: number) => (now === undefined ? null : new Date(now).toISOString());

// One statement: find the current window, count this request, report how long until the window ends.
const HIT_SQL = `
WITH t AS (
  SELECT to_timestamp(floor(extract(epoch FROM COALESCE($2::timestamptz, now())) / $3::int) * $3::int) AS w,
         COALESCE($2::timestamptz, now()) AS n
)
INSERT INTO api_rate_limits AS a (key, window_start, hits)
SELECT $1, t.w, 1 FROM t
ON CONFLICT (key, window_start) DO UPDATE SET hits = LEAST(a.hits + 1, 1000000)
RETURNING a.hits,
          GREATEST(CEIL(EXTRACT(EPOCH FROM (a.window_start + make_interval(secs => $3::int) - (SELECT n FROM t)))), 1)::int AS retry`;

/** Counts one request for this visitor and scope. `limit` defaults to SERVICE_RATE_LIMITS[scope]. Never throws. */
export async function hitRateLimit(
  ip: string, scope: RateScope, opts: { db?: Queryable; now?: number; limit?: number; env?: NodeJS.ProcessEnv } = {}
): Promise<RateDecision> {
  const db = opts.db ?? pool, limit = opts.limit ?? SERVICE_RATE_LIMITS[scope];
  try {
    const { rows } = await db.query(HIT_SQL, [`${scope}:${hashAddress(ip, opts.env)}`, nowParam(opts.now), RATE_WINDOW_SECONDS]);
    const r = rows[0];
    if (!r || Number(r.hits) <= limit) return { allowed: true, retryAfterSeconds: 0 };
    return { allowed: false, retryAfterSeconds: Math.max(1, Number(r.retry) || RATE_WINDOW_SECONDS) };
  } catch {
    return { allowed: true, retryAfterSeconds: 0 }; // fail open
  }
}

/** Opportunistic tidying: about 2% of calls delete up to 200 windows older than an hour. Never throws. */
export async function maybeCleanupRateLimits(db: Queryable = pool, random: () => number = Math.random): Promise<void> {
  if (random() >= 0.02) return;
  try {
    await db.query(`DELETE FROM api_rate_limits WHERE ctid IN (
      SELECT ctid FROM api_rate_limits WHERE window_start < now() - interval '1 hour' LIMIT 200)`);
  } catch { /* tidying must never break a search */ }
}

/** The friendly 429 answer. Never cacheable (no-store), with Retry-After. The caller adds CORS. */
export function rateLimitedResponse(retryAfterSeconds: number): Response {
  const n = Math.max(1, Math.round(retryAfterSeconds));
  return json(
    { success: false, error: "RATE_LIMITED", message: `Lots of people are searching right now. Please try again in ${n} ${n === 1 ? "second" : "seconds"}.`, retryAfter: n },
    429,
    { "Retry-After": String(n) }
  );
}

/** For a route: returns a 429 Response when this caller is over the limit, otherwise null. */
export async function enforceRateLimit(req: Request, scope: RateScope): Promise<Response | null> {
  const d = await hitRateLimit(clientIp(req), scope);
  void maybeCleanupRateLimits();
  return d.allowed ? null : rateLimitedResponse(d.retryAfterSeconds);
}
