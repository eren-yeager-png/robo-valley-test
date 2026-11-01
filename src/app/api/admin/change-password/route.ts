import bcrypt from "bcryptjs";
import { requireAdmin } from "../../../../lib/admin";
import { pool } from "../../../../lib/db";
import { json, readJson } from "../../../../lib/http";
import { BCRYPT_ROUNDS } from "../../../../lib/signup";
import { LIMITS } from "../../../../lib/validation";

export const runtime = "nodejs";

// Lets a signed-in admin replace their password (used for the first sign-in after the seed script created the account).
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;

  const parsed = await readJson(req, 4096);
  if ("error" in parsed) return parsed.error;
  const b = (parsed.body ?? {}) as { currentPassword?: unknown; newPassword?: unknown };
  if (typeof b.currentPassword !== "string" || !b.currentPassword || typeof b.newPassword !== "string") {
    return json({ success: false, error: "VALIDATION_FAILED", message: "Enter your current and new password." }, 400);
  }
  const next = b.newPassword;
  if (next.length < LIMITS.passwordMin) return json({ success: false, error: "VALIDATION_FAILED", message: "The new password must have at least 8 characters." }, 400);
  if (new TextEncoder().encode(next).length > LIMITS.passwordBytes) return json({ success: false, error: "VALIDATION_FAILED", message: "The new password is too long (max 72 bytes)." }, 400);
  if (next === b.currentPassword) return json({ success: false, error: "VALIDATION_FAILED", message: "Choose a password different from the current one." }, 400);

  try {
    const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = $1 AND role = 'admin'", [auth.admin.id]);
    const tooLong = new TextEncoder().encode(b.currentPassword).length > LIMITS.passwordBytes;
    if (!rows[0] || tooLong || !(await bcrypt.compare(b.currentPassword, rows[0].password_hash))) {
      return json({ success: false, error: "INVALID_CREDENTIALS", message: "Your current password is not correct." }, 401);
    }
    const hash = await bcrypt.hash(next, BCRYPT_ROUNDS);
    await pool.query("UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1 AND role = 'admin'", [auth.admin.id, hash]);
    return json({ success: true });
  } catch {
    console.error("admin change-password failed"); // no SQL, passwords or hashes in logs
    return json({ success: false, error: "SERVER_ERROR", message: "We could not change your password. Please try again." }, 500);
  }
}
