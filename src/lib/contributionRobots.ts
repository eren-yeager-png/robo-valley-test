// P3: the robot a contribution is about, one per chosen sector (migration 025), from the robot types administrators keep in
// Sector forms (migration 024).
//
// Rules
//   * Optional. No robot ("Not sure") is NULL. A robot must belong to the same sector (the database checks it too).
//   * Only robot types that are ON can be newly chosen. One that was switched off after a member chose it stays chosen (Edit keeps
//     it); it simply is not offered for new choices any more.
//   * A form that does not send `robots` (older than 0.1.11) leaves the saved choices as they are.
//   * Private: the owner and the reviewers see the choices. The public sector list only carries the robot TYPES (names) that are on.
//   * Before 024 or 025 is applied nothing breaks: no robots are offered, the form's answers are not saved, and nothing shows a robot.

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const missing = (e: unknown) => ["42P01", "42703"].includes(String((e as { code?: string } | null)?.code));

export type RobotOption = { slug: string; name: string };
export type ChosenRobot = { sector: string; sectorName: string; robot: { slug: string; name: string; active: boolean } | null };

/** The robot types that are ON, per sector id, in their order: what the form may offer. Empty before migration 024. */
export async function activeRobotsBySector(db: Db): Promise<Map<number, RobotOption[]>> {
  const out = new Map<number, RobotOption[]>();
  try {
    const { rows } = await db.query("SELECT sector_id, slug, name FROM sector_robot_types WHERE is_active ORDER BY sector_id, sort_order, id");
    for (const r of rows) {
      const k = Number(r.sector_id);
      if (!out.has(k)) out.set(k, []);
      out.get(k)!.push({ slug: r.slug, name: r.name });
    }
  } catch (e) { if (!missing(e)) throw e; }
  return out;
}

/** Reads `robots` from a request body: absent (an older form), or { "<sector slug>": "<robot slug>" | "" } ("" = Not sure). */
export function readRobots(raw: unknown): { present: false } | { present: true; value: Record<string, string> } | { error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw) || !("robots" in raw)) return { present: false };
  const v = (raw as Record<string, unknown>).robots;
  if (typeof v !== "object" || v === null || Array.isArray(v)) return { error: "The robot answers could not be read." };
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > 20) return { error: "The robot answers could not be read." };
  const value: Record<string, string> = {};
  for (const [k, r] of entries) {
    if (k.length > 60 || !SLUG.test(k) || typeof r !== "string" || r.length > 60 || (r !== "" && !SLUG.test(r))) return { error: "The robot answers could not be read." };
    value[k] = r;
  }
  return { present: true, value };
}

/** true only when the form was opened from a robot card (?robot=) and says so with exactly true. Read when the item is created. */
export const readFromRobotPage = (raw: unknown): boolean =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw as Record<string, unknown>).fromRobotPage === true;

/**
 * Checks the answers for the chosen sectors and works out what to store: sector id -> robot id (null = Not sure).
 * skip = migration 024 or 025 is not applied (nothing to check or store). An error message when a robot cannot be used.
 * Runs inside the caller's transaction, behind a savepoint, so a missing table or column does not spoil the rest of the save.
 */
export async function planRobots(db: Db, contributionId: number | null, sectors: { id: number; slug: string; name: string }[], answers: Record<string, string>):
  Promise<{ skip: true } | { plan: Map<number, number | null> } | { error: string }> {
  await db.query("SAVEPOINT rv_robots");
  try {
    const ids = sectors.map((s) => s.id);
    const { rows } = await db.query("SELECT id, sector_id, slug, is_active FROM sector_robot_types WHERE sector_id = ANY($1::int[])", [ids]);
    let current = new Map<number, number | null>();
    if (contributionId !== null) {
      const cur = await db.query("SELECT sector_id, robot_type_id FROM contribution_scopes WHERE contribution_id = $1", [contributionId]);
      current = new Map(cur.rows.map((r) => [Number(r.sector_id), r.robot_type_id === null ? null : Number(r.robot_type_id)]));
    } else {
      await db.query("SELECT robot_type_id FROM contribution_scopes LIMIT 0"); // a new item: still find out whether 025 is there
    }
    const plan = new Map<number, number | null>();
    for (const s of sectors) {
      const want = answers[s.slug] ?? "";
      if (want === "") { plan.set(s.id, null); continue; }
      const r = rows.find((x) => Number(x.sector_id) === s.id && x.slug === want);
      if (!r) return { error: `Choose a robot from the list for ${s.name}, or "Not sure".` };
      if (r.is_active !== true && current.get(s.id) !== Number(r.id)) return { error: `That robot type is no longer offered for ${s.name}. Choose another, or "Not sure".` };
      plan.set(s.id, Number(r.id));
    }
    await db.query("RELEASE SAVEPOINT rv_robots");
    return { plan };
  } catch (e) {
    await db.query("ROLLBACK TO SAVEPOINT rv_robots");
    if (missing(e)) return { skip: true };
    throw e;
  }
}

