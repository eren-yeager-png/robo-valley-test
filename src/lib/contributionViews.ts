// "Who opened what" (migration 019): one row per item and moderator, with the first and the last time. It decides "New" versus
// "In review" (src/lib/reviewStatus.ts) and gives the work log its "opened" entries. Recorded when a reviewer opens an item that is not
// their own. Never fails the page: if 019 is not applied, or the write fails, the item is still shown and nothing is recorded.
type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export async function recordView(db: Db, viewerId: number, contributionId: number): Promise<boolean> {
  if (!Number.isSafeInteger(viewerId) || viewerId <= 0 || !Number.isSafeInteger(contributionId) || contributionId <= 0) return false;
  try {
    await db.query(
      "INSERT INTO contribution_views (contribution_id, viewer_id) SELECT $1::bigint, $2::bigint WHERE EXISTS (SELECT 1 FROM contributions WHERE id = $1::bigint AND status <> 'draft' AND user_id <> $2::bigint) " +
      "ON CONFLICT (contribution_id, viewer_id) DO UPDATE SET last_viewed_at = GREATEST(contribution_views.last_viewed_at, now())",
      [contributionId, viewerId]);
    return true;
  } catch {
    console.error("record view failed"); // nothing about the item or the person in the log
    return false;
  }
}
