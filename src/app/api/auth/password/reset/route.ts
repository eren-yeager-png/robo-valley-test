import { pool } from "../../../../../lib/db";
import { originAllowed } from "../../../../../lib/cors";
import { json, readJson } from "../../../../../lib/http";
import { hitRateLimit } from "../../../../../lib/apiRateLimit";
import { clientIp } from "../../../../../lib/projectsRateLimit";
import { EmailConfigError, EmailSendError, sendPasswordChangedEmail } from "../../../../../lib/email";
import { SESSION_COOKIE, sessionCookieOptions } from "../../../../../lib/session";
import { validateNewPassword } from "../../../../../lib/validation";
import { appBaseUrl, NOT_AVAILABLE_MESSAGE, redeemResetToken, resetAvailable } from "../../../../../lib/passwordReset";
import { later, tooMany } from "../../../../../lib/resetRoutes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INVALID = { success: false, error: "INVALID_TOKEN", message: "This reset link is not valid any more. Please ask for a new one." };

// Choose a new password with a reset link's token (sent in the request BODY, never in a URL). The same password rules as sign-up.
// Success: password changed, every older session signed out (users.password_changed_at), all the user's open links closed, a
// "your password was changed" e-mail sent, and this browser's session cookie cleared. Any bad token gets the same answer.
export async function POST(req: Request) {
  if (!originAllowed(req)) return json({ success: false, error: "FORBIDDEN", message: "This request is not allowed." }, 403);
  const parsed = await readJson(req, 4096);
  if ("error" in parsed) return parsed.error;

  const available = await resetAvailable(pool as never, process.env, req.url);
  if (!available.ok) return json({ success: false, error: "RESET_NOT_AVAILABLE", message: NOT_AVAILABLE_MESSAGE }, 503);

  const perIp = await hitRateLimit(clientIp(req), "resetTry");
  if (!perIp.allowed) return tooMany(perIp.retryAfterSeconds);

  const b = (parsed.body ?? {}) as { token?: unknown; password?: unknown; confirmPassword?: unknown };
  const fieldErrors = validateNewPassword(b.password, b.confirmPassword);
  if (Object.keys(fieldErrors).length) return json({ success: false, error: "VALIDATION_FAILED", message: "Please check the new password.", fieldErrors }, 400);

  let result;
  try {
    result = await redeemResetToken(pool as never, b.token, b.password as string);
  } catch {
    console.error("password reset: server error"); // no token, address or SQL in logs
    return json({ success: false, error: "SERVER_ERROR", message: "We could not change the password. Please try again." }, 500);
  }
  if (!result.ok) return json(INVALID, 400);

  const to = result.email, base = appBaseUrl(process.env, req.url) as string;
  later(async () => {
    try { await sendPasswordChangedEmail(to, `${base}/forgot-password`); }
    catch (e) { console.error("password changed: e-mail not sent:", e instanceof EmailSendError ? e.reason : e instanceof EmailConfigError ? "not configured" : "unknown"); }
  });
  const res = json({ success: true, message: "Your password was changed. Sign in with your new password." });
  res.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0)); // this browser's old session is signed out anyway
  return res;
}
