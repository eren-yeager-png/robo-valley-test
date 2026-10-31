import { EmailConfigError, EmailSendError, sendOtpEmail } from "../../../../../lib/email";
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
        if (err instanceof EmailConfigError) {
          console.error("otp email: RESEND_API_KEY is not configured");
          return json({ success: false, error: "EMAIL_NOT_CONFIGURED", message: "Email service is not configured." }, 503);
        }
        console.error("otp email: send failed:", err instanceof EmailSendError ? err.reason : "unknown"); // reason only: no code, key or address
        return json({ success: false, error: "EMAIL_SEND_FAILED", message: "We could not send the email. Please try again later." }, 502);
      }
      // The code is never part of the response when the provider is Resend.
      return json({ success: true, purpose, provider: "resend", emailSent: true, expiresInSeconds: r.expiresInSeconds, resendAfterSeconds: r.resendAfterSeconds });
    }

    // provider === "mock": development/testing only (getOtpProvider() blocks it in production)
    console.log(`MOCK OTP (${purpose}): ${r.code} - no email was sent`); // so the code can be read from the dev terminal; mock never runs in production
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
    // Not an OtpError, so the code could not be stored: a database failure. Log only the error class/code, never the SQL, email or code.
    const e = err as { code?: unknown; name?: unknown };
    console.error("otp request failed (database):", typeof e?.code === "string" ? e.code : typeof e?.name === "string" ? e.name : "unknown");
    return json({ success: false, error: "SERVER_ERROR", message: "We couldn't send the code right now. Please try again in a moment." }, 500);
  }
}
