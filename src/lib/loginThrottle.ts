// In-memory brute-force limiter for the login endpoint, keyed by normalized email.
// 5 failed attempts lock that email for 15 minutes; a successful login clears the counter.
// Resets on server restart and is per instance (use Redis/DB when running several instances).
// Trade-off: someone can lock a victim's login for 15 minutes by failing on purpose; bcrypt
// cost 12 plus this limit is preferred to leaving password guessing unthrottled.

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;
export const LOCKOUT_MS = 15 * 60 * 1000;

type Entry = { failures: number; firstAt: number; lockedUntil: number };
const g = globalThis as typeof globalThis & { __loginThrottle?: Map<string, Entry> };
const store = (g.__loginThrottle ??= new Map<string, Entry>());

/** Test helper only. */
export const __resetLoginThrottle = () => store.clear();

/** Seconds the caller must wait, or 0 if attempts are allowed. */
export function retryAfterSeconds(key: string, now = Date.now()): number {
  const e = store.get(key);
  return e && e.lockedUntil > now ? Math.ceil((e.lockedUntil - now) / 1000) : 0;
}

export function recordFailure(key: string, now = Date.now()) {
  if (store.size > 5000) for (const [k, v] of store) if (v.lockedUntil <= now && now - v.firstAt > WINDOW_MS) store.delete(k);
  let e = store.get(key);
  if (!e || (e.lockedUntil <= now && now - e.firstAt > WINDOW_MS)) e = { failures: 0, firstAt: now, lockedUntil: 0 };
  e.failures += 1;
  if (e.failures >= MAX_FAILURES) e.lockedUntil = now + LOCKOUT_MS;
  store.set(key, e);
}

export const recordSuccess = (key: string) => void store.delete(key);
