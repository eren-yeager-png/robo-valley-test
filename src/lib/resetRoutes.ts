// Small pieces shared by the two password-reset routes.
import { after } from "next/server";
import { json } from "./http";

/**
 * Runs `fn` after the answer has been sent (Next.js `after`), so a request for an existing account takes as long as one for an unknown
 * address: the e-mail is sent later, and the visitor's answer is identical either way. Outside a request (some tests) it runs at once.
 * Failures are logged as a fixed sentence: never the address, the token or the link.
 */
export function later(fn: () => Promise<void>): void {
  const run = () => fn().catch(() => console.error("password reset: a background step failed"));
  try { after(run); } catch { void run(); }
}

export const tooMany = (retryAfterSeconds: number) => {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return json(
    { success: false, error: "RATE_LIMITED", message: `Too many requests from this device. Please try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`, retryAfter: retryAfterSeconds },
    429, { "Retry-After": String(retryAfterSeconds) });
};
