import { EmailConfigError, EmailSendError, sendOtpEmail } from "../../../../../lib/email";
import { logUnexpected, newRequestId } from "../../../../../lib/diagnostics";
import { json, readJson } from "../../../../../lib/http";
import { OTP_PURPOSES, OtpError, requestOtp, type OtpPurpose } from "../../../../../lib/otp";
import { normalizeEmail } from "../../../../../lib/validation";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const parsed = await readJson(req, 1024);
  if ("error" in parsed) return parsed.error;
  const b = (parsed.body ?? {}) as { email?: unknown; purpose?: unknown; studentEmail?: unknown };

  const email = normalizeEmail(b.email);
  if (!email) return json({ success: false, error: "INVALID_EMAIL", message: "Enter a valid email address." }, 400);
  if (!OTP_PURPOSES.includes(b.purpose as OtpPurpose)) return json({ success: false, error: "INVALID_PURPOSE", message: "Unsupported purpose." }, 400);
  const purpose = b.purpose as OtpPurpose;

  if (purpose === "guardian" && normalizeEmail(b.studentEmail) === email) {
    return json({ success: false, error: "SAME_EMAIL", message: "Your parent's email must be different from yours." }, 400);
  }

  try {
    const r = await requestOtp(purpose, email);

    if (r.provider === "resend") {
      try {
        await sendOtpEmail(email, r.code);
      } catch (err) {
        await r.rollback().catch(() => undefined); // a failed send must not consume the cooldown, and no code stays valid
        const requestId = newRequestId();
        if (err instanceof EmailConfigError) {
          console.error("otp.email.failed", JSON.stringify({ requestId, stage: "send-email", reason: "RESEND_API_KEY is not configured" }));
          return json({ success: false, error: "EMAIL_NOT_CONFIGURED", message: "Email service is not configured.", requestId }, 503);
        }
        // reason + Resend's masked explanation only: never the code, the API key or the address
        console.error("otp.email.failed", JSON.stringify({ requestId, stage: "send-email", reason: err instanceof EmailSendError ? err.reason : "unknown", detail: err instanceof EmailSendError ? err.detail : undefined }));
        return json({ success: false, error: "EMAIL_SEND_FAILED", message: "We could not send the email. Please try again later.", requestId }, 502);
      }
      // The code is never part of the response when the provider is Resend.
      return json({ success: true, purpose, provider: "resend", emailSent: true, expiresInSeconds: r.expiresInSeconds, resendAfterSeconds: r.resendAfterSeconds });
    }

    // provider === "mock": development/testing only (getOtpProvider() blocks it in production)
    return json({
      success: true, purpose, provider: "mock", emailSent: false,
      expiresInSeconds: r.expiresInSeconds, resendAfterSeconds: r.resendAfterSeconds,
      mock: true, notice: "MOCK OTP: no email was sent. For local testing only.", devOtp: r.code,
    });
  } catch (err) {
    if (err instanceof OtpError) {
      return json(
        { success: false, error: err.code, message: err.code === "OTP_DISABLED" ? "OTP service is not available in this environment." : err.message, retryAfterSeconds: err.retryAfterSeconds },
        err.status,
        err.retryAfterSeconds ? { "Retry-After": String(err.retryAfterSeconds) } : undefined
      );
    }
    // Unexpected failure while storing the code (database connection, missing table, ...). The client gets a generic
    // message plus a request id; the real cause goes to the server log (safe description only, no secrets).
    const requestId = newRequestId();
    logUnexpected("otp.request.failed", requestId, req, err, { stage: "store-code", purpose });
    return json({ success: false, error: "SERVER_ERROR", message: "Could not send the code.", requestId }, 500);
  }
}
