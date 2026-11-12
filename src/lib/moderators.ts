// Granting and removing the moderator flag (migration 015). This is the ONLY application code that sets users.is_moderator.
//   * Only an administrator can: the caller is checked as an admin here AND by requireAdmin in the route.
//   * Nobody can change their own flag: the database refuses it (trigger in migration 015); this file refuses it first.
//   * Every real change writes one moderator_audit row (ids only, no personal data), made by the database trigger in the
//     same transaction, so a change without an audit row cannot happen through this code.
type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
type Pool = Db & { connect: () => Promise<Db & { release: () => void }> };

export type ModeratorChange = { ok: true; userId: number; moderator: boolean; changed: boolean } | { ok: false; error: "NOT_ADMIN" | "SELF" | "NOT_FOUND" | "BAD_REQUEST" };

/** A user id from a request body: a positive whole number, as a number or a digits-only string. Otherwise null. */
export function parseUserId(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^[0-9]{1,15}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export async function setModerator(pool: Pool, adminId: number, targetId: number, moderator: boolean): Promise<ModeratorChange> {
  if (!Number.isSafeInteger(adminId) || !Number.isSafeInteger(targetId) || typeof moderator !== "boolean") return { ok: false, error: "BAD_REQUEST" };
  if (adminId === targetId) return { ok: false, error: "SELF" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const admin = await client.query("SELECT 1 FROM users WHERE id = $1 AND role = 'admin'", [adminId]);
    if (admin.rows.length === 0) { await client.query("ROLLBACK"); return { ok: false, error: "NOT_ADMIN" }; }
    await client.query("SELECT set_config('rv.admin_id', $1, true)", [String(adminId)]); // for this transaction only; the trigger reads it
    const upd = await client.query("UPDATE users SET is_moderator = $2 WHERE id = $1 AND is_moderator IS DISTINCT FROM $2 RETURNING id", [targetId, moderator]);
    if (upd.rows.length === 0) {
      const exists = await client.query("SELECT 1 FROM users WHERE id = $1", [targetId]);
      await client.query("ROLLBACK");
      return exists.rows.length === 0 ? { ok: false, error: "NOT_FOUND" } : { ok: true, userId: targetId, moderator, changed: false }; // already so: nothing to change, nothing to audit
    }
    await client.query("COMMIT");
    return { ok: true, userId: targetId, moderator, changed: true };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((e as { code?: string })?.code === "23514") return { ok: false, error: "SELF" };
    throw e;
  } finally {
    client.release();
  }
}

/**
 * For the admin Users page: which of these users are moderators. If migration 015 has not been applied yet the column does not
 * exist (PostgreSQL error 42703); the page then simply shows no moderator controls instead of failing.
 */
export async function moderatorFlags(db: Db, userIds: string[]): Promise<{ ready: boolean; flags: Map<string, boolean> }> {
  const flags = new Map<string, boolean>();
  const ids = userIds.map((x) => parseUserId(x)).filter((x): x is number => x !== null);
  if (ids.length === 0) return { ready: true, flags };
  try {
    const { rows } = await db.query("SELECT id, is_moderator FROM users WHERE id = ANY($1::bigint[])", [ids]);
    for (const r of rows) flags.set(String(r.id), r.is_moderator === true);
    return { ready: true, flags };
  } catch (e) {
    if ((e as { code?: string })?.code === "42703") return { ready: false, flags };
    throw e;
  }
}

export type ModeratorChangeRow = { when: string; by: string; person: string; granted: boolean };

/** The last few changes of the flag, for the admin Users page (names only: no email, no id). Empty if migration 015 is not applied. */
export async function recentModeratorChanges(db: Db, limit = 10): Promise<ModeratorChangeRow[]> {
  try {
    const { rows } = await db.query(
      "SELECT a.created_at, a.granted, ad.full_name AS admin_name, tu.full_name AS person_name " +
      "FROM moderator_audit a LEFT JOIN users ad ON ad.id = a.admin_id LEFT JOIN users tu ON tu.id = a.target_user_id " +
      "ORDER BY a.created_at DESC, a.id DESC LIMIT $1",
      [Math.max(1, Math.min(50, Math.floor(limit)))]
    );
    return rows.map((r) => ({ when: new Date(r.created_at).toISOString(), by: r.admin_name ?? "A manual database step", person: r.person_name ?? "A removed account", granted: r.granted === true }));
  } catch (e) {
    if ((e as { code?: string })?.code === "42P01") return [];
    throw e;
  }
}

export type Reviewer = { ok: true; userId: number; isAdmin: boolean; isModerator: boolean; mustChangePassword: boolean } | { ok: false };

/**
 * Who may review contributions: an administrator, or a user whose moderator flag is set (migration 015). Read from the database on
 * every call. FAILS CLOSED: if the flag column does not exist yet (015 not applied) or anything else goes wrong, only a real
 * administrator passes; nobody becomes a reviewer because of an error.
 */
export async function reviewerOf(db: Db, userId: number): Promise<Reviewer> {
  if (!Number.isSafeInteger(userId) || userId <= 0) return { ok: false };
  let row: { role?: string; is_moderator?: boolean; must_change_password?: boolean } | undefined;
  try {
    row = (await db.query("SELECT role, must_change_password, is_moderator FROM users WHERE id = $1", [userId])).rows[0];
  } catch (e) {
    if ((e as { code?: string })?.code !== "42703") return { ok: false }; // anything but "column missing": no access
    try { row = (await db.query("SELECT role, must_change_password FROM users WHERE id = $1", [userId])).rows[0]; } catch { return { ok: false }; }
  }
  if (!row) return { ok: false };
  const isAdmin = row.role === "admin", isModerator = row.is_moderator === true;
  // must_change_password (migration 004): an account made by a seed script must set its own password before reviewing anything
  return isAdmin || isModerator ? { ok: true, userId, isAdmin, isModerator, mustChangePassword: row.must_change_password === true } : { ok: false };
}
