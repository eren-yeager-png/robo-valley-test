// Read-only numbers for the admin Overview, Users and Reports pages. Everything here is counted from the real tables;
// nothing is estimated or invented. A table that does not exist yet (migrations 008 / 009 not applied) is reported as
// "not set up" instead of failing. Callers must already have checked that the viewer is an admin.
import { CATEGORIES } from "./serviceCategories";
import { ROLES } from "./roles";

export type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];
export const DEFAULT_RANGE: RangeDays = 30;

/** Exact match against the allowed values; anything else is the default. */
export function parseRange(raw: unknown): RangeDays {
  const n = typeof raw === "string" && /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
  return (RANGES as readonly number[]).includes(n) ? (n as RangeDays) : DEFAULT_RANGE;
}

export async function tableExists(db: Db, name: string): Promise<boolean> {
  try {
    const { rows } = await db.query("SELECT to_regclass($1) IS NOT NULL AS ok", ["public." + name]);
    return rows[0]?.ok === true;
  } catch {
    return false;
  }
}

export type DayPoint = { day: string; [series: string]: number | string };

/** One value per day for the last `days` days (today included), zero where nothing happened. */
function fillDays(rows: { day: string; [k: string]: unknown }[], days: number, keys: string[], now = new Date()): DayPoint[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: DayPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i)).toISOString().slice(0, 10);
    const row = byDay.get(day);
    const p: DayPoint = { day };
    for (const k of keys) p[k] = Number(row?.[k] ?? 0);
    out.push(p);
  }
  return out;
}

const SINCE = "((now() AT TIME ZONE 'UTC')::date - ($1::int - 1))::timestamp AT TIME ZONE 'UTC'";

/** Accounts created per day. The admin account itself is not a "registration". */
export async function registrationsByDay(db: Db, days: number): Promise<DayPoint[]> {
  const { rows } = await db.query(
    `SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day, count(*)::int AS registrations
       FROM users WHERE role <> 'admin' AND created_at >= ${SINCE} GROUP BY 1`, [days]);
  return fillDays(rows, days, ["registrations"]);
}

export async function loginsByDay(db: Db, days: number): Promise<DayPoint[]> {
  const { rows } = await db.query(
    `SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day,
            count(*) FILTER (WHERE event_type = 'login_success')::int AS success,
            count(*) FILTER (WHERE event_type = 'login_failed')::int AS failed
       FROM login_events WHERE created_at >= ${SINCE} GROUP BY 1`, [days]);
  return fillDays(rows, days, ["success", "failed"]);
}

export async function uploadsByDay(db: Db, days: number): Promise<DayPoint[]> {
  const { rows } = await db.query(
    `SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day,
            count(*) FILTER (WHERE result = 'success')::int AS accepted,
            count(*) FILTER (WHERE result <> 'success')::int AS rejected
       FROM upload_audit_log WHERE action = 'upload' AND created_at >= ${SINCE} GROUP BY 1`, [days]);
  return fillDays(rows, days, ["accepted", "rejected"]);
}

export type CategoryCount = { slug: string; name: string; datasets: number; active: boolean; rows: number };

/** Every fixed category (even with no data), with its dataset count and live row count. */
export async function datasetsByCategory(db: Db): Promise<CategoryCount[]> {
  const { rows } = await db.query(
    `SELECT category,
            count(*) FILTER (WHERE status IN ('active', 'superseded'))::int AS datasets,
            count(*) FILTER (WHERE status = 'active')::int AS active,
            COALESCE(sum(row_count) FILTER (WHERE status = 'active'), 0)::int AS live_rows
       FROM service_datasets GROUP BY category`);
  const m = new Map(rows.map((r) => [r.category, r]));
  return CATEGORIES.map((c) => {
    const r = m.get(c.slug);
    return { slug: c.slug, name: c.name, datasets: Number(r?.datasets ?? 0), active: Number(r?.active ?? 0) > 0, rows: Number(r?.live_rows ?? 0) };
  });
}

export type RecentLogin = { at: string; type: string; reason: string | null };
export type RecentUpload = { at: string; filename: string | null; result: string; by: string | null; kind: string };

export type Overview = {
  users: number;
  categories: number;
  activeCategories: number;
  datasets: number;
  uploads: number;
  setup: { loginEvents: boolean; attachments: boolean };
  recentLogins: RecentLogin[];
  recentUploads: RecentUpload[];
};

