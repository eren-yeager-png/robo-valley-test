// Read-only lookups for the contribution workflow: the sectors and robot types from Sector Forms, the contributor's profile and the
// number of older (old form) contributions still waiting in Moderation. Each one tolerates a database without the older migrations.
import { activeRobotsBySector } from "../contributionRobots";
import { ROLES } from "../roles";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
export type SectorOption = { slug: string; name: string; robots: { slug: string; name: string }[] };

const missing = (e: unknown) => ["42P01", "42703"].includes((e as { code?: string })?.code ?? "");

/** Active sectors (not demo) with their active robot types, in their order. [] when Sector Forms is not set up (012/024 missing). */
export async function loadSectors(db: Db): Promise<SectorOption[]> {
  let sectors: any[] = [];
  try {
    sectors = (await db.query("SELECT id, slug, name FROM sectors WHERE is_active AND NOT is_demo ORDER BY sort_order, name")).rows;
  } catch (e) {
    if (missing(e)) return [];
    throw e;
  }
  // the same reader (and order) as the current form: robot types that are ON, empty before migration 024
  const robots = await activeRobotsBySector(db);
  return sectors.map((s) => ({
    slug: String(s.slug), name: String(s.name),
    robots: (robots.get(Number(s.id)) ?? []).map((r) => ({ slug: String(r.slug), name: String(r.name) })),
  }));
}

const ROLE_LABEL = new Map(ROLES.map(([code, label]) => [code, label]));
/** The label of a stakeholder role code ("TC" -> "Teacher / lab in-charge"); the code itself when unknown. */
export const roleLabel = (code: string) => ROLE_LABEL.get(code) ?? code;

/** Name, stakeholder role and whether the account is a minor, read from the database (the profile is the only source). */
export async function contributorProfile(db: Db, userId: number): Promise<{ fullName: string; roleCode: string; typeLabel: string; minor: boolean } | null> {
  const r = (await db.query("SELECT full_name, role, age_category FROM users WHERE id = $1", [userId])).rows[0];
  if (!r) return null;
  return { fullName: String(r.full_name ?? "").trim(), roleCode: String(r.role), typeLabel: roleLabel(String(r.role)), minor: r.age_category === "minor" };
}

/** Older contributions (the old form) still waiting for a decision in Moderation. 0 when that part of the database is not there. */
export async function earlierOpenCount(db: Db): Promise<number> {
  try {
    const r = await db.query("SELECT count(*)::int AS n FROM contributions WHERE status IN ('pending_review', 'changes_requested') AND NOT is_demo");
    return Number(r.rows[0]?.n ?? 0);
  } catch (e) {
    if (missing(e)) return 0;
    throw e;
  }
}
