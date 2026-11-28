// Admin overview: how many contributions each sector has in each state. Read only; counted from the database, nothing estimated.
//
// How a contribution is counted
//   * A contribution can belong to several sectors. It is counted ONCE IN EACH of its sectors, so a row is "what this sector holds".
//   * The "sum of sectors" total therefore counts a two-sector contribution twice. The "unique" row counts every contribution once.
//   * "Submitted" is pending review that no reviewer has verified yet; "Verified" is pending review that a reviewer has verified (it
//     still waits for an administrator to approve it, exactly as the moderation page shows it).
//   * Drafts are NEVER counted: they are private to their authors, so they are in no column and in no total.
//   * Demo items and removed items are never counted (the public sector counts also leave out demo items).
//   * Every contribution that is counted has a sector: the database refuses a non-draft contribution without one (migration 012).

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export const COUNT_KEYS = ["submitted", "verified", "changesRequested", "published", "rejected", "unpublished", "total"] as const;
export type CountKey = (typeof COUNT_KEYS)[number];
export type Counts = Record<CountKey, number>;
/** demo, archived, icon, color: for Admin > Sectors (archived, icon and color come with migration 030; false / "" before it). */
export type SectorCountRow = { slug: string; name: string; active: boolean; demo: boolean; archived: boolean; icon: string; color: string } & Counts;
/** features.sectorsData: migration 030 is applied (sector icons, colours and archiving). */
export type SectorCounts = { sectors: SectorCountRow[]; sum: Counts; unique: Counts; features: { sectorsData: boolean } };

const zero = (): Counts => ({ submitted: 0, verified: 0, changesRequested: 0, published: 0, rejected: 0, unpublished: 0, total: 0 });
const n = (v: unknown) => Number(v) || 0;
const countsOf = (r: Record<string, unknown>): Counts => ({
  submitted: n(r.submitted), verified: n(r.verified), changesRequested: n(r.changes_requested),
  published: n(r.published), rejected: n(r.rejected), unpublished: n(r.unpublished), total: n(r.total),
});

// "verified" = a reviewer's verify action is on record (the same test the moderation page uses). If the audit table is not there yet
// (migration 017 not applied) nothing can have been verified, so it counts as 0 instead of failing the whole page.
const verifiedSql = (haveAudit: boolean) => haveAudit
  ? "EXISTS (SELECT 1 FROM contribution_reviews r WHERE r.contribution_id = c.id AND r.action = 'verify')"
  : "false";
// Only what is counted at all: not a draft, not removed, not a demo item. "total" is the sum of the columns.
const COUNTED = "NOT c.is_demo AND c.status NOT IN ('draft','removed')";
const FILTERS = (v: string) => `
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
       JOIN contributions c ON c.id = cs.contribution_id AND ${COUNTED}
      GROUP BY s.id ORDER BY s.sort_order, s.slug`);
  let all: { rows: any[] }, sectorsData = true;
  try {
    all = await db.query("SELECT slug, name, is_active, is_demo, archived_at, icon, color FROM sectors ORDER BY sort_order, slug");
  } catch (e) {
    if ((e as { code?: string })?.code !== "42703") throw e;
    sectorsData = false; // migration 030 not applied yet
    all = await db.query("SELECT slug, name, is_active, is_demo FROM sectors ORDER BY sort_order, slug");
  }
  const counted = new Map<string, Counts>(per.rows.map((r) => [r.slug as string, countsOf(r)]));
  const sectors: SectorCountRow[] = all.rows.map((s) => ({ slug: s.slug, name: s.name, active: s.is_active !== false, demo: s.is_demo === true,
    archived: Boolean(s.archived_at), icon: String(s.icon ?? ""), color: String(s.color ?? ""), ...(counted.get(s.slug) ?? zero()) }));
  const sum = zero();
  for (const s of sectors) for (const k of COUNT_KEYS) sum[k] += s[k];
  const uniq = await db.query(`SELECT ${FILTERS(v)} FROM contributions c WHERE ${COUNTED}`);
  return { sectors, sum, unique: countsOf(uniq.rows[0] ?? {}), features: { sectorsData } };
}

export async function sectorStatusCounts(db: Db): Promise<SectorCounts> {
  try { return await run(db, true); }
  catch (e) { if ((e as { code?: string })?.code === "42P01") return run(db, false); throw e; }
}
