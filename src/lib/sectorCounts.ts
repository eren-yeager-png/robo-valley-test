// Admin overview: how many contributions each sector has in each state. Read only; counted from the database, nothing estimated.
//
// How a contribution is counted
//   * A contribution can belong to several sectors. It is counted ONCE IN EACH of its sectors, so a row is "what this sector holds".
//   * The "sum of sectors" total therefore counts a two-sector contribution twice. The "unique" row counts every contribution once.
//   * "Submitted" is pending review that no reviewer has verified yet; "Verified" is pending review that a reviewer has verified (it
//     still waits for an administrator to approve it, exactly as the moderation page shows it). Drafts are private to their authors.
//   * Demo items and removed items are never counted (the public sector counts also leave out demo items).
//   * Drafts that have no sector yet are in no sector row; they are reported separately as `withoutSector`.

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export const COUNT_KEYS = ["draft", "submitted", "verified", "changesRequested", "published", "rejected", "unpublished", "total"] as const;
export type CountKey = (typeof COUNT_KEYS)[number];
export type Counts = Record<CountKey, number>;
export type SectorCountRow = { slug: string; name: string; active: boolean } & Counts;
export type SectorCounts = { sectors: SectorCountRow[]; sum: Counts; unique: Counts; withoutSector: number };

const zero = (): Counts => ({ draft: 0, submitted: 0, verified: 0, changesRequested: 0, published: 0, rejected: 0, unpublished: 0, total: 0 });
const n = (v: unknown) => Number(v) || 0;
const countsOf = (r: Record<string, unknown>): Counts => ({
  draft: n(r.draft), submitted: n(r.submitted), verified: n(r.verified), changesRequested: n(r.changes_requested),
  published: n(r.published), rejected: n(r.rejected), unpublished: n(r.unpublished), total: n(r.total),
});

// "verified" = a reviewer's verify action is on record (the same test the moderation page uses). If the audit table is not there yet
// (migration 017 not applied) nothing can have been verified, so it counts as 0 instead of failing the whole page.
const verifiedSql = (haveAudit: boolean) => haveAudit
  ? "EXISTS (SELECT 1 FROM contribution_reviews r WHERE r.contribution_id = c.id AND r.action = 'verify')"
  : "false";
const FILTERS = (v: string) => `
  count(*) FILTER (WHERE c.status = 'draft') AS draft,
  count(*) FILTER (WHERE c.status = 'pending_review' AND NOT ${v}) AS submitted,
  count(*) FILTER (WHERE c.status = 'pending_review' AND ${v}) AS verified,
  count(*) FILTER (WHERE c.status = 'changes_requested') AS changes_requested,
  count(*) FILTER (WHERE c.status = 'published') AS published,
  count(*) FILTER (WHERE c.status = 'rejected') AS rejected,
  count(*) FILTER (WHERE c.status = 'unpublished') AS unpublished,
  count(*) AS total`;

async function run(db: Db, haveAudit: boolean): Promise<SectorCounts> {
  const v = verifiedSql(haveAudit);
  const per = await db.query(
    `SELECT s.slug, s.name, s.is_active, ${FILTERS(v)} FROM sectors s
       JOIN contribution_scopes cs ON cs.sector_id = s.id
       JOIN contributions c ON c.id = cs.contribution_id AND NOT c.is_demo AND c.status <> 'removed'
      GROUP BY s.id ORDER BY s.sort_order, s.slug`);
  const all = await db.query("SELECT slug, name, is_active FROM sectors ORDER BY sort_order, slug");
  const counted = new Map<string, Counts>(per.rows.map((r) => [r.slug as string, countsOf(r)]));
  const sectors: SectorCountRow[] = all.rows.map((s) => ({ slug: s.slug, name: s.name, active: s.is_active !== false, ...(counted.get(s.slug) ?? zero()) }));
  const sum = zero();
  for (const s of sectors) for (const k of COUNT_KEYS) sum[k] += s[k];
  const uniq = await db.query(
    `SELECT ${FILTERS(v)} FROM contributions c
      WHERE NOT c.is_demo AND c.status <> 'removed' AND EXISTS (SELECT 1 FROM contribution_scopes cs WHERE cs.contribution_id = c.id)`);
  const none = await db.query(
    "SELECT count(*)::int AS n FROM contributions c WHERE NOT c.is_demo AND c.status <> 'removed' AND NOT EXISTS (SELECT 1 FROM contribution_scopes cs WHERE cs.contribution_id = c.id)");
  return { sectors, sum, unique: countsOf(uniq.rows[0] ?? {}), withoutSector: n(none.rows[0]?.n) };
}

export async function sectorStatusCounts(db: Db): Promise<SectorCounts> {
  try { return await run(db, true); }
  catch (e) { if ((e as { code?: string })?.code === "42P01") return run(db, false); throw e; }
}
