// Contribution Portal: the Audit Log (administrators), from what the database records today (Phase A adds no table):
//   * every line of every Share Your Idea idea's history (cw_contribution_history, migration 027): submitted, opened, draft, approved
//     and sent to an Admin, declined, previewed, edited, published, publish failed, unpublished, reopened, changes asked, rejected;
//   * every decision on an item sent with the current form (contribution_reviews, migrations 017-019): verified, approved and published,
//     changes asked, rejected, removed, unpublished, published again;
//   * the moderator flag changes (Users & Roles, migration 015).
// Who did it and in which role (Admin, Moderator, Contributor). Field changes and plugin events are written from the data update on.
import { recentModeratorChanges } from "./moderators";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
export type AuditRow = { at: string; actor: string; role: string; action: string; actionLabel: string; target: string; details: string };
export const AUDIT_ACTIONS: [string, string][] = [
  ["submitted", "Submitted"], ["opened", "Opened for review"], ["draft", "Draft saved"], ["approved", "Approved"], ["edited", "Edited"],
  ["previewed", "Previewed"], ["published", "Published"], ["failed", "Publish failed"], ["unpublished", "Unpublished"], ["sent_back", "Sent back"],
  ["rejected", "Rejected"], ["reopened", "Reopened"], ["removed", "Removed"], ["roles", "Role changed"], ["other", "Other"],
];
const LABEL = new Map(AUDIT_ACTIONS);
export const AUDIT_PAGE = 50;
const CAP = 3000;
const missing = (e: unknown) => ["42P01", "42703"].includes((e as { code?: string } | null)?.code ?? "");
const iso = (v: unknown) => new Date(v as string).toISOString();

/** The kind of a history line, from its fixed wording (public/cw/js/rules.js: history). */
export function historyAction(text: string): string {
  const t = String(text);
  if (/^Submitted through the contribution form/.test(t)) return "submitted";
  if (/^Opened the contribution/.test(t)) return "opened";
  if (/^(Saved a draft|Reset the working version)/.test(t)) return "draft";
  if (/^(Submitted|Resubmitted) publishing request/.test(t)) return "approved";
  if (/^Opened the publish preview/.test(t)) return "previewed";
  if (/^Edited the proposed content/.test(t)) return "edited";
  if (/^(Published v|Clicked Publish)/.test(t)) return "published";
  if (/^Publication FAILED/.test(t)) return "failed";
  if (/^Unpublished/.test(t)) return "unpublished";
  if (/^Requested changes/.test(t)) return "sent_back";
  if (/^(Declined the idea|Rejected the publishing request)/.test(t)) return "rejected";
  if (/^Reopened/.test(t)) return "reopened";
  return "other";
}
const DECISION: Record<string, string> = { verify: "approved", approve: "published", request_changes: "sent_back", reject: "rejected", remove: "removed", unpublish: "unpublished", republish: "published" };
const DECISION_WORDS: Record<string, string> = { verify: "Verified (approved for an Admin)", approve: "Approved and published", request_changes: "Asked the contributor for changes", reject: "Not accepted", remove: "Removed", unpublish: "Unpublished", republish: "Published again" };

/** One page of the log, newest first. `action` filters by kind, `q` searches who, what and the item. */
export async function auditLog(db: Db, o: { page?: number; action?: string; q?: string } = {}) {
  const rows: AuditRow[] = [];
  try {
    const { rows: h } = await db.query(
      "SELECT h.created_at, h.actor, h.text, h.contribution_id, c.proposed->>'title' AS title, u.role AS actor_role, (h.actor_user_id IS NOT NULL AND h.actor_user_id = c.user_id) AS own " +
      `FROM cw_contribution_history h JOIN cw_contributions c ON c.id = h.contribution_id LEFT JOIN users u ON u.id = h.actor_user_id ORDER BY h.created_at DESC, h.id DESC LIMIT ${CAP}`);
    for (const r of h) {
      const action = historyAction(r.text);
      rows.push({ at: iso(r.created_at), actor: String(r.actor).replace(/\s*\([^)]*\)\s*$/, ""), role: r.own ? "Contributor" : r.actor_role === "admin" ? "Admin" : "Moderator",
        action, actionLabel: LABEL.get(action) ?? "Other", target: `RV-${r.contribution_id} · ${r.title ?? ""}`, details: String(r.text) });
    }
  } catch (e) { if (!missing(e)) throw e; }
  try {
    const { rows: d } = await db.query(
      "SELECT r.created_at, r.action, r.note, r.contribution_id, c.title, u.full_name, u.role FROM contribution_reviews r JOIN contributions c ON c.id = r.contribution_id " +
      `LEFT JOIN users u ON u.id = r.reviewer_id WHERE NOT c.is_demo ORDER BY r.created_at DESC, r.id DESC LIMIT ${CAP}`);
    for (const r of d) {
      const action = DECISION[r.action] ?? "other";
      rows.push({ at: iso(r.created_at), actor: String(r.full_name ?? "A former reviewer").split(/\s+/)[0] ?? "", role: r.role === "admin" ? "Admin" : "Moderator",
        action, actionLabel: LABEL.get(action) ?? "Other", target: `C-${r.contribution_id} · ${r.title ?? ""}`, details: `${DECISION_WORDS[r.action] ?? r.action}${r.note ? `. Note: ${r.note}` : ""}` });
    }
  } catch (e) { if (!missing(e)) throw e; }
  try {
    for (const c of await recentModeratorChanges(db as never, CAP)) {
      rows.push({ at: iso(c.when), actor: c.by, role: "Admin", action: "roles", actionLabel: LABEL.get("roles")!, target: c.person, details: c.granted ? "Made a moderator" : "Moderator flag removed" });
    }
  } catch (e) { if (!missing(e)) throw e; }
  const q = String(o.q ?? "").trim().toLowerCase().slice(0, 100);
  const action = LABEL.has(String(o.action ?? "")) ? String(o.action) : "";
  const shown = rows.filter((r) => (!action || r.action === action) && (!q || `${r.actor} ${r.role} ${r.target} ${r.details}`.toLowerCase().includes(q)))
    .sort((a, b) => b.at.localeCompare(a.at));
  const pages = Math.max(1, Math.ceil(shown.length / AUDIT_PAGE));
  const page = Math.min(Math.max(1, Number(o.page) || 1), pages);
  return { rows: shown.slice((page - 1) * AUDIT_PAGE, page * AUDIT_PAGE), total: shown.length, page, pages, actions: AUDIT_ACTIONS, action, q };
}
