// Best-effort activity log for the admin "Login Activity" page (table login_events, migration 008).
//
// PRIVACY: a row only says what happened, when, and to which account. It never holds an IP address, an e-mail address
// that was typed in, a password, an OTP, a token or free text; `reason`, `purpose` and `ua_family` can only be the short
// fixed codes below (the database enforces the same lists).
//
// SAFETY: recording must never change what the user experiences. recordLoginEvent never throws, gives up after a short
// time if the database is slow, and does nothing (quietly) while the table does not exist yet.
import { SESSION_COOKIE, verifySessionToken } from "./session";

export const EVENT_TYPES = ["login_success", "login_failed", "otp_sent", "otp_failed", "otp_verified", "signup", "logout"] as const;
export type LoginEventType = (typeof EVENT_TYPES)[number];
export const REASONS = ["bad_credentials", "throttled", "not_verified", "send_failed", "wrong_code", "expired", "locked", "rate_limited", "server_error"] as const;
export type LoginReason = (typeof REASONS)[number];
const PURPOSES = ["signup", "guardian"] as const;
const UA = ["chrome", "safari", "firefox", "edge", "other"] as const;
export type UaFamily = (typeof UA)[number];

export const RETENTION_DAYS = 180;
const RECORD_TIMEOUT_MS = 1500;

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

/** Browser family only (never the full user-agent string). */
export function uaFamily(ua: string | null | undefined): UaFamily {
  const s = (ua ?? "").slice(0, 400);
  if (/\b(Edg|EdgA|EdgiOS|Edge)\//.test(s)) return "edge";
  if (/\b(Firefox|FxiOS)\//.test(s)) return "firefox";
  if (/\b(Chrome|CriOS|Chromium)\//.test(s)) return "chrome";
  if (/\bSafari\//.test(s) && /\bVersion\//.test(s)) return "safari";
  return "other";
}

/** Maps an OtpError code (from src/lib/otp.ts) to one of the fixed reasons. */
export function otpReason(code: unknown): LoginReason {
  switch (code) {
    case "OTP_INVALID": case "OTP_NOT_FOUND": return "wrong_code";
    case "OTP_EXPIRED": return "expired";
    case "OTP_LOCKED": return "locked";
    case "RESEND_COOLDOWN": case "TOO_MANY_REQUESTS": return "rate_limited";
    default: return "server_error";
  }
}

let warned = false;

export async function recordLoginEvent(
  db: Db,
  e: { type: LoginEventType; userId?: string | number | null; reason?: LoginReason | null; purpose?: string | null; req?: Request | null }
): Promise<void> {
  try {
    if (!EVENT_TYPES.includes(e.type)) return;
    // Only values the table allows for this event type; anything else is dropped rather than risking a failed insert.
    const reason = e.reason && REASONS.includes(e.reason) && (e.type === "login_failed" || e.type === "otp_failed") ? e.reason : null;
    const purpose = e.purpose && (PURPOSES as readonly string[]).includes(e.purpose) && e.type.startsWith("otp_") ? e.purpose : null;
    const userId = e.userId !== null && e.userId !== undefined && /^\d{1,18}$/.test(String(e.userId)) ? String(e.userId) : null;
    const ua = uaFamily(e.req?.headers.get("user-agent"));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, RECORD_TIMEOUT_MS); });
    const write = db.query(
      "INSERT INTO login_events (event_type, user_id, reason, purpose, ua_family) VALUES ($1, $2, $3, $4, $5)",
      [e.type, userId, reason, purpose, ua]
    ).then(() => undefined, (err: { code?: string }) => {
      if (!warned) { warned = true; console.error("login events: could not record (", typeof err?.code === "string" ? err.code : "error", ")"); } // once per process, no values
    });
    await Promise.race([write, timeout]);
    clearTimeout(timer);
  } catch {
    /* never let the activity log affect sign-in, OTP, signup or sign-out */
  }
}

/** The signed-in account id from the request's session cookie (signature checked), or null. Used by logout. */
export function sessionUserId(req: Request): string | null {
  try {
    const cookie = req.headers.get("cookie") ?? "";
    const m = cookie.split(/;\s*/).find((c) => c.startsWith(SESSION_COOKIE + "="));
    if (!m) return null;
    const payload = verifySessionToken(decodeURIComponent(m.slice(SESSION_COOKIE.length + 1)));
    return payload ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Deletes events older than the retention period. Returns how many were removed, or null when the table does not exist. */
export async function purgeOldLoginEvents(db: Db): Promise<number | null> {
  const ex = await db.query("SELECT to_regclass('public.login_events') IS NOT NULL AS ok");
  if (ex.rows[0]?.ok !== true) return null;
  const r = await db.query("DELETE FROM login_events WHERE created_at < now() - ($1 || ' days')::interval", [String(RETENTION_DAYS)]);
  return r.rowCount ?? 0;
}
