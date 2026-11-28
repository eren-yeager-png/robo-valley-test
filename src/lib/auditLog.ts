// Contribution Portal: the Audit Log (administrators).
// From migration 030 on it reads the audit_log table (storedLog below): every approval, edit, publishing request, publication,
// rejection, field change, suggestion decision, sector change, moderator sector change and plugin event, written in the same
// transaction as the change, plus 030's backfill (one row per earlier approval and publication) and the moderator flag changes
// (moderator_audit, migration 015). Before 030 it is worked out from what the database already records:
//   * every line of every Share Your Idea idea's history (cw_contribution_history, migration 027): submitted, opened, draft, approved
//     and sent to an Admin, declined, previewed, edited, published, publish failed, unpublished, reopened, changes asked, rejected;
//   * every decision on an item sent with the current form (contribution_reviews, migrations 017-019): verified, approved and published,
//     changes asked, rejected, removed, unpublished, published again;
//   * the moderator flag changes (Users & Roles, migration 015).
// Who did it and in which role (Admin, Moderator, Contributor). Field changes and plugin events are written from the data update on.
import { recentModeratorChanges } from "./moderators";
import { portalReady } from "./portalAudit";

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

// ---------------------------------------------------------------------------------------------------------------- the stored log (030)
/** The filter of the stored log: [key, label, the actions it shows]. */
export const STORED_GROUPS: [string, string, string[]][] = [
  ["approved", "Approved", ["approve"]], ["requested", "Publish requested", ["send_request"]], ["edited", "Edited", ["edit"]],
  ["published", "Published", ["publish"]], ["failed", "Publish failed", ["publish_failed"]], ["rejected", "Rejected or declined", ["reject", "decline"]],
  ["sent_back", "Sent back", ["request_changes"]], ["unpublished", "Unpublished", ["unpublish"]], ["reopened", "Reopened", ["reopen"]], ["removed", "Removed", ["remove"]],
  ["fields", "Field changes", ["field_add", "field_rename", "field_edit", "field_status", "field_archive", "field_restore", "field_delete", "field_reorder"]],
  ["suggestions", "Suggested fields", ["suggestion_approve", "suggestion_reject"]],
  ["sectors", "Sector changes", ["sector_add", "sector_rename", "sector_reorder", "sector_style", "sector_archive", "sector_restore"]],
  ["roles", "Roles and sectors", ["moderator_sectors"]],
  ["plugins", "Plugin events", ["plugin_install", "plugin_update", "plugin_enable", "plugin_disable", "plugin_uninstall", "plugin_field_add", "plugin_field_skip"]],
  ["migrated", "Data update", ["migrated"]],
];
const ROLE_LABEL: Record<string, string> = { admin: "Admin", moderator: "Moderator", contributor: "Contributor", plugin: "Plugin", system: "System" };
const q2 = (v: unknown) => `"${String(v ?? "")}"`;
const list = (v: unknown) => (Array.isArray(v) ? v.map(String).join(", ") : "");

/** One sentence for a stored row, from its action and details. */
export function describeStored(action: string, m: Record<string, any>): string {
  const reason = m.reason ? ` Reason: ${m.reason}` : m.note ? ` Note: ${m.note}` : "";
  const changed = list(m.changed);
  const back = m.backfill ? " (copied from the records kept before the data update)" : "";
  switch (action) {
    case "approve": return (m.decision === "verify" ? "Verified (approved for an Admin)" : changed ? `Approved with edits (changed: ${changed})` : "Approved as-is") + back;
    case "send_request": return `Sent the publishing request to an Admin${m.version ? ` (version ${m.version})` : ""}.`;
    case "edit": return m.reset ? "Reset the working version to the original." : changed ? `Edited (changed: ${changed}).` : "Edited.";
    case "publish": return (m.decision === "republish" ? "Published again" : m.version ? `Published v${m.version}${m.sector ? ` in "${m.sector}"` : ""}` : "Published") + back;
    case "publish_failed": return `Publishing failed: ${m.error ?? ""}`;
    case "reject": return `Rejected.${reason}`;
    case "decline": return `Declined.${reason}`;
    case "request_changes": return `Sent back for changes.${reason}`;
    case "unpublish": return `Unpublished.${reason}`;
    case "reopen": return `Reopened for review.${reason}`;
    case "remove": return `Removed.${reason}`;
    case "field_add": return `Added the field ${q2(m.name)} (link code ${m.slug}).`;
    case "field_rename": return `Renamed the field ${q2(m.from)} to ${q2(m.to)}.`;
    case "field_edit": return `Edited the field ${q2(m.name)} (${list(m.changed)}).`;
    case "field_status": return `Field ${q2(m.name)}: ${m.from} → ${m.to}.`;
    case "field_archive": return `Archived the field ${q2(m.name)} (its contributions stay).`;
    case "field_restore": return `Restored the field ${q2(m.name)}.`;
    case "field_delete": return `Deleted the field ${q2(m.name)} (link code ${m.slug}); nothing used it.`;
    case "field_reorder": return `Moved the field ${q2(m.name)} ${m.move} (now ${m.position}).`;
    case "suggestion_approve": return `Approved the suggested field ${q2(m.suggested)}${m.edited ? ` as ${q2(m.name)}` : ""}: it is now a field of the sector.`;
    case "suggestion_reject": return `Rejected the suggested field ${q2(m.name)}.${reason}`;
    case "sector_add": return `Added the sector ${q2(m.name)} (link code ${m.slug}).`;
    case "sector_rename": return `Renamed the sector ${q2(m.from)} to ${q2(m.to)}.`;
    case "sector_reorder": return `Moved the sector ${q2(m.name)} ${m.move} (now ${m.position}).`;
    case "sector_style": return `Changed the card of ${q2(m.name)}.`;
    case "sector_archive": return `Archived the sector ${q2(m.name)} (members no longer see it; its contributions stay).`;
    case "sector_restore": return `Restored the sector ${q2(m.name)}.`;
    case "moderator_sectors": return m.all ? `${m.person ?? "A moderator"} reviews every sector.` : `${m.person ?? "A moderator"} reviews: ${list(m.sectors)}.`;
    case "migrated": return String(m.note ?? "Migrated from legacy data");
    default: return action.startsWith("plugin_") ? `Plugin ${q2(m.name ?? m.plugin)}: ${action.slice(7).replace(/_/g, " ")}${m.field ? ` (${m.field})` : ""}${m.note ? `. ${m.note}` : ""}.` : action;
  }
}

