// "Your contributions": the signed-in person's own items, grouped by status, with the moderator's note where it matters.
// Only the owner's rows (user_id = $1). Never returns the body text, photos' bytes or contact details: a list only needs titles.
// The Contributor badge is DERIVED (at least one non-draft submission) and never stored, so it can never disagree with the data.
import { CONTRIBUTION_TYPES, STATUS_LABELS, type ContributionStatus } from "./contributions";
import { OWNER_RULES } from "./contributionApi";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export const MINE_STATUS_ORDER: ContributionStatus[] = ["draft", "changes_requested", "pending_review", "published", "unpublished", "rejected"];
/** The note is shown to the author only for the statuses where a moderator's words explain what happened. */
const NOTE_STATUSES = new Set<string>(["changes_requested", "rejected", "unpublished"]);
const TYPE_LABEL = new Map<string, string>(CONTRIBUTION_TYPES.map((t) => [t.id, t.label]));
const MAX_ITEMS = 200;

export type MineItem = {
  id: number; title: string; type: string; typeLabel: string; status: ContributionStatus; statusLabel: string;
  sectors: { slug: string; name: string }[]; note: string | null; canEdit: boolean; updatedAt: string;
};
export type Mine = { contributor: boolean; counts: Record<ContributionStatus, number>; items: MineItem[] };

const LIST_SQL =
  "SELECT c.id, c.title, c.type, c.status, c.updated_at, c.submitted_at IS NOT NULL AS submitted, " +
  "COALESCE((SELECT json_agg(json_build_object('slug', s.slug, 'name', s.name) ORDER BY s.sort_order, s.slug) FROM contribution_scopes cs JOIN sectors s ON s.id = cs.sector_id WHERE cs.contribution_id = c.id), '[]'::json) AS sectors " +
  "FROM contributions c WHERE c.user_id = $1 ORDER BY c.updated_at DESC, c.id DESC LIMIT " + MAX_ITEMS;
// The latest decision with a note, per item, for the items shown. Needs migration 017; without it the list simply has no notes.
const NOTES_SQL =
  "SELECT DISTINCT ON (contribution_id) contribution_id, note FROM contribution_reviews " +
  "WHERE contribution_id = ANY($1::bigint[]) AND note IS NOT NULL ORDER BY contribution_id, created_at DESC, id DESC";

export async function listMine(db: Db, userId: number): Promise<Mine> {
  const { rows } = await db.query(LIST_SQL, [userId]);
  const counts = Object.fromEntries(MINE_STATUS_ORDER.map((s) => [s, 0])) as Record<ContributionStatus, number>;
  let notes = new Map<number, string>();
  const ids = rows.filter((r) => NOTE_STATUSES.has(r.status)).map((r) => Number(r.id));
  if (ids.length) {
    try {
      notes = new Map((await db.query(NOTES_SQL, [ids])).rows.map((r) => [Number(r.contribution_id), String(r.note)]));
    } catch (e) {
      if ((e as { code?: string })?.code !== "42P01") throw e; // migration 017 not applied: no notes yet
    }
  }
  const items: MineItem[] = rows.map((r) => {
    const status = r.status as ContributionStatus;
    if (status in counts) counts[status]++;
    return {
      id: Number(r.id), title: r.title, type: r.type, typeLabel: TYPE_LABEL.get(r.type) ?? "", status, statusLabel: STATUS_LABELS[status] ?? status,
      sectors: Array.isArray(r.sectors) ? r.sectors : [], note: NOTE_STATUSES.has(status) ? notes.get(Number(r.id)) ?? null : null,
      // you may edit while it is a Draft or needs changes; editing a published or taken-down item sends it back to review, so it is allowed too
      canEdit: (OWNER_RULES[status]?.edit ?? null) !== null, updatedAt: new Date(r.updated_at).toISOString(),
    };
  });
  return { contributor: rows.some((r) => r.submitted), counts, items };
}

/** The badge only: at least one submission that is not a draft. One cheap query, used by the hub. */
export async function isContributor(db: Db, userId: number): Promise<boolean> {
  const { rows } = await db.query("SELECT 1 FROM contributions WHERE user_id = $1 AND status <> 'draft' LIMIT 1", [userId]);
  return rows.length > 0;
}
