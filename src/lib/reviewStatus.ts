// The one place that turns a stored status into the label people see. The stored statuses never change (migrations 012, 017, 018);
// "New", "In review" and "Replied" are worked out from what happened in the CURRENT review round:
//   pending_review + a reply to the contributor since the item last entered review  -> Replied
//   pending_review + opened by a moderator since then                               -> In review
//   pending_review otherwise                                                        -> New
// "Since the item last entered review" is contributions.review_round_at (migration 019; set by the database whenever the status becomes
// pending_review), or submitted_at for rows that have not changed status since 019. So a resubmitted item is "New" again.
// Members see New and In review both as "Pending review"; every other label is the same for members and moderators.
// Drafts are never shown to moderators, and Removed is final, so neither has a tab in the portal.
type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export type DisplayStatus = "new" | "in_review" | "replied" | "changes_requested" | "published" | "rejected" | "unpublished" | "draft" | "removed";

export const DISPLAY_LABELS: Record<DisplayStatus, string> = {
  new: "New", in_review: "In review", replied: "Replied", changes_requested: "Changes requested", published: "Published",
  rejected: "Not accepted", unpublished: "Unpublished", draft: "Draft", removed: "Removed",
};

/** The colour of each label's pill in the portal: amber while it waits, green when live, red when closed, grey when taken down. */
export const STATUS_TONE: Record<DisplayStatus, "" | "amber" | "red" | "grey"> = {
  new: "amber", in_review: "amber", replied: "amber", changes_requested: "amber", published: "", rejected: "red", removed: "red", unpublished: "grey", draft: "grey",
};

/** The portal's tabs, in order (drafts and removed items have none). */
export const PORTAL_TABS: readonly DisplayStatus[] = ["new", "in_review", "replied", "changes_requested", "published", "rejected", "unpublished"];

export type RoundFacts = { replied: boolean; viewed: boolean };
const NONE: RoundFacts = { replied: false, viewed: false };

export function displayStatus(status: string, round: RoundFacts = NONE): DisplayStatus {
  switch (status) {
    case "pending_review": return round.replied ? "replied" : round.viewed ? "in_review" : "new";
    case "changes_requested": case "published": case "rejected": case "unpublished": case "draft": case "removed": return status;
    default: return "draft"; // an unknown value is never shown as live
  }
}

export const portalLabel = (d: DisplayStatus) => DISPLAY_LABELS[d];
/** What the contributor sees: New and In review are both "Pending review". */
export const memberLabel = (d: DisplayStatus) => (d === "new" || d === "in_review" ? "Pending review" : DISPLAY_LABELS[d]);

/** The start of the current review round, as SQL on contributions c. */
export const ROUND_START_SQL = "COALESCE(c.review_round_at, c.submitted_at, c.created_at)";

/**
 * Replied / opened in the current round, for these items. Needs migration 019: before it, or if anything about it is missing, every
 * item simply has no replies and no views (so pending items show as "New" / "Pending review"), and nothing fails.
 */
export async function roundFacts(db: Db, ids: number[]): Promise<Map<number, RoundFacts>> {
  const out = new Map<number, RoundFacts>();
  if (ids.length === 0) return out;
  try {
    const { rows } = await db.query(
      "SELECT c.id, " +
      `EXISTS (SELECT 1 FROM contribution_replies p WHERE p.contribution_id = c.id AND p.created_at >= ${ROUND_START_SQL}) AS replied, ` +
      `EXISTS (SELECT 1 FROM contribution_views v WHERE v.contribution_id = c.id AND v.last_viewed_at >= ${ROUND_START_SQL}) AS viewed ` +
      "FROM contributions c WHERE c.id = ANY($1::bigint[])", [ids]);
    for (const r of rows) out.set(Number(r.id), { replied: r.replied === true, viewed: r.viewed === true });
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code !== "42P01" && code !== "42703") throw e; // 019 not applied yet: no facts
  }
  return out;
}
