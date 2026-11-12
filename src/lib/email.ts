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

// ---- Transactional mail (password reset and "your password was changed") ----
// The OTP mail above keeps its old behaviour. These two never use Resend's shared test sender in production: if the real sender is
// not configured, sending is OFF (callers then say "not available yet") instead of falling back to onboarding@resend.dev.
export type MailMode = { mode: "resend"; apiKey: string; from: string } | { mode: "mock" } | { mode: "off"; reason: string };
export const isSharedTestSender = (from: string) => /@resend\.dev\b/i.test(from);

export function transactionalMailMode(env: NodeJS.ProcessEnv = process.env): MailMode {
  const apiKey = env.RESEND_API_KEY?.trim(), from = env.RESEND_FROM_EMAIL?.trim();
  if (env.NODE_ENV === "production") {
    if (!apiKey) return { mode: "off", reason: "RESEND_API_KEY is not set" };
    if (!from) return { mode: "off", reason: "RESEND_FROM_EMAIL is not set" };
    if (isSharedTestSender(from)) return { mode: "off", reason: "RESEND_FROM_EMAIL is Resend's shared test sender" };
    return { mode: "resend", apiKey, from };
  }
  return apiKey && from ? { mode: "resend", apiKey, from } : { mode: "mock" }; // development: nothing is sent without a real key and sender
}

async function sendTransactional(to: string, subject: string, text: string, html: string, env: NodeJS.ProcessEnv): Promise<"sent" | "mock"> {
  const mode = transactionalMailMode(env);
  if (mode.mode === "off") throw new EmailConfigError(mode.reason);
  if (mode.mode === "mock") return "mock";
  const resend = new Resend(mode.apiKey);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      resend.emails.send({ from: mode.from, to, subject, text, html }),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("timeout")), SEND_TIMEOUT_MS); }),
    ]);
    if (result.error) throw new EmailSendError(String(result.error.name ?? "resend_error"));
    return "sent";
  } catch (err) {
    if (err instanceof EmailSendError) throw err;
    throw new EmailSendError((err as Error)?.message === "timeout" ? "timeout" : "network_error");
  } finally {
    clearTimeout(timer);
  }
}

const shell = (inner: string) => `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:480px;margin:auto;color:#13213b">${inner}</div>`;

/** `link` is built by the server from the configured app address and a fresh token; it is never logged. */
export function sendPasswordResetEmail(to: string, link: string, minutes: number, env: NodeJS.ProcessEnv = process.env) {
  const text = `Someone asked to reset the password of your RoboValley account.\n\nOpen this link to choose a new password (it works once and expires in ${minutes} minutes):\n${link}\n\nIf you did not ask for this, you can ignore this email: your password stays as it is.`;
  const html = shell(`<h2 style="color:#14284b">Reset your RoboValley password</h2><p>Someone asked to reset the password of your account.</p><p><a href="${link}" style="display:inline-block;background:#17694f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">Choose a new password</a></p><p style="color:#5a6779">The link works once and expires in ${minutes} minutes. If you did not ask for this, ignore this email: your password stays as it is.</p>`);
  return sendTransactional(to, "Reset your RoboValley password", text, html, env);
}

export function sendPasswordChangedEmail(to: string, forgotUrl: string, env: NodeJS.ProcessEnv = process.env) {
  const text = `The password of your RoboValley account was just changed, and you were signed out everywhere.\n\nIf this was you, there is nothing more to do.\nIf it was not you, reset your password again now: ${forgotUrl}`;
  const html = shell(`<h2 style="color:#14284b">Your RoboValley password was changed</h2><p>You were signed out everywhere. If this was you, there is nothing more to do.</p><p>If it was <b>not</b> you, <a href="${forgotUrl}">reset your password again now</a>.</p>`);
  return sendTransactional(to, "Your RoboValley password was changed", text, html, env);
}
