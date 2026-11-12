import { pool } from "../../../../../lib/db";
import { originAllowed } from "../../../../../lib/cors";
import { json, readJson } from "../../../../../lib/http";
import { hitRateLimit } from "../../../../../lib/apiRateLimit";
import { clientIp } from "../../../../../lib/projectsRateLimit";
import { EmailConfigError, EmailSendError, sendPasswordResetEmail } from "../../../../../lib/email";
import { normalizeEmail } from "../../../../../lib/validation";
import { appBaseUrl, createResetToken, findAccount, GENERIC_SENT_MESSAGE, NOT_AVAILABLE_MESSAGE, RESET_TOKEN_MINUTES, resetAvailable } from "../../../../../lib/passwordReset";
import { later, tooMany } from "../../../../../lib/resetRoutes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Forgot password": always the SAME answer whether or not the address has an account (no account discovery). Limited per visitor
// address (429) and, silently, per e-mail address (same answer, no mail). The lookup, the token and the mail happen after the answer.
export async function POST(req: Request) {
  if (!originAllowed(req)) return json({ success: false, error: "FORBIDDEN", message: "This request is not allowed." }, 403);
  const parsed = await readJson(req, 1024);
  if ("error" in parsed) return parsed.error;

  const available = await resetAvailable(pool as never, process.env, req.url);
  if (!available.ok) return json({ success: false, error: "RESET_NOT_AVAILABLE", message: NOT_AVAILABLE_MESSAGE }, 503);

  const email = normalizeEmail((parsed.body as { email?: unknown } | null)?.email);
  if (!email) return json({ success: false, error: "INVALID_EMAIL", message: "Enter a valid email address." }, 400);

  const perIp = await hitRateLimit(clientIp(req), "resetIp");
  if (!perIp.allowed) return tooMany(perIp.retryAfterSeconds);

  const base = appBaseUrl(process.env, req.url) as string; // checked by resetAvailable
  later(async () => {
    const perEmail = await hitRateLimit("email:" + email, "resetEmail");
    if (!perEmail.allowed) return; // the visitor already got the same answer; no more mail to this address for now
    const account = await findAccount(pool as never, email);
    if (!account) return;
    const token = await createResetToken(pool as never, account.id);
    try {
      await sendPasswordResetEmail(account.email, `${base}/reset-password#token=${token}`, RESET_TOKEN_MINUTES);
    } catch (e) {
      console.error("password reset: e-mail not sent:", e instanceof EmailSendError ? e.reason : e instanceof EmailConfigError ? "not configured" : "unknown");
    }
  });
  return json({ success: true, message: GENERIC_SENT_MESSAGE });
}
