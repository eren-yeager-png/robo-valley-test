// Contribution Portal (migration 030): suggested fields as their own records (field_suggestions).
//   * A member suggests a field with Share Your Idea: kind "Suggestion" about the page "Robots by Sector › <Sector>". Sending it also
//     records the suggestion (pending), in the same transaction (recordSuggestion). 030's backfill recorded the earlier ones.
//   * Only an Admin approves or rejects one (approveFieldSuggestion is Admin only: the route calls requireAdmin, and this file checks
//     the role again). Approving adds the field to the sector at once with the source "member" ("Suggested by member"); "Edit &
//     approve" changes the name, link code or description first (edited_by). Rejecting needs a reason. Each decision is one transaction
//     with its Audit Log row. The member's idea keeps its own review in Moderation (a suggestion is not a publication).
//   * Before 030 there are no records: the routes answer NOT_SET_UP and Sector Forms shows the suggestions worked out from the ideas.
import { audit } from "./portalAudit";
import { cleanDescription, cleanRobotName, insertSuggestedField, slugFor } from "./sectorForms";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
type Pool = Db & { connect: () => Promise<Db & { release: () => void }> };
export type Fail = { ok: false; status: number; error: string; message: string };
const fail = (status: number, error: string, message: string): Fail => ({ ok: false, status, error, message });
const code = (e: unknown) => (e as { code?: string } | null)?.code ?? "";
const missing = (e: unknown) => ["42P01", "42703"].includes(code(e));
const NOT_SET_UP = (): Fail => fail(503, "NOT_SET_UP", "Suggested fields are not set up on this database yet (migration 030 is needed).");
export const SUGGEST_PREFIX = "Robots by Sector › ";
export const REASON_MAX = 2000;

export type FieldSuggestion = {
  id: number; sector: string; name: string; slug: string; reason: string; by: string; sentAt: string | null; status: "pending" | "approved" | "rejected";
  rejectReason: string | null; fieldId: number | null; ideaCode: string | null;
};
const toSuggestion = (r: any): FieldSuggestion => ({
  id: Number(r.id), sector: String(r.sector_slug ?? ""), name: String(r.name), slug: String(r.slug), reason: String(r.description ?? ""),
  by: String(r.suggested_by_name ?? ""), sentAt: r.sent_at ? new Date(r.sent_at).toISOString() : null, status: r.status,
  rejectReason: r.reject_reason ?? null, fieldId: r.field_id === null || r.field_id === undefined ? null : Number(r.field_id),
  ideaCode: r.contribution_id ? `RV-${r.contribution_id}` : null,
});

/** The suggestions of one sector (by id) with this status, newest first. null = 030 is not applied (no records yet). */
export async function sectorSuggestions(db: Db, sectorId: number, status: "pending" | "approved" | "rejected" = "pending"): Promise<FieldSuggestion[] | null> {
  try {
    const { rows } = await db.query(
      "SELECT f.*, s.slug AS sector_slug FROM field_suggestions f JOIN sectors s ON s.id = f.sector_id WHERE f.sector_id = $1 AND f.status = $2 ORDER BY f.sent_at DESC, f.id DESC",
      [sectorId, status]);
    return rows.map(toSuggestion);
  } catch (e) {
    if (missing(e)) return null;
    throw e;
  }
}
/** How many suggestions wait in each sector (sector id -> n). null = 030 is not applied. */
export async function pendingCounts(db: Db): Promise<Map<number, number> | null> {
  try {
    const { rows } = await db.query("SELECT sector_id, count(*)::int AS n FROM field_suggestions WHERE status = 'pending' GROUP BY sector_id");
    return new Map(rows.map((r) => [Number(r.sector_id), Number(r.n)]));
  } catch (e) {
    if (missing(e)) return null;
    throw e;
  }
}

/**
 * Inside the transaction that creates a Share Your Idea idea: when it is a "Suggestion" about "Robots by Sector › <Sector>", records it
 * as a pending suggestion of that sector (once per idea). Skipped quietly before 030 (a savepoint keeps the idea's own transaction
 * healthy) and when the page names no known sector.
 */
export async function recordSuggestion(c: Db, idea: { id: number; userId: number; name: string; kind: string; path: string; title: string; description: string }): Promise<boolean> {
  if (idea.kind !== "Suggestion" || !idea.path.startsWith(SUGGEST_PREFIX)) return false;
  const sectorName = idea.path.slice(SUGGEST_PREFIX.length).trim();
  const name = idea.title.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!sectorName || [...name].length < 2) return false;
  await c.query("SAVEPOINT rv_field_suggestion");
  try {
    const { rows } = await c.query(
      "INSERT INTO field_suggestions (sector_id, name, slug, description, suggested_by, suggested_by_name, contribution_id) " +
      "SELECT s.id, $2, $3, $4, $5, $6, $1 FROM sectors s WHERE lower(s.name) = lower($7) AND NOT s.is_demo ORDER BY s.id LIMIT 1 " +
      "ON CONFLICT (contribution_id) WHERE contribution_id IS NOT NULL DO NOTHING RETURNING id",
      [idea.id, name, slugFor(name), idea.description.slice(0, REASON_MAX), idea.userId, idea.name.slice(0, 150), sectorName]);
    await c.query("RELEASE SAVEPOINT rv_field_suggestion");
    return rows.length > 0;
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT rv_field_suggestion");
    await c.query("RELEASE SAVEPOINT rv_field_suggestion");
    if (missing(e)) return false;
    throw e;
  }
}