/** Stores the plan on the contribution's sector rows (inside the caller's transaction). */
export async function applyRobots(db: Db, contributionId: number, plan: Map<number, number | null>): Promise<void> {
  for (const [sectorId, robotId] of plan) {
    await db.query("UPDATE contribution_scopes SET robot_type_id = $3 WHERE contribution_id = $1 AND sector_id = $2", [contributionId, sectorId, robotId]);
  }
}

/** Marks a just-created contribution as started from a robot card. Before migration 025 the column is missing: nothing is saved. */
export async function saveFromRobotPage(db: Db, id: number, ownerId: number): Promise<void> {
  await db.query("SAVEPOINT rv_robot_origin");
  try {
    await db.query("UPDATE contributions SET from_robot_page = true WHERE id = $1 AND user_id = $2", [id, ownerId]);
    await db.query("RELEASE SAVEPOINT rv_robot_origin");
  } catch (e) {
    await db.query("ROLLBACK TO SAVEPOINT rv_robot_origin");
    if (!missing(e)) throw e;
  }
}

/** For Edit: true when the owner started this contribution from a robot card (false before migration 025). */
export async function fromRobotPageOf(db: Db, id: number, ownerId: number): Promise<boolean> {
  try {
    const { rows } = await db.query("SELECT from_robot_page AS f FROM contributions WHERE id = $1 AND user_id = $2", [id, ownerId]);
    return rows[0]?.f === true;
  } catch (e) { if (missing(e)) return false; throw e; }
}

/**
 * The robot chosen for each of a contribution's sectors, in sector order (null = Not sure). For the owner's Edit and the reviewers'
 * item page; callers decide who may see it. null when migration 024 or 025 is not applied.
 */
export async function robotsOf(db: Db, contributionId: number): Promise<ChosenRobot[] | null> {
  try {
    const { rows } = await db.query(
      "SELECT s.slug AS sector, s.name AS sector_name, r.slug, r.name, r.is_active FROM contribution_scopes cs JOIN sectors s ON s.id = cs.sector_id " +
      "LEFT JOIN sector_robot_types r ON r.id = cs.robot_type_id WHERE cs.contribution_id = $1 ORDER BY s.sort_order, s.slug", [contributionId]);
    return rows.map((r) => ({ sector: r.sector, sectorName: r.sector_name, robot: r.slug ? { slug: r.slug, name: r.name, active: r.is_active === true } : null }));
  } catch (e) { if (missing(e)) return null; throw e; }
}

/** For one sector's list or CSV: contribution id -> the robot's name in that sector (absent = Not sure). Empty before 024/025. */
export async function robotNamesInSector(db: Db, sectorSlug: string, contributionIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!contributionIds.length) return out;
  try {
    const { rows } = await db.query(
      "SELECT cs.contribution_id, r.name FROM contribution_scopes cs JOIN sectors s ON s.id = cs.sector_id AND s.slug = $1 " +
      "JOIN sector_robot_types r ON r.id = cs.robot_type_id WHERE cs.contribution_id = ANY($2::bigint[])", [sectorSlug, contributionIds]);
    for (const r of rows) out.set(Number(r.contribution_id), r.name);
  } catch (e) { if (!missing(e)) throw e; }
  return out;
}
