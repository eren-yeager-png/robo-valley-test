import { json, readJson } from "../../../../../lib/http";
import { OTP_PURPOSES, OtpError, verifyOtp, type OtpPurpose } from "../../../../../lib/otp";
import { normalizeEmail } from "../../../../../lib/validation";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const parsed = await readJson(req, 1024);
  if ("error" in parsed) return parsed.error;
  const b = (parsed.body ?? {}) as { email?: unknown; purpose?: unknown; code?: unknown };

  const email = normalizeEmail(b.email);
  if (!email) return json({ success: false, error: "INVALID_EMAIL", message: "Enter a valid email address." }, 400);
  if (!OTP_PURPOSES.includes(b.purpose as OtpPurpose)) return json({ success: false, error: "INVALID_PURPOSE", message: "Unsupported purpose." }, 400);
  if (typeof b.code !== "string" || !/^\d{6}$/.test(b.code)) return json({ success: false, error: "INVALID_CODE_FORMAT", message: "Enter all 6 digits." }, 400);

  try {
    const { verificationToken, via } = await verifyOtp(b.purpose as OtpPurpose, email, b.code);
    return json({
      success: true,
      purpose: b.purpose,
      verificationToken,
      ...(via === "mock" ? { mock: true, notice: "Mock verification only. This is not proof of email ownership or guardian consent." } : {}),
    });
  } catch (err) {
    if (err instanceof OtpError) {
      return json(
        { success: false, error: err.code, message: err.code === "OTP_DISABLED" ? "OTP service is not available in this environment." : err.message, retryAfterSeconds: err.retryAfterSeconds, attemptsLeft: err.attemptsLeft },
        err.status
      );
    }
    return json({ success: false, error: "SERVER_ERROR", message: "Could not verify the code." }, 500);
  }
}