export type Decision = { action: "approve"; name?: unknown; slug?: unknown; description?: unknown } | { action: "reject"; reason?: unknown };

/** Reads a decision from a request body, or null. */
export function parseDecision(b: unknown): Decision | null {
  if (!b || typeof b !== "object" || Array.isArray(b)) return null;
  const o = b as Record<string, unknown>;
  if (o.action === "approve") return { action: "approve", name: o.name, slug: o.slug, description: o.description };
  if (o.action === "reject") return { action: "reject", reason: o.reason };
  return null;
}

/**
 * Approves (adding the field, source "member") or rejects (with the reason) one pending suggestion. Admins only. One transaction with
 * its Audit Log row. Returns the suggestion and, for an approval, the new field's id.
 */
export async function decideSuggestion(pool: Pool, admin: { id: number; name: string }, id: number, d: Decision):
  Promise<{ ok: true; suggestion: FieldSuggestion; fieldId: number | null; message: string } | Fail> {
  let reason = "";
  if (d.action === "reject") {
    reason = typeof d.reason === "string" ? d.reason.replace(/\s+/g, " ").trim() : "";
    if (!reason) return fail(400, "VALIDATION_FAILED", "Write the reason for rejecting this suggestion.");
    if (reason.length > REASON_MAX) return fail(400, "VALIDATION_FAILED", `The reason can have up to ${REASON_MAX} characters.`);
  }
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const a = (await c.query("SELECT 1 FROM users WHERE id = $1 AND role = 'admin'", [admin.id])).rows[0];
    if (!a) { await c.query("ROLLBACK"); return fail(403, "ADMIN_ONLY", "Only an administrator can approve or reject a suggested field."); }
    const sg = (await c.query("SELECT f.*, s.slug AS sector_slug FROM field_suggestions f JOIN sectors s ON s.id = f.sector_id WHERE f.id = $1 FOR UPDATE OF f", [id])).rows[0];
    if (!sg) { await c.query("ROLLBACK"); return fail(404, "NOT_FOUND", "We could not find that suggestion."); }
    if (sg.status !== "pending") { await c.query("ROLLBACK"); return fail(409, "ALREADY_DECIDED", `This suggestion was already ${sg.status}. Reload the page.`); }
    if (d.action === "reject") {
      await c.query("UPDATE field_suggestions SET status = 'rejected', reject_reason = $2, decided_by = $3, decided_at = now() WHERE id = $1", [id, reason, admin.id]);
      await audit(c, { actorId: admin.id, actorName: admin.name, role: "admin", action: "suggestion_reject", targetType: "field_suggestion", targetId: id,
        meta: { sector: sg.sector_slug, name: sg.name, reason } }, true);
      await c.query("COMMIT");
      const out = (await c.query("SELECT f.*, s.slug AS sector_slug FROM field_suggestions f JOIN sectors s ON s.id = f.sector_id WHERE f.id = $1", [id])).rows[0];
      return { ok: true, suggestion: toSuggestion(out), fieldId: null, message: `Rejected "${sg.name}". The member's idea keeps its own review.` };
    }
    // approve (as suggested, or edited first)
    const nm = cleanRobotName(d.name === undefined ? sg.name : d.name);
    if ("error" in nm) { await c.query("ROLLBACK"); return fail(400, "VALIDATION_FAILED", nm.error); }
    const desc = cleanDescription(d.description === undefined ? sg.description : d.description);
    if ("error" in desc) { await c.query("ROLLBACK"); return fail(400, "VALIDATION_FAILED", desc.error); }
    const added = await insertSuggestedField(c, { sectorId: Number(sg.sector_id), name: nm.name, slug: d.slug, description: desc.description, adminId: admin.id });
    if ("error" in added) { await c.query("ROLLBACK"); return added; }
    const field = added.id, slug = added.slug;
    const edited = nm.name !== sg.name || desc.description !== String(sg.description ?? "") || (d.slug !== undefined && d.slug !== "" && slug !== sg.slug);
    await c.query("UPDATE field_suggestions SET status = 'approved', field_id = $2, decided_by = $3, decided_at = now(), edited_by = CASE WHEN $4::boolean THEN $3 ELSE edited_by END WHERE id = $1",
      [id, field, admin.id, edited]);
    await audit(c, { actorId: admin.id, actorName: admin.name, role: "admin", action: "suggestion_approve", targetType: "field_suggestion", targetId: id,
      meta: { sector: sg.sector_slug, suggested: sg.name, name: nm.name, slug, field, edited } }, true);
    await c.query("COMMIT");
    // read back on the same connection (it is released only below)
    const out = (await c.query("SELECT f.*, s.slug AS sector_slug FROM field_suggestions f JOIN sectors s ON s.id = f.sector_id WHERE f.id = $1", [id])).rows[0];
    return { ok: true, suggestion: toSuggestion(out), fieldId: field, message: `"${nm.name}" was added to the sector's fields with the "Suggested by member" badge.` };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    if (missing(e)) return NOT_SET_UP();
    if (code(e) === "23505") return fail(409, "CONFLICT", "Someone changed this sector's fields at the same time. Please try again.");
    throw e;
  } finally {
    c.release();
  }
}
