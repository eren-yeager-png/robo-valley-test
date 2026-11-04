// Stateless signed-cookie sessions (HMAC-SHA256). No token is ever stored in localStorage.
// The cookie holds only {sub (user id), role, iat, exp}; the server re-reads the user from the
// database on every protected request (see currentUser.ts), so deleted users lose access.
//
// Trade-off: a stateless token cannot be revoked server-side before it expires (logout only
// clears the cookie). Move to a sessions table if per-session revocation is needed.

import { createHmac, timingSafeEqual } from "node:crypto";
import { validateReturnTo } from "./returnTo";

export const SESSION_COOKIE = "rv_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60; // browser-session cookie, token valid 12 h
export const REMEMBER_TTL_SECONDS = 30 * 24 * 60 * 60; // "Remember me": persistent cookie, 30 days

export class SessionConfigError extends Error {}

export type SessionPayload = { v: 1; sub: string; role: string; iat: number; exp: number; rem: boolean };

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

function secretOf(env: NodeJS.ProcessEnv): string {
  const s = env.SESSION_SECRET;
  if (!s || s.length < 32) throw new SessionConfigError("SESSION_SECRET must be set to at least 32 characters");
  return s;
}
const sign = (data: string, secret: string) => createHmac("sha256", secret).update(data).digest();

/** Throws SessionConfigError if the secret is not configured. */
export const assertSessionConfigured = (env: NodeJS.ProcessEnv = process.env) => void secretOf(env);

export function createSessionToken(
  user: { id: string; role: string }, remember: boolean, now = Date.now(), env: NodeJS.ProcessEnv = process.env
): { token: string; maxAgeSeconds: number } {
  const secret = secretOf(env);
  const ttl = remember ? REMEMBER_TTL_SECONDS : SESSION_TTL_SECONDS;
  const iat = Math.floor(now / 1000);
  const payload: SessionPayload = { v: 1, sub: user.id, role: user.role, iat, exp: iat + ttl, rem: remember };
  const body = b64(JSON.stringify(payload));
  return { token: `${body}.${b64(sign(body, secret))}`, maxAgeSeconds: ttl };
}

/** Returns the payload, or null for anything invalid/expired/tampered/misconfigured. Never throws. */
export function verifySessionToken(token: unknown, now = Date.now(), env: NodeJS.ProcessEnv = process.env): SessionPayload | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const expected = sign(parts[0], secretOf(env));
    const given = Buffer.from(parts[1], "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const p = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as SessionPayload;
    if (p?.v !== 1 || typeof p.sub !== "string" || !/^\d{1,19}$/.test(p.sub) || typeof p.role !== "string") return null;
    if (typeof p.exp !== "number" || p.exp <= Math.floor(now / 1000)) return null;
    return p;
  } catch {
    return null;
  }
}

/** HttpOnly always; Secure in production; SameSite=Lax. Omit maxAge for a browser-session cookie. */
export function sessionCookieOptions(maxAgeSeconds?: number, env: NodeJS.ProcessEnv = process.env) {
  return {
    httpOnly: true as const,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    ...(maxAgeSeconds !== undefined ? { maxAge: maxAgeSeconds } : {}),
  };
}

/**
 * Email-verification policy for signing in. Signup already requires a verified email, so this
 * is defence in depth: 'email' (real code) always passes; 'mock' (test OTP) passes outside
 * production only; anything else (e.g. 'none') is refused.
 */
export function canSignIn(emailVerification: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  if (emailVerification === "email") return true;
  if (emailVerification === "mock") return env.NODE_ENV !== "production";
  return false;
}

/**
 * Where everybody lands after signing in: the normal website (admins included, there is no separate admin dashboard).
 * Configurable with SITE_URL (e.g. http://localhost:8080/ for local WordPress); defaults to the live site.
 */
export function siteUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.SITE_URL?.trim();
  if (raw) {
    try {
      const u = new URL(raw);
      if (u.protocol === "http:" || u.protocol === "https:") return u.href;
    } catch { /* fall through to the default */ }
  }
  return "https://techytree.in/";
}

export const destinationFor = (_role: string, env: NodeJS.ProcessEnv = process.env) => siteUrl(env);

/** The Projects page on the website, the only page "returnTo" may point at. PROJECTS_RETURN_PATH overrides the default. */
export function projectsReturnPath(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.PROJECTS_RETURN_PATH?.trim();
  return raw && /^\/[A-Za-z0-9/_-]*$/.test(raw) && !raw.includes("//") ? (raw.endsWith("/") ? raw : raw + "/") : "/projects/";
}

/**
 * Validates a "returnTo" value from the URL (see returnTo.ts) against the configured site and Projects page. Returns the
 * canonical address to send the visitor to after sign-in, or null (then the caller uses destinationFor, i.e. SITE_URL).
 */
export const resolveReturnTo = (raw: unknown, env: NodeJS.ProcessEnv = process.env): string | null =>
  validateReturnTo(raw, siteUrl(env), projectsReturnPath(env));
