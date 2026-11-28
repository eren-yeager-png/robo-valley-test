// Contribution Portal (migration 030): the Audit Log's writer, and the small helpers that let the same code run on a database with or
// without 030.
//   * audit()   one row in audit_log: who (id, name, role), what (action), to what (target type and id), details (meta), when (now).
//               Inside a transaction (inTx) it uses a savepoint, so a database without 030 (no audit_log yet) skips the row and the
//               change itself still commits, as before 030. Any other error is thrown: an action is never half-logged silently.
//   * optional() an UPDATE of a column 030 adds (who approved, the rejection reason, ...): skipped the same way when the column is not
//               there yet. The same facts are recorded where they always were (history, versions, feedback, decisions).
//   * portalReady() is 030 applied? (the Approved step, the new field columns, suggestions as records, the Audit Log table)
// Never logs personal data to the server log; the rows themselves are for administrators only.
type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
export type AuditRole = "admin" | "moderator" | "contributor" | "plugin" | "system";
export type AuditEntry = {
  actorId: number | null; actorName: string; role: AuditRole; action: string; targetType: string; targetId: number | null; meta?: Record<string, unknown>;
};

const code = (e: unknown) => (e as { code?: string } | null)?.code ?? "";
/** 42P01 = no such table, 42703 = no such column: migration 030 has not been applied. */
export const missing030 = (e: unknown) => ["42P01", "42703"].includes(code(e));
const ACTION = /^[a-z][a-z_]{1,39}$/;

/** The role an audit row names for a reviewer. */
export const reviewerRole = (isAdmin: boolean): AuditRole => (isAdmin ? "admin" : "moderator");

async function guardedTx<T>(db: Db, inTx: boolean, fn: () => Promise<T>): Promise<T | null> {
  if (!inTx) {
    try { return await fn(); } catch (e) { if (missing030(e)) return null; throw e; }
  }
  await db.query("SAVEPOINT rv_portal_optional");
  try {
    const r = await fn();
    await db.query("RELEASE SAVEPOINT rv_portal_optional");
    return r;
  } catch (e) {
    await db.query("ROLLBACK TO SAVEPOINT rv_portal_optional");
    await db.query("RELEASE SAVEPOINT rv_portal_optional");
    if (missing030(e)) return null;
    throw e;
  }
}

/** Writes one audit row. Returns false when the database has no audit_log yet (030 not applied); throws on any other error. */
export async function audit(db: Db, e: AuditEntry, inTx = false): Promise<boolean> {
  if (!ACTION.test(e.action) || !ACTION.test(e.targetType)) throw new Error("audit: bad action or target type");
  const meta = JSON.stringify(e.meta ?? {});
  const r = await guardedTx(db, inTx, () => db.query(
    "INSERT INTO audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, meta) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)",
    [e.actorId, String(e.actorName ?? "").slice(0, 150), e.role, e.action, e.targetType, e.targetId, meta]));
  return r !== null;
}

/** Runs one statement that needs migration 030; skipped (false) when the table or column is not there yet. */
export async function optional(db: Db, sql: string, params: unknown[], inTx = false): Promise<boolean> {
  return (await guardedTx(db, inTx, () => db.query(sql, params))) !== null;
}

/** Is migration 030 applied? Read from the catalog on every call (a migration can be applied while the application runs). */
export async function portalReady(db: Db): Promise<boolean> {
  try {
    const { rows } = await db.query(
      "SELECT to_regclass('audit_log') IS NOT NULL AND to_regclass('field_suggestions') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_constraint " +
      "WHERE conrelid = to_regclass('cw_contributions') AND conname = 'cw_contributions_status_ck' AND pg_get_constraintdef(oid) LIKE '%''approved''%') AS ready");
    return rows[0]?.ready === true;
  } catch {
    return false;
  }
}
