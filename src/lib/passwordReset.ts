// Password reset: availability, single-use hashed tokens, and the transaction that changes the password.
//   * Only a SHA-256 hash of the token is stored (migration 020). The token itself exists only in the e-mailed link and is never logged.
//   * The link carries the token in the URL FRAGMENT (#token=...), which browsers never send to any server, log or Referer header.
//   * A token works once, for 45 minutes at most (the database refuses more than 60). Using one token closes ALL the user's open tokens.
//   * A successful reset sets users.password_changed_at, which signs out every older session (see sessionRevoked in session.ts).
//   * Reset is OFF unless it can really work: in production it needs RESEND_API_KEY, a RESEND_FROM_EMAIL that is not Resend's shared test
//     sender, and APP_URL (the app's own address, so a forged Host header can never decide where the link points); everywhere it needs
//     migration 020. When it is off the pages say "Password reset is not available yet."
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { transactionalMailMode } from "./email";
import { BCRYPT_ROUNDS } from "./signup";
import { recordSuccess } from "./loginThrottle";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
type Pool = Db & { connect: () => Promise<Db & { release: () => void }> };

export const RESET_TOKEN_MINUTES = 45;
export const NOT_AVAILABLE_MESSAGE = "Password reset is not available yet.";
export const GENERIC_SENT_MESSAGE = "If an account exists for that email address, we have sent a link to reset the password. It works once and expires in 45 minutes.";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url"); // 43 characters, 256 bits

/** The app's own address for links. Production: APP_URL only (https). Development: APP_URL, else the request's own origin. */
export function appBaseUrl(env: NodeJS.ProcessEnv = process.env, requestUrl?: string): string | null {
  const prod = env.NODE_ENV === "production";
  const raw = env.APP_URL?.trim() || (!prod && requestUrl ? new URL(requestUrl).origin : "");
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && !prod)) return null;
    if (u.username || u.password) return null;
    return u.origin;
  } catch { return null; }
}

/** Configuration only (no database): can mail be sent from a proper sender and do links have a trusted address? */
export function resetConfigured(env: NodeJS.ProcessEnv = process.env, requestUrl?: string): { ok: boolean; reason?: string } {
  const mail = transactionalMailMode(env);
  if (mail.mode === "off") return { ok: false, reason: mail.reason };
  if (!appBaseUrl(env, requestUrl)) return { ok: false, reason: "APP_URL is not set to the app's https address" };
  return { ok: true };
}

/** Configuration AND database: migration 020 (the token table and users.password_changed_at) must be applied. */
export async function resetAvailable(db: Db, env: NodeJS.ProcessEnv = process.env, requestUrl?: string): Promise<{ ok: boolean; reason?: string }> {
  const c = resetConfigured(env, requestUrl);
  if (!c.ok) return c;
  try {
    const { rows } = await db.query(
      "SELECT to_regclass('public.password_reset_tokens') IS NOT NULL AS t, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password_changed_at') AS c");
    return rows[0]?.t === true && rows[0]?.c === true ? { ok: true } : { ok: false, reason: "migration 020 is not applied" };
  } catch { return { ok: false, reason: "the database did not answer" }; }
}

/** The account for an e-mail address, or null. Case-insensitive, like sign-in. */
export async function findAccount(db: Db, email: string): Promise<{ id: string; email: string } | null> {
  const { rows } = await db.query("SELECT id, email FROM users WHERE lower(email) = $1", [email]);
  return rows[0] ? { id: String(rows[0].id), email: rows[0].email } : null;
}

/** Makes a token for the user and stores its hash. Returns the token (for the e-mailed link only). */
export async function createResetToken(db: Db, userId: string, random: () => number = Math.random): Promise<string> {
  const token = newToken();
  await db.query(
    "INSERT INTO password_reset_tokens (user_id, token_hash, created_at, expires_at) VALUES ($1, $2, now(), now() + ($3 || ' minutes')::interval)",
    [userId, hashToken(token), String(RESET_TOKEN_MINUTES)]);
  if (random() < 0.02) await db.query("DELETE FROM password_reset_tokens WHERE ctid IN (SELECT ctid FROM password_reset_tokens WHERE expires_at < now() - interval '1 day' LIMIT 200)").catch(() => undefined);
  return token;
}

export type Redeemed = { ok: true; email: string } | { ok: false };

/**
 * Changes the password for a valid, unused, unexpired token, in ONE transaction: the token row is locked, the password and
 * password_changed_at are written, and ALL the user's open tokens are closed. Any bad token (malformed, unknown, used, expired) gives the
 * same { ok: false }. The password must already have passed validateNewPassword.
 */
export async function redeemResetToken(pool: Pool, token: unknown, newPassword: string): Promise<Redeemed> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return { ok: false };
  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS); // before the transaction, so no lock is held while hashing
  const client = await pool.connect();
  let email: string | null = null;
  try {
    await client.query("BEGIN");
    const t = (await client.query(
      "SELECT id, user_id FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE", [hashToken(token)])).rows[0];
    if (!t) { await client.query("ROLLBACK"); return { ok: false }; }
    const u = (await client.query(
      "UPDATE users SET password_hash = $2, password_changed_at = now(), must_change_password = false WHERE id = $1 RETURNING email", [t.user_id, hash])).rows[0];
    if (!u) { await client.query("ROLLBACK"); return { ok: false }; }
    await client.query("UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [t.user_id]);
    await client.query("COMMIT");
    email = String(u.email);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release(); // released BEFORE any other pool query below, so a small pool can never wait on itself
  }
  await recordSuccess(email.toLowerCase(), pool).catch(() => undefined); // a reset also clears failed-sign-in counts, so they can sign in at once
  return { ok: true, email };
}
