// Sector forms, part 1 (P2): each sector's robot types, kept by administrators at /admin/sector-forms (migration 024).
//
// Rules
//   * Administrators only. The pages call requireAdminPage and the routes requireAdmin; nothing here checks a role by itself.
//   * A robot type is never deleted (there is no function for it). Switching one off hides it from the Contribute form (P3), but a
//     contribution that already chose it keeps showing it.
//   * The name is what the robot card on the sector page says (P4 matches card headings to these names). It is unique within its
//     sector, ignoring capitals and extra spaces. The slug (the ?robot= link code from P3) is made from the name once, when the
//     robot is added, and never changes, so links keep working when a name is corrected.
//   * Demo sectors have no form: they are not listed and cannot be opened here.
//   * Before migration 024 the sector list still loads and says the robot types are not set up yet; changes answer NOT_SET_UP.

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export const ROBOT_NAME_MIN = 2;
export const ROBOT_NAME_MAX = 80;
/** Switched-off robots count too (they are kept), so the cap is generous. */
export const ROBOTS_PER_SECTOR = 50;
const SLUG_MAX = 60;
const SECTOR_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type Fail = { ok: false; status: number; error: string; message: string };
const fail = (status: number, error: string, message: string): Fail => ({ ok: false, status, error, message });
const code = (e: unknown) => (e as { code?: string } | null)?.code;
const constraintOf = (e: unknown) => (e as { constraint?: string } | null)?.constraint;
export const NOT_SET_UP = (): Fail => fail(503, "NOT_SET_UP", "Robot types are not set up on this database yet (migration 024 is needed).");
const NO_SECTOR = (): Fail => fail(404, "NOT_FOUND", "We could not find that sector.");
const NO_ROBOT = (): Fail => fail(404, "NOT_FOUND", "We could not find that robot type in this sector.");

export type SectorFormRow = { slug: string; name: string; active: boolean; robots: number; activeRobots: number };
export type RobotType = { id: number; slug: string; name: string; active: boolean; order: number; updatedAt: string };
export type SectorForm = { sector: { slug: string; name: string; active: boolean }; robots: RobotType[]; robotsReady: boolean };

/** A sector slug from a URL, or null. Checked before it reaches a query (it is still sent as a parameter). */
export const parseSectorSlug = (v: unknown): string | null => (typeof v === "string" && v.length <= SLUG_MAX && SECTOR_SLUG.test(v) ? v : null);
/** A robot id from a URL, or null. */
export const parseRobotId = (v: unknown): number | null => {
  const s = typeof v === "number" ? String(v) : v;
  return typeof s === "string" && /^[1-9]\d{0,9}$/.test(s) && Number(s) <= 2147483647 ? Number(s) : null;
};

/** The name as it will be stored: spaces collapsed and trimmed. An error message when it cannot be used. */
export function cleanRobotName(v: unknown): { name: string } | { error: string } {
  if (typeof v !== "string") return { error: "Type the robot type's name." };
  if (/[\u0000-\u001F\u007F]/.test(v)) return { error: "The name cannot contain line breaks or control characters." };
  const name = v.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!name) return { error: "Type the robot type's name." };
  if ([...name].length < ROBOT_NAME_MIN) return { error: `The name needs at least ${ROBOT_NAME_MIN} characters.` };
  if ([...name].length > ROBOT_NAME_MAX) return { error: `The name can have up to ${ROBOT_NAME_MAX} characters.` };
  if (!/[\p{L}\p{N}]/u.test(name)) return { error: "The name needs at least one letter or number." };
  if (/[<>]/.test(name)) return { error: "The name cannot contain < or >." };
  return { name };
}

/** The link code for a new robot: lower-case letters, digits and single hyphens, at most 60 characters. */
export function slugFor(name: string): string {
  const s = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s.slice(0, SLUG_MAX).replace(/-+$/, "") || "robot";
}

const toRobot = (r: any): RobotType => ({
  id: Number(r.id), slug: r.slug, name: r.name, active: r.is_active === true, order: Number(r.sort_order),
  updatedAt: new Date(r.updated_at).toISOString(),
});

