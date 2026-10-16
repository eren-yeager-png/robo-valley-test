// Server-only: sends the OTP email through Resend. RESEND_API_KEY is read here and nowhere else.
// Never log the code, the API key, or the recipient address.

import { Resend } from "resend";

export const DEFAULT_FROM = "RoboValley <onboarding@resend.dev>"; // Resend's shared dev sender
const SEND_TIMEOUT_MS = 10_000;

export class EmailConfigError extends Error {}
export class EmailSendError extends Error {
  /** A short, non-sensitive reason such as the Resend error name, for server logs. */
  constructor(public reason: string) {
    super("email send failed");
  }
}

export const getFromAddress = (env: NodeJS.ProcessEnv = process.env) => env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM;

export async function sendOtpEmail(to: string, code: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new EmailConfigError("RESEND_API_KEY is not set");

  const minutes = 10;
  const text = `Your RoboValley verification code is ${code}.\n\nIt expires in ${minutes} minutes and can be used once. If you did not ask for it, you can ignore this email.`;
  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:480px;margin:auto;color:#13213b">
<h2 style="color:#14284b">RoboValley verification code</h2>
<p>Use this code to verify your email address:</p>
<p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:16px 0">${code}</p>
<p style="color:#5a6779">It expires in ${minutes} minutes and can be used once. If you did not ask for it, you can ignore this email.</p>
</div>`;

  const resend = new Resend(apiKey);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      resend.emails.send({ from: getFromAddress(env), to, subject: "Your RoboValley verification code", text, html }),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("timeout")), SEND_TIMEOUT_MS); }),
    ]);
    if (result.error) throw new EmailSendError(String(result.error.name ?? "resend_error"));
  } catch (err) {
    if (err instanceof EmailSendError) throw err;
    throw new EmailSendError((err as Error)?.message === "timeout" ? "timeout" : "network_error");
  } finally {
    clearTimeout(timer);
  }
}