export async function getOverview(db: Db): Promise<Overview> {
  const [loginEvents, attachments] = await Promise.all([tableExists(db, "login_events"), tableExists(db, "upload_attachments")]);
  const u = await db.query("SELECT count(*)::int AS n FROM users WHERE role <> 'admin'");
  const d = await db.query("SELECT count(*) FILTER (WHERE status IN ('active', 'superseded'))::int AS total FROM service_datasets");
  const up = await db.query("SELECT count(*)::int AS n FROM upload_audit_log WHERE action = 'upload' AND result = 'success'");
  const perCat = await datasetsByCategory(db);

  let recentLogins: RecentLogin[] = [];
  if (loginEvents) {
    const r = await db.query("SELECT created_at, event_type, reason FROM login_events WHERE event_type IN ('login_success', 'login_failed') ORDER BY created_at DESC, id DESC LIMIT 8");
    recentLogins = r.rows.map((x) => ({ at: new Date(x.created_at).toISOString(), type: x.event_type, reason: x.reason }));
  }
  const kindCol = attachments ? "a.kind" : "'dataset'::text";
  const r = await db.query(
    `SELECT a.created_at, a.filename, a.result, ${kindCol} AS kind, u.email AS uploader
       FROM upload_audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.action = 'upload' ORDER BY a.created_at DESC, a.id DESC LIMIT 8`);
  const recentUploads = r.rows.map((x) => ({ at: new Date(x.created_at).toISOString(), filename: x.filename, result: x.result, by: x.uploader, kind: x.kind }));

  return {
    users: Number(u.rows[0].n),
    categories: CATEGORIES.length,
    activeCategories: perCat.filter((c) => c.active).length,
    datasets: Number(d.rows[0].total),
    uploads: Number(up.rows[0].n),
    setup: { loginEvents, attachments },
    recentLogins,
    recentUploads,
  };
}

// ---- users ---------------------------------------------------------------------------------------------------------
export const USERS_PAGE_SIZE = 25;
export type UserRow = { id: string; name: string; email: string; role: string; roleLabel: string; joined: string };

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

/** Read-only list. Never selects password hashes, tokens, phone numbers or any other private column. */
export async function listUsers(db: Db, opts: { page: number; q?: string; role?: string }): Promise<{ rows: UserRow[]; total: number; page: number; pages: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  const q = opts.q?.trim().slice(0, 100);
  if (q) { params.push("%" + escapeLike(q.toLowerCase()) + "%"); where.push(`(lower(email) LIKE $${params.length} ESCAPE '\\' OR lower(full_name) LIKE $${params.length} ESCAPE '\\')`); }
  if (opts.role) { params.push(opts.role); where.push(`role = $${params.length}`); }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const total = Number((await db.query(`SELECT count(*)::int AS n FROM users ${w}`, params)).rows[0].n);
  const pages = Math.max(1, Math.ceil(total / USERS_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(opts.page) || 1), pages);
  const r = await db.query(
    `SELECT id, full_name, email, role, created_at FROM users ${w} ORDER BY created_at DESC, id DESC LIMIT ${USERS_PAGE_SIZE} OFFSET ${(page - 1) * USERS_PAGE_SIZE}`, params);
  const label = new Map(ROLES.map((x) => [x[0], x[1]]));
  return {
    total, page, pages,
    rows: r.rows.map((x) => ({
      id: String(x.id), name: x.full_name, email: x.email, role: x.role,
      roleLabel: x.role === "admin" ? "Administrator" : label.get(x.role) ?? x.role,
      joined: new Date(x.created_at).toISOString(),
    })),
  };
}

/** Accounts per role, for the Users page summary and the Reports page. */
export async function usersByRole(db: Db): Promise<{ role: string; label: string; count: number }[]> {
  const { rows } = await db.query("SELECT role, count(*)::int AS n FROM users GROUP BY role ORDER BY n DESC, role");
  const label = new Map(ROLES.map((x) => [x[0], x[1]]));
  return rows.map((r) => ({ role: r.role, label: r.role === "admin" ? "Administrator" : label.get(r.role) ?? r.role, count: Number(r.n) }));
}
