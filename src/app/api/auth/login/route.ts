import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { pool } from "../../../../lib/db";
import { json, readJson, sameOrigin } from "../../../../lib/http";
import { maybeCleanupLoginAttempts, recordSuccess, reserveAttempt } from "../../../../lib/loginThrottle";
import {
  assertSessionConfigured, canSignIn, createSessionToken, destinationFor, SESSION_COOKIE,
  sessionCookieOptions, SessionConfigError,
} from "../../../../lib/session";
import { LIMITS, normalizeEmail } from "../../../../lib/validation";
import { BCRYPT_ROUNDS } from "../../../../lib/signup";

export const runtime = "nodejs";

const INVALID = { success: false, error: "INVALID_CREDENTIALS", message: "Incorrect email or password." };

// Compared against when the email is unknown, so "no such user" costs the same time as "wrong password".
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hash("not-a-real-password-" + Math.random(), BCRYPT_ROUNDS));

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ success: false, error: "FORBIDDEN", message: "Request blocked." }, 403);

  try {
    assertSessionConfigured();
  } catch (e) {
    if (e instanceof SessionConfigError) {
      console.error("login: SESSION_SECRET is not configured (min 32 characters)");
      return json({ success: false, error: "SESSION_NOT_CONFIGURED", message: "Sign-in is not available right now." }, 503);
    }
    throw e;
  }

  const parsed = await readJson(req, 4096);
  if ("error" in parsed) return parsed.error;
  const b = (parsed.body ?? {}) as { email?: unknown; password?: unknown; remember?: unknown };

  const fieldErrors: Record<string, string> = {};
  const email = normalizeEmail(b.email);
  if (typeof b.email !== "string" || !b.email.trim()) fieldErrors.email = "Enter your email address.";
  else if (!email) fieldErrors.email = "Enter a valid email address.";
  if (typeof b.password !== "string" || !b.password) fieldErrors.password = "Enter your password.";
  if (Object.keys(fieldErrors).length) {
    return json({ success: false, error: "VALIDATION_FAILED", message: "Please fix the highlighted fields.", fieldErrors }, 400);
  }
  const password = b.password as string;

  try {
    // Count this attempt BEFORE checking the password (cleared again if the password is right), so a burst of
    // parallel requests cannot all be checked before the first failure is recorded.
    const gate = await reserveAttempt(email!);
    if (!gate.allowed) {
      return json(
        { success: false, error: "TOO_MANY_ATTEMPTS", message: "Too many failed attempts. Please try again later.", retryAfterSeconds: gate.retryAfterSeconds },
        429, { "Retry-After": String(gate.retryAfterSeconds) }
      );
    }
    await maybeCleanupLoginAttempts();

    const { rows } = await pool.query(
      "SELECT id, full_name, email, role, password_hash, email_verification FROM users WHERE lower(email) = $1",
      [email]
    );
    const user = rows[0];
    // bcrypt only looks at the first 72 bytes; signup forbids longer passwords, so refuse them here too.
    const tooLong = new TextEncoder().encode(password).length > LIMITS.passwordBytes;
    const matches = await bcrypt.compare(tooLong ? "x" : password, user?.password_hash ?? (await getDummyHash()));

    if (!user || !matches || tooLong) {
      return json(INVALID, 401); // same body whether the account exists or not (the attempt was already counted)
    }
    await recordSuccess(email!); // the password was right: clear the counter
    if (!canSignIn(user.email_verification)) {
      return json({ success: false, error: "EMAIL_NOT_VERIFIED", message: "Please verify your email address before signing in." }, 403);
    }

    const remember = b.remember === true;
    const id = String(user.id);
    const { token, maxAgeSeconds } = createSessionToken({ id, role: user.role }, remember);
    const res = NextResponse.json(
      {
        success: true,
        user: { id, fullName: user.full_name, email: user.email, role: user.role }, // never the hash
        redirectTo: destinationFor(user.role),
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(remember ? maxAgeSeconds : undefined));
    return res;
  } catch {
    console.error("login failed: server error"); // no SQL, email or password in logs
    return json({ success: false, error: "SERVER_ERROR", message: "We could not sign you in. Please try again." }, 500);
  }
}
