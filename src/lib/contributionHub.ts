// The numbers the public Contribute hub shows, per sector. AGGREGATES ONLY: no title, author, contact or id of any contribution
// or person is ever selected. Only PUBLISHED, non-demo contributions count, so a draft, a pending item, an item waiting for changes,
// a rejected item and an edited item that went back to review are all outside the numbers. A contribution filed under two sectors
// counts once in each (the primary key of contribution_scopes makes "twice in the same sector" impossible).
// P3: each sector also lists the robot types that are ON (names only, from Sector forms), so the form can ask "Which robot is it
// about?". These are the administrators' public lists; nobody's answer is ever here.
import { activeRobotsBySector, type RobotOption } from "./contributionRobots";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/** A sector shows its number of contributors only from this many different people, so a count can never point at one person. */
export const MIN_PUBLIC_CONTRIBUTORS = 5;

export type SectorCount = { slug: string; name: string; contributions: number; contributors: number | null; empty: boolean; robots: RobotOption[] };

export const SECTOR_COUNTS_SQL =
  "SELECT s.id, s.slug, s.name, " +
  "count(DISTINCT c.id)::int AS contributions, count(DISTINCT c.user_id)::int AS contributors " +
  "FROM sectors s " +
  "LEFT JOIN contribution_scopes cs ON cs.sector_id = s.id " +
  "LEFT JOIN contributions c ON c.id = cs.contribution_id AND c.status = 'published' AND NOT c.is_demo " +
  "WHERE s.is_active AND NOT s.is_demo " +
  "GROUP BY s.id ORDER BY s.sort_order, s.name";

export async function publicSectorCounts(db: Db): Promise<SectorCount[]> {
  const { rows } = await db.query(SECTOR_COUNTS_SQL);
  const robots = await activeRobotsBySector(db); // empty before migration 024
  return rows.map((r) => {
    const contributions = Number(r.contributions), people = Number(r.contributors);
    return { slug: r.slug, name: r.name, contributions, contributors: people >= MIN_PUBLIC_CONTRIBUTORS ? people : null, empty: contributions === 0, robots: robots.get(Number(r.id)) ?? [] };
  });
}