async function sectorBySlug(db: Db, slug: string): Promise<{ id: number; slug: string; name: string; active: boolean } | null> {
  const { rows } = await db.query("SELECT id, slug, name, is_active FROM sectors WHERE slug = $1::varchar AND NOT is_demo", [slug]);
  return rows[0] ? { id: Number(rows[0].id), slug: rows[0].slug, name: rows[0].name, active: rows[0].is_active !== false } : null;
}

/** Every sector that can have a form, with how many robot types it has. Throws when the sectors themselves are missing (012). */
export async function listSectorForms(db: Db): Promise<{ sectors: SectorFormRow[]; robotsReady: boolean }> {
  const { rows } = await db.query("SELECT id, slug, name, is_active FROM sectors WHERE NOT is_demo ORDER BY sort_order, name");
  let counts = new Map<number, { all: number; active: number }>(), robotsReady = true;
  try {
    const c = await db.query("SELECT sector_id, count(*)::int AS n, count(*) FILTER (WHERE is_active)::int AS a FROM sector_robot_types GROUP BY sector_id");
    counts = new Map(c.rows.map((r) => [Number(r.sector_id), { all: Number(r.n), active: Number(r.a) }]));
  } catch (e) {
    if (code(e) !== "42P01") throw e;
    robotsReady = false; // migration 024 not applied yet
  }
  return {
    robotsReady,
    sectors: rows.map((s) => ({ slug: s.slug, name: s.name, active: s.is_active !== false, robots: counts.get(Number(s.id))?.all ?? 0, activeRobots: counts.get(Number(s.id))?.active ?? 0 })),
  };
}

/** One sector's form: its robot types in order (switched-off ones included). null when there is no such (non-demo) sector. */
export async function sectorForm(db: Db, slug: string): Promise<SectorForm | null> {
  const s = parseSectorSlug(slug) ? await sectorBySlug(db, slug) : null;
  if (!s) return null;
  try {
    const { rows } = await db.query("SELECT id, slug, name, is_active, sort_order, updated_at FROM sector_robot_types WHERE sector_id = $1 ORDER BY sort_order, id", [s.id]);
    return { sector: { slug: s.slug, name: s.name, active: s.active }, robots: rows.map(toRobot), robotsReady: true };
  } catch (e) {
    if (code(e) !== "42P01") throw e;
    return { sector: { slug: s.slug, name: s.name, active: s.active }, robots: [], robotsReady: false };
  }
}

const duplicate = (name: string) => fail(409, "DUPLICATE", `This sector already has a robot type called "${name}".`);

/** Adds a robot type at the end of the sector's list. */
export async function addRobotType(db: Db, adminId: number, sectorSlug: string, rawName: unknown): Promise<{ ok: true; robot: RobotType } | Fail> {
  const cleaned = cleanRobotName(rawName);
  if ("error" in cleaned) return fail(400, "VALIDATION_FAILED", cleaned.error);
  try {
    const s = parseSectorSlug(sectorSlug) ? await sectorBySlug(db, sectorSlug) : null;
    if (!s) return NO_SECTOR();
    const have = await db.query("SELECT slug, name, sort_order FROM sector_robot_types WHERE sector_id = $1", [s.id]);
    if (have.rows.length >= ROBOTS_PER_SECTOR) return fail(409, "LIMIT", `A sector can have up to ${ROBOTS_PER_SECTOR} robot types. Rename or switch off one you no longer need.`);
    const key = (n: string) => n.replace(/\s+/g, " ").toLowerCase();
    const same = have.rows.find((r) => key(r.name) === key(cleaned.name));
    if (same) return duplicate(same.name); // name the robot type that is already there, as it is written
    const taken = new Set(have.rows.map((r) => r.slug as string));
    const base = slugFor(cleaned.name);
    let slug = base;
    for (let i = 2; taken.has(slug); i++) slug = `${base.slice(0, SLUG_MAX - String(i).length - 1).replace(/-+$/, "")}-${i}`;
    const order = have.rows.reduce((m, r) => Math.max(m, Number(r.sort_order)), 0) + 10;
    const { rows } = await db.query(
      "INSERT INTO sector_robot_types (sector_id, slug, name, sort_order, updated_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, slug, name, is_active, sort_order, updated_at",
      [s.id, slug, cleaned.name, order, adminId]);
    return { ok: true, robot: toRobot(rows[0]) };
  } catch (e) {
    if (code(e) === "42P01") return NOT_SET_UP();
    if (code(e) === "23505") return constraintOf(e) === "sector_robot_types_name_uq" ? duplicate(cleaned.name) : fail(409, "CONFLICT", "Someone changed this list at the same time. Please try again.");
    throw e;
  }
}

