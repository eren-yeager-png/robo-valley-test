import bcrypt from "bcryptjs";
import { pool } from "../../../../lib/db";
import { json, readJson } from "../../../../lib/http";
import { preflight, withCors } from "../../../../lib/cors";
import { guardReviewer } from "../../../../lib/reviewerGuard";
import { BCRYPT_ROUNDS } from "../../../../lib/signup";
import { LIMITS } from "../../../../lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const METHODS = "POST, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);

/**
 * A reviewer replaces their own password (item 4): needed once for an account made by the reviewer seed script, which starts with a
 * temporary password and must_change_password. Reviewers only (the same front door as every reviewing route); the current password
 * is checked; only the caller's own row changes. Nothing about passwords or hashes is ever logged or returned.
 */
export async function POST(req: Request) {
  const g = await guardReviewer(req, METHODS, "modDecision", { passwordChange: true });
  if ("res" in g) return g.res;
  const out = (body: unknown, status: number) => withCors(req, json(body, status), METHODS);

  const parsed = await readJson(req, 4096);
  if ("error" in parsed) return withCors(req, parsed.error, METHODS);
  const b = (parsed.body ?? {}) as { currentPassword?: unknown; newPassword?: unknown };
  if (typeof b.currentPassword !== "string" || !b.currentPassword || typeof b.newPassword !== "string") {
    return out({ success: false, error: "VALIDATION_FAILED", message: "Enter your current and new password." }, 400);
  }
  const next = b.newPassword;
  if (next.length < LIMITS.passwordMin) return out({ success: false, error: "VALIDATION_FAILED", message: "The new password must have at least 8 characters." }, 400);
  if (new TextEncoder().encode(next).length > LIMITS.passwordBytes) return out({ success: false, error: "VALIDATION_FAILED", message: "The new password is too long (max 72 bytes)." }, 400);
  if (next === b.currentPassword) return out({ success: false, error: "VALIDATION_FAILED", message: "Choose a password different from the current one." }, 400);

  try {
    const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [g.userId]);
    const tooLong = new TextEncoder().encode(b.currentPassword).length > LIMITS.passwordBytes;
    if (!rows[0]?.password_hash || tooLong || !(await bcrypt.compare(b.currentPassword, rows[0].password_hash))) {
      return out({ success: false, error: "INVALID_CREDENTIALS", message: "Your current password is not correct." }, 401);
    }
    const hash = await bcrypt.hash(next, BCRYPT_ROUNDS);
    await pool.query("UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1", [g.userId, hash]);
    return out({ success: true }, 200);
  } catch {
    console.error("review change-password failed"); // no SQL, passwords or hashes in logs
    return out({ success: false, error: "SERVER_ERROR", message: "We could not change your password. Please try again." }, 500);
  }
}
