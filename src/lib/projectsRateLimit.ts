// Small fixed-window rate limiter for the members-only Projects routes. Keys are caller-chosen strings (e.g. "projects:ip:1.2.3.4").
//
// IMPORTANT LIMIT: the counters live in this server instance's memory. On a single server that is an exact limit; on serverless
// hosting each instance counts separately, so the effective limit is "per instance" (best effort, still stops a runaway script
// hammering one instance). The repo's only shared limiter (loginThrottle) is tied to the login_attempts table and its lockout
// policy, so it cannot be reused here, and a shared limiter would need a new table (a migration). Ask before adding one.

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000; // bound memory: expired buckets are swept when the map grows past this

export type RateResult = { allowed: boolean; retryAfterSeconds: number };

/** Counts one hit for `key`: at most `limit` hits per `windowMs`. `now` (ms since epoch) is for tests. */
export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateResult {
  if (buckets.size > MAX_KEYS) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    if (buckets.size > MAX_KEYS) buckets.clear(); // still over: a flood of distinct keys; start over rather than grow without bound
  }
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  b.count += 1;
  if (b.count <= limit) return { allowed: true, retryAfterSeconds: 0 };
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
}

/** Test helper only. */
export const __resetRateLimit = () => buckets.clear();

/** The caller's address as the hosting platform reports it (first X-Forwarded-For entry). A hint for throttling, never for security. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = fwd || req.headers.get("x-real-ip")?.trim() || "unknown";
  return ip.slice(0, 64);
}