export type RobotChange = { name: string } | { active: boolean } | { move: "up" | "down" };

/** Reads exactly one change from a request body: { name } or { active } or { move: "up" | "down" }. */
export function parseRobotChange(b: unknown): RobotChange | null {
  if (!b || typeof b !== "object" || Array.isArray(b)) return null;
  const keys = Object.keys(b as object);
  if (keys.length !== 1) return null;
  const o = b as Record<string, unknown>;
  if (keys[0] === "name" && typeof o.name === "string") return { name: o.name };
  if (keys[0] === "active" && typeof o.active === "boolean") return { active: o.active };
  if (keys[0] === "move" && (o.move === "up" || o.move === "down")) return { move: o.move };
  return null;
}

/** Renames, switches on/off, or moves one robot type of the sector. Never deletes one. */
export async function changeRobotType(db: Db, adminId: number, sectorSlug: string, robotId: number, change: RobotChange): Promise<{ ok: true; robots: RobotType[] } | Fail> {
  let cleanName = "";
  if ("name" in change) {
    const c = cleanRobotName(change.name);
    if ("error" in c) return fail(400, "VALIDATION_FAILED", c.error);
    cleanName = c.name;
  }
  try {
    const s = parseSectorSlug(sectorSlug) ? await sectorBySlug(db, sectorSlug) : null;
    if (!s) return NO_SECTOR();
    const list = (await db.query("SELECT id, slug, name, is_active, sort_order, updated_at FROM sector_robot_types WHERE sector_id = $1 ORDER BY sort_order, id", [s.id])).rows.map(toRobot);
    const at = list.findIndex((r) => r.id === robotId);
    if (at < 0) return NO_ROBOT(); // also when the id belongs to another sector
    if ("name" in change) {
      const key = (n: string) => n.replace(/\s+/g, " ").toLowerCase();
      const same = list.find((r) => r.id !== robotId && key(r.name) === key(cleanName));
      if (same) return duplicate(same.name);
      if (list[at].name !== cleanName) await db.query("UPDATE sector_robot_types SET name = $1, updated_at = now(), updated_by = $2 WHERE id = $3 AND sector_id = $4", [cleanName, adminId, robotId, s.id]);
    } else if ("active" in change) {
      if (list[at].active !== change.active) await db.query("UPDATE sector_robot_types SET is_active = $1, updated_at = now(), updated_by = $2 WHERE id = $3 AND sector_id = $4", [change.active, adminId, robotId, s.id]);
    } else {
      const to = change.move === "up" ? at - 1 : at + 1;
      if (to >= 0 && to < list.length) {
        const ids = list.map((r) => r.id);
        [ids[at], ids[to]] = [ids[to], ids[at]];
        // One statement renumbers the whole sector 10, 20, 30 ...; only the moved robot records who moved it.
        await db.query(
          "UPDATE sector_robot_types r SET sort_order = v.o, updated_at = CASE WHEN r.id = $3 THEN now() ELSE r.updated_at END, updated_by = CASE WHEN r.id = $3 THEN $4 ELSE r.updated_by END " +
          "FROM unnest($1::int[], $2::int[]) AS v(id, o) WHERE r.id = v.id AND r.sector_id = $5",
          [ids, ids.map((_, i) => (i + 1) * 10), robotId, adminId, s.id]);
      }
    }
    const after = (await db.query("SELECT id, slug, name, is_active, sort_order, updated_at FROM sector_robot_types WHERE sector_id = $1 ORDER BY sort_order, id", [s.id])).rows.map(toRobot);
    return { ok: true, robots: after };
  } catch (e) {
    if (code(e) === "42P01") return NOT_SET_UP();
    if (code(e) === "23505") return duplicate(cleanName);
    throw e;
  }
}