async function storedLog(db: Db, o: { page?: number; action?: string; q?: string }) {
  const group = STORED_GROUPS.find((g) => g[0] === o.action);
  const q = String(o.q ?? "").trim().toLowerCase().slice(0, 100);
  const rows: AuditRow[] = [];
  const { rows: a } = await db.query(
    "SELECT a.*, CASE WHEN a.target_type = 'idea' THEN (SELECT c.proposed->>'title' FROM cw_contributions c WHERE c.id = a.target_id) " +
    "WHEN a.target_type = 'contribution' THEN (SELECT c.title FROM contributions c WHERE c.id = a.target_id) END AS title " +
    `FROM audit_log a WHERE ($1::varchar[] IS NULL OR a.action = ANY($1::varchar[])) ORDER BY a.at DESC, a.id DESC LIMIT ${CAP}`, [group ? group[2] : null]);
  for (const r of a) {
    const m = (typeof r.meta === "string" ? JSON.parse(r.meta) : r.meta) ?? {};
    const g = STORED_GROUPS.find((x) => x[2].includes(String(r.action)));
    const target = r.target_type === "idea" ? `RV-${r.target_id} · ${r.title ?? m.title ?? ""}` : r.target_type === "contribution" ? `C-${r.target_id} · ${r.title ?? ""}`
      : r.target_type === "field" ? `Field · ${m.name ?? m.to ?? ""}${m.sector ? ` (${m.sector})` : ""}` : r.target_type === "field_suggestion" ? `Suggested field · ${m.name ?? m.suggested ?? ""}`
      : r.target_type === "sector" ? `Sector · ${m.name ?? m.to ?? m.slug ?? ""}` : r.target_type === "user" ? String(m.person ?? "A person")
      : r.target_type === "plugin" ? `Plugin · ${m.name ?? m.plugin ?? ""}` : "Contribution Portal";
    rows.push({ at: iso(r.at), actor: String(r.actor_name || (r.actor_role === "system" ? "System" : "")), role: ROLE_LABEL[r.actor_role] ?? String(r.actor_role),
      action: g?.[0] ?? "other", actionLabel: g?.[1] ?? "Other", target, details: describeStored(String(r.action), m) });
  }
  if (!group || group[0] === "roles") {
    try {
      for (const c of await recentModeratorChanges(db as never, CAP)) {
        rows.push({ at: iso(c.when), actor: c.by, role: "Admin", action: "roles", actionLabel: "Roles and sectors", target: c.person, details: c.granted ? "Made a moderator" : "Moderator flag removed" });
      }
    } catch (e) { if (!missing(e)) throw e; }
  }
  const shown = rows.filter((r) => !q || `${r.actor} ${r.role} ${r.target} ${r.details}`.toLowerCase().includes(q)).sort((x, y) => y.at.localeCompare(x.at));
  const pages = Math.max(1, Math.ceil(shown.length / AUDIT_PAGE));
  const page = Math.min(Math.max(1, Number(o.page) || 1), pages);
  return { rows: shown.slice((page - 1) * AUDIT_PAGE, page * AUDIT_PAGE), total: shown.length, page, pages,
    actions: STORED_GROUPS.map(([k, l]) => [k, l] as [string, string]), action: group ? group[0] : "", q, stored: true };
}

/** One page of the log, newest first. `action` filters by kind, `q` searches who, what and the item. */
export async function auditLog(db: Db, o: { page?: number; action?: string; q?: string } = {}) {
  if (await portalReady(db)) return storedLog(db, o);
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
  return { rows: shown.slice((page - 1) * AUDIT_PAGE, page * AUDIT_PAGE), total: shown.length, page, pages, actions: AUDIT_ACTIONS, action, q, stored: false };
}
