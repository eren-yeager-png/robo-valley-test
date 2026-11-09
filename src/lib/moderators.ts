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

export type Reviewer = { ok: true; userId: number; isAdmin: boolean; isModerator: boolean } | { ok: false };

/**
 * Who may review contributions: an administrator, or a user whose moderator flag is set (migration 015). Read from the database on
 * every call. FAILS CLOSED: if the flag column does not exist yet (015 not applied) or anything else goes wrong, only a real
 * administrator passes; nobody becomes a reviewer because of an error.
 */
export async function reviewerOf(db: Db, userId: number): Promise<Reviewer> {
  if (!Number.isSafeInteger(userId) || userId <= 0) return { ok: false };
  let row: { role?: string; is_moderator?: boolean } | undefined;
  try {
    row = (await db.query("SELECT role, is_moderator FROM users WHERE id = $1", [userId])).rows[0];
  } catch (e) {
    if ((e as { code?: string })?.code !== "42703") return { ok: false }; // anything but "column missing": no access
    try { row = (await db.query("SELECT role FROM users WHERE id = $1", [userId])).rows[0]; } catch { return { ok: false }; }
  }
  if (!row) return { ok: false };
  const isAdmin = row.role === "admin", isModerator = row.is_moderator === true;
  return isAdmin || isModerator ? { ok: true, userId, isAdmin, isModerator } : { ok: false };
}
