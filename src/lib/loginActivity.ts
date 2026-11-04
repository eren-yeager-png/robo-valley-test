// Read-only login activity for the admin page. Only the fields the table holds: when, what, why, which account, browser family.
import { EVENT_TYPES, REASONS } from "./loginEvents";
import type { Db } from "./adminStats";

export const ACTIVITY_PAGE_SIZE = 25;

export const EVENT_LABEL: Record<string, string> = {
  login_success: "Successful login", login_failed: "Failed login", otp_sent: "OTP sent", otp_failed: "OTP failed",
  otp_verified: "OTP verified", signup: "Signup", logout: "Logout",
};
export const REASON_LABEL: Record<string, string> = {
  bad_credentials: "Wrong email or password", throttled: "Too many attempts", not_verified: "Email not verified", send_failed: "Email could not be sent",
  wrong_code: "Wrong code", expired: "Code expired", locked: "Locked after wrong codes", rate_limited: "Requested too often", server_error: "Server error",
};

export type ActivityRow = { id: string; at: string; type: string; reason: string | null; purpose: string | null; browser: string | null; account: string | null };

const SINCE = "now() - ($1::int || ' days')::interval";

export async function eventCounts(db: Db, days: number): Promise<Record<string, number>> {
  const { rows } = await db.query(`SELECT event_type, count(*)::int AS n FROM login_events WHERE created_at >= ${SINCE} GROUP BY 1`, [days]);
  const out: Record<string, number> = Object.fromEntries(EVENT_TYPES.map((t) => [t, 0]));
  for (const r of rows) out[r.event_type] = Number(r.n);
  return out;
}

export async function listActivity(db: Db, opts: { days: number; type?: string; reason?: string; page: number }): Promise<{ rows: ActivityRow[]; total: number; page: number; pages: number }> {
  const where: string[] = [`e.created_at >= ${SINCE}`];
  const params: unknown[] = [opts.days];
  if (opts.type && (EVENT_TYPES as readonly string[]).includes(opts.type)) { params.push(opts.type); where.push(`e.event_type = $${params.length}`); }
  if (opts.reason && (REASONS as readonly string[]).includes(opts.reason)) { params.push(opts.reason); where.push(`e.reason = $${params.length}`); }
  const w = "WHERE " + where.join(" AND ");
  const total = Number((await db.query(`SELECT count(*)::int AS n FROM login_events e ${w}`, params)).rows[0].n);
  const pages = Math.max(1, Math.ceil(total / ACTIVITY_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(opts.page) || 1), pages);
  const r = await db.query(
    `SELECT e.id, e.created_at, e.event_type, e.reason, e.purpose, e.ua_family, u.email AS account
       FROM login_events e LEFT JOIN users u ON u.id = e.user_id ${w}
      ORDER BY e.created_at DESC, e.id DESC LIMIT ${ACTIVITY_PAGE_SIZE} OFFSET ${(page - 1) * ACTIVITY_PAGE_SIZE}`, params);
  return {
    total, page, pages,
    rows: r.rows.map((x) => ({ id: String(x.id), at: new Date(x.created_at).toISOString(), type: x.event_type, reason: x.reason, purpose: x.purpose, browser: x.ua_family, account: x.account })),
  };
}
