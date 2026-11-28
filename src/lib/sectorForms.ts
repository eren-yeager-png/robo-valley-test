// Sector forms, part 1 (P2): each sector's robot types, kept by administrators at /admin/sector-forms (migration 024).
//
// Rules
//   * Administrators only. The pages call requireAdminPage and the routes requireAdmin; nothing here checks a role by itself.
//   * Switching a robot type off hides it from the Contribute form (P3), but a contribution that already chose it keeps showing it.
//   * Contribution Portal (migration 030): a robot type is a sector's "field", with a status (active, hidden = switched off, archived =
//     kept for its contributions and out of every list members see), a description, an icon and a source (admin, member = from a
//     member's suggestion, plugin = registered by a WordPress plugin). A field can be DELETED only when no contribution uses it
//     (any status, the current form or Share Your Idea) and no plugin manages it; otherwise Archive is offered. The database refuses
//     both too (025's link, 030's link and trigger). Every change writes an Audit Log row. Before 030 the new parts answer
//     NOT_SET_UP and the rest works as before.
//   * The name is what the robot card on the sector page says (P4 matches card headings to these names). It is unique within its
//     sector, ignoring capitals and extra spaces. The slug (the ?robot= link code from P3) is made from the name once, when the
//     robot is added, and never changes, so links keep working when a name is corrected.
//   * Demo sectors have no form: they are not listed and cannot be opened here.
//   * Before migration 024 the sector list still loads and says the robot types are not set up yet; changes answer NOT_SET_UP.

import { audit } from "./portalAudit";

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
const NOT_SET_UP_030 = (): Fail => fail(503, "NOT_SET_UP", "Field descriptions, icons, archiving and statuses are not set up on this database yet (migration 030 is needed).");
const NO_SECTOR = (): Fail => fail(404, "NOT_FOUND", "We could not find that sector.");
const NO_ROBOT = (): Fail => fail(404, "NOT_FOUND", "We could not find that robot type in this sector.");

/** archived, icon, color: migration 030 (false / "" before it). */
export type SectorFormRow = { slug: string; name: string; active: boolean; robots: number; activeRobots: number; archived: boolean; icon: string; color: string };
export type FieldStatus = "active" | "hidden" | "archived";
export type FieldSource = "admin" | "member" | "plugin";
export const FIELD_STATUSES: readonly FieldStatus[] = ["active", "hidden", "archived"];
export const FIELD_DESCRIPTION_MAX = 500;
export type RobotType = {
  id: number; slug: string; name: string; active: boolean; order: number; updatedAt: string;
  /** migration 030 (before it: status from active, source "admin", no plugin, description or icon) */
  status: FieldStatus; source: FieldSource; pluginKey: string | null; description: string; icon: string;
};
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
  status: (FIELD_STATUSES as readonly string[]).includes(r.status) ? r.status : r.is_active === true ? "active" : "hidden",
  source: r.source === "member" || r.source === "plugin" ? r.source : "admin", pluginKey: r.plugin_key ?? null,
  description: String(r.description ?? ""), icon: String(r.icon ?? ""),
});
const COLS = "id, slug, name, is_active, sort_order, updated_at";
const COLS_030 = `${COLS}, status, source, plugin_key, description, icon`;

/** A sector's robot types in order, with 030's columns when they are there. */
async function readRobots(db: Db, sectorId: number): Promise<RobotType[]> {
  try {
    return (await db.query(`SELECT ${COLS_030} FROM sector_robot_types WHERE sector_id = $1 ORDER BY sort_order, id`, [sectorId])).rows.map(toRobot);
  } catch (e) {
    if (code(e) !== "42703") throw e;
    return (await db.query(`SELECT ${COLS} FROM sector_robot_types WHERE sector_id = $1 ORDER BY sort_order, id`, [sectorId])).rows.map(toRobot);
  }
}
/** One field's description as stored: spaces collapsed, at most FIELD_DESCRIPTION_MAX characters; "" = none. */
export function cleanDescription(v: unknown): { description: string } | { error: string } {
  if (v === undefined || v === null) return { description: "" };
  if (typeof v !== "string") return { error: "The description must be text." };
  const d = v.normalize("NFC").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").replace(/[ \t]+/g, " ").trim();
  if ([...d].length > FIELD_DESCRIPTION_MAX) return { error: `The description can have up to ${FIELD_DESCRIPTION_MAX} characters.` };
  if (/[<>]/.test(d)) return { error: "The description cannot contain < or >." };
  return { description: d };
}
/** A field's icon: a short symbol such as an emoji (1 to 8 characters, no spaces or < > & "); "" = none. */
export function cleanIcon(v: unknown): { icon: string } | { error: string } {
  if (v === undefined || v === null || v === "") return { icon: "" };
  if (typeof v !== "string") return { error: "The icon must be a short symbol, for example an emoji." };
  const i = v.normalize("NFC").trim();
  if (!i) return { icon: "" };
  if (i.length > 8 || /[\s<>&"]/.test(i)) return { error: "The icon must be a short symbol (up to 8 characters), for example an emoji." };
  return { icon: i };
}
/** A link code typed by the administrator: lower-case letters, digits and single hyphens, at most 60 characters. */
export function cleanSlug(v: unknown): { slug: string } | { error: string } {
  if (typeof v !== "string" || !v.trim()) return { error: "Type the link code." };
  const t = v.trim();
  if (t.length > SLUG_MAX || !SECTOR_SLUG.test(t)) return { error: "The link code can use lower-case letters, digits and single hyphens (up to 60 characters)." };
  return { slug: t };
}

/** A non-demo sector by its slug (shared with the questions in sectorQuestions.ts). */
export async function sectorBySlug(db: Db, slug: string): Promise<{ id: number; slug: string; name: string; active: boolean } | null> {
  const { rows } = await db.query("SELECT id, slug, name, is_active FROM sectors WHERE slug = $1::varchar AND NOT is_demo", [slug]);
  return rows[0] ? { id: Number(rows[0].id), slug: rows[0].slug, name: rows[0].name, active: rows[0].is_active !== false } : null;
}

/** Every sector that can have a form, with how many robot types it has. Throws when the sectors themselves are missing (012). */
export async function listSectorForms(db: Db): Promise<{ sectors: SectorFormRow[]; robotsReady: boolean }> {
  let rows: any[];
  try {
    rows = (await db.query("SELECT id, slug, name, is_active, archived_at, icon, color FROM sectors WHERE NOT is_demo ORDER BY sort_order, name")).rows;
  } catch (e) {
    if (code(e) !== "42703") throw e;
    rows = (await db.query("SELECT id, slug, name, is_active FROM sectors WHERE NOT is_demo ORDER BY sort_order, name")).rows;
  }
  let counts = new Map<number, { all: number; active: number }>(), robotsReady = true;
  try {
    let c;
    try { // archived fields (030) are kept for their contributions but are no longer the sector's fields
      c = await db.query("SELECT sector_id, count(*) FILTER (WHERE status <> 'archived')::int AS n, count(*) FILTER (WHERE is_active)::int AS a FROM sector_robot_types GROUP BY sector_id");
    } catch (e) {
      if (code(e) !== "42703") throw e;
      c = await db.query("SELECT sector_id, count(*)::int AS n, count(*) FILTER (WHERE is_active)::int AS a FROM sector_robot_types GROUP BY sector_id");
    }
    counts = new Map(c.rows.map((r) => [Number(r.sector_id), { all: Number(r.n), active: Number(r.a) }]));
  } catch (e) {
    if (code(e) !== "42P01") throw e;
    robotsReady = false; // migration 024 not applied yet
  }
  return {
    robotsReady,
    sectors: rows.map((s) => ({ slug: s.slug, name: s.name, active: s.is_active !== false, robots: counts.get(Number(s.id))?.all ?? 0, activeRobots: counts.get(Number(s.id))?.active ?? 0,
      archived: Boolean(s.archived_at), icon: String(s.icon ?? ""), color: String(s.color ?? "") })),
  };
}

/** One sector's form: its robot types in order (switched-off ones included). null when there is no such (non-demo) sector. */
export async function sectorForm(db: Db, slug: string): Promise<SectorForm | null> {
  const s = parseSectorSlug(slug) ? await sectorBySlug(db, slug) : null;
  if (!s) return null;
  try {
    return { sector: { slug: s.slug, name: s.name, active: s.active }, robots: await readRobots(db, s.id), robotsReady: true };
  } catch (e) {
    if (code(e) !== "42P01") throw e;
    return { sector: { slug: s.slug, name: s.name, active: s.active }, robots: [], robotsReady: false };
  }
}

const duplicate = (name: string) => fail(409, "DUPLICATE", `This sector already has a robot type called "${name}".`);

export type FieldExtras = { slug?: unknown; description?: unknown; icon?: unknown; status?: unknown };
/** Adds a robot type at the end of the sector's list. `extras` (migration 030): a link code typed by the administrator (else made from
 *  the name), a description, an icon and the status it starts with (active or hidden). */
export async function addRobotType(db: Db, adminId: number, sectorSlug: string, rawName: unknown, extras: FieldExtras = {}, adminName = ""): Promise<{ ok: true; robot: RobotType } | Fail> {
  const cleaned = cleanRobotName(rawName);
  if ("error" in cleaned) return fail(400, "VALIDATION_FAILED", cleaned.error);
  const typedSlug = extras.slug === undefined || extras.slug === "" ? null : cleanSlug(extras.slug);
  if (typedSlug && "error" in typedSlug) return fail(400, "VALIDATION_FAILED", typedSlug.error);
  const desc = cleanDescription(extras.description);
  if ("error" in desc) return fail(400, "VALIDATION_FAILED", desc.error);
  const icon = cleanIcon(extras.icon);
  if ("error" in icon) return fail(400, "VALIDATION_FAILED", icon.error);
  const status = extras.status === undefined ? "active" : extras.status;
  if (status !== "active" && status !== "hidden") return fail(400, "VALIDATION_FAILED", "A new field starts as Active or Hidden.");
  const wants030 = Boolean(desc.description || icon.icon || status !== "active");
  try {
    const s = parseSectorSlug(sectorSlug) ? await sectorBySlug(db, sectorSlug) : null;
    if (!s) return NO_SECTOR();
    const have = await db.query("SELECT slug, name, sort_order FROM sector_robot_types WHERE sector_id = $1", [s.id]);
    if (have.rows.length >= ROBOTS_PER_SECTOR) return fail(409, "LIMIT", `A sector can have up to ${ROBOTS_PER_SECTOR} robot types. Rename or switch off one you no longer need.`);
    const key = (n: string) => n.replace(/\s+/g, " ").toLowerCase();
    const same = have.rows.find((r) => key(r.name) === key(cleaned.name));
    if (same) return duplicate(same.name); // name the robot type that is already there, as it is written
    const taken = new Set(have.rows.map((r) => r.slug as string));
    let slug: string;
    if (typedSlug && "slug" in typedSlug) {
      if (taken.has(typedSlug.slug)) return fail(409, "DUPLICATE_SLUG", `This sector already has a field with the link code "${typedSlug.slug}". Choose another one.`);
      slug = typedSlug.slug;
    } else {
      const base = slugFor(cleaned.name);
      slug = base;
      for (let i = 2; taken.has(slug); i++) slug = `${base.slice(0, SLUG_MAX - String(i).length - 1).replace(/-+$/, "")}-${i}`;
    }
    const order = have.rows.reduce((m, r) => Math.max(m, Number(r.sort_order)), 0) + 10;
    let row: any;
    try { // migration 030: the new columns and who added it
      row = (await db.query(
        `INSERT INTO sector_robot_types (sector_id, slug, name, sort_order, updated_by, created_by, description, icon, status, source) VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, 'admin') RETURNING ${COLS_030}`,
        [s.id, slug, cleaned.name, order, adminId, desc.description || null, icon.icon || null, status])).rows[0];
    } catch (e) {
      if (code(e) !== "42703") throw e;
      if (wants030) return NOT_SET_UP_030();
      row = (await db.query(`INSERT INTO sector_robot_types (sector_id, slug, name, sort_order, updated_by) VALUES ($1, $2, $3, $4, $5) RETURNING ${COLS}`,
        [s.id, slug, cleaned.name, order, adminId])).rows[0];
    }
    const robot = toRobot(row);
    await audit(db, { actorId: adminId, actorName: adminName, role: "admin", action: "field_add", targetType: "field", targetId: robot.id,
      meta: { sector: s.slug, name: robot.name, slug: robot.slug, status: robot.status } });
    return { ok: true, robot };
  } catch (e) {
    if (code(e) === "42P01") return NOT_SET_UP();
    if (code(e) === "23505") return constraintOf(e) === "sector_robot_types_name_uq" ? duplicate(cleaned.name) : fail(409, "CONFLICT", "Someone changed this list at the same time. Please try again.");
    throw e;
  }
}

export type FieldEdit = { name?: string; description?: string; icon?: string };
export type RobotChange = { name: string } | { active: boolean } | { move: "up" | "down" } | { status: FieldStatus } | { edit: FieldEdit };

/** Reads exactly one change from a request body: { name } or { active } or { move: "up" | "down" } or (migration 030) { status } or
 *  { edit: { name?, description?, icon? } } (the Edit drawer: any of the three, at least one). */
export function parseRobotChange(b: unknown): RobotChange | null {
  if (!b || typeof b !== "object" || Array.isArray(b)) return null;
  const keys = Object.keys(b as object);
  if (keys.length !== 1) return null;
  const o = b as Record<string, unknown>;
  if (keys[0] === "name" && typeof o.name === "string") return { name: o.name };
  if (keys[0] === "active" && typeof o.active === "boolean") return { active: o.active };
  if (keys[0] === "move" && (o.move === "up" || o.move === "down")) return { move: o.move };
  if (keys[0] === "status" && typeof o.status === "string" && (FIELD_STATUSES as readonly string[]).includes(o.status)) return { status: o.status as FieldStatus };
  if (keys[0] === "edit" && o.edit && typeof o.edit === "object" && !Array.isArray(o.edit)) {
    const e = o.edit as Record<string, unknown>;
    const k = Object.keys(e);
    if (!k.length || k.some((x) => !["name", "description", "icon"].includes(x)) || k.some((x) => typeof e[x] !== "string")) return null;
    return { edit: e as FieldEdit };
  }
  return null;
}

/** Renames, switches on/off, moves, sets the status of (030) or edits (030) one robot type of the sector. Deleting is deleteRobotType. */
export async function changeRobotType(db: Db, adminId: number, sectorSlug: string, robotId: number, change: RobotChange, adminName = ""): Promise<{ ok: true; robots: RobotType[] } | Fail> {
  let cleanName = "";
  const rawName = "name" in change ? change.name : "edit" in change ? change.edit.name : undefined;
  if (rawName !== undefined) {
    const c = cleanRobotName(rawName);
    if ("error" in c) return fail(400, "VALIDATION_FAILED", c.error);
    cleanName = c.name;
  }
  let desc: string | undefined, icon: string | undefined;
  if ("edit" in change && change.edit.description !== undefined) {
    const d = cleanDescription(change.edit.description);
    if ("error" in d) return fail(400, "VALIDATION_FAILED", d.error);
    desc = d.description;
  }
  if ("edit" in change && change.edit.icon !== undefined) {
    const i = cleanIcon(change.edit.icon);
    if ("error" in i) return fail(400, "VALIDATION_FAILED", i.error);
    icon = i.icon;
  }
  const log = (action: string, meta: Record<string, unknown>) =>
    audit(db, { actorId: adminId, actorName: adminName, role: "admin", action, targetType: "field", targetId: robotId, meta: { sector: sectorSlug, ...meta } });
  try {
    const s = parseSectorSlug(sectorSlug) ? await sectorBySlug(db, sectorSlug) : null;
    if (!s) return NO_SECTOR();
    const list = await readRobots(db, s.id);
    const at = list.findIndex((r) => r.id === robotId);
    if (at < 0) return NO_ROBOT(); // also when the id belongs to another sector
    const cur = list[at];
    const key = (n: string) => n.replace(/\s+/g, " ").toLowerCase();
    if (cleanName) {
      const same = list.find((r) => r.id !== robotId && key(r.name) === key(cleanName));
      if (same) return duplicate(same.name);
    }
    if ("name" in change) {
      if (cur.name !== cleanName) {
        await db.query("UPDATE sector_robot_types SET name = $1, updated_at = now(), updated_by = $2 WHERE id = $3 AND sector_id = $4", [cleanName, adminId, robotId, s.id]);
        await log("field_rename", { from: cur.name, to: cleanName, slug: cur.slug });
      }
    } else if ("active" in change) {
      if (cur.active !== change.active) {
        await db.query("UPDATE sector_robot_types SET is_active = $1, updated_at = now(), updated_by = $2 WHERE id = $3 AND sector_id = $4", [change.active, adminId, robotId, s.id]);
        await log("field_status", { name: cur.name, from: cur.status, to: change.active ? "active" : cur.status === "archived" ? "archived" : "hidden" });
      }
    } else if ("status" in change) {
      if (cur.status !== change.status) {
        try {
          await db.query("UPDATE sector_robot_types SET status = $1, updated_at = now(), updated_by = $2 WHERE id = $3 AND sector_id = $4", [change.status, adminId, robotId, s.id]);
        } catch (e) { if (code(e) === "42703") return NOT_SET_UP_030(); throw e; }
        await log(change.status === "archived" ? "field_archive" : cur.status === "archived" ? "field_restore" : "field_status", { name: cur.name, from: cur.status, to: change.status });
      }
    } else if ("edit" in change) {
      const sets: string[] = [], params: unknown[] = [], changed: string[] = [];
      if (cleanName && cleanName !== cur.name) { params.push(cleanName); sets.push(`name = $${params.length}`); changed.push("name"); }
      if (desc !== undefined && desc !== cur.description) { params.push(desc || null); sets.push(`description = $${params.length}`); changed.push("description"); }
      if (icon !== undefined && icon !== cur.icon) { params.push(icon || null); sets.push(`icon = $${params.length}`); changed.push("icon"); }
      if (sets.length) {
        params.push(adminId, robotId, s.id);
        try {
          await db.query(`UPDATE sector_robot_types SET ${sets.join(", ")}, updated_at = now(), updated_by = $${params.length - 2} WHERE id = $${params.length - 1} AND sector_id = $${params.length}`, params);
        } catch (e) { if (code(e) === "42703") return NOT_SET_UP_030(); throw e; }
        await log("field_edit", { name: cleanName || cur.name, changed, ...(changed.includes("name") ? { from: cur.name } : {}) });
      }
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
        await log("field_reorder", { name: cur.name, move: change.move, position: to + 1 });
      }
    }
    return { ok: true, robots: await readRobots(db, s.id) };
  } catch (e) {
    if (code(e) === "42P01") return NOT_SET_UP();
    if (code(e) === "23505") return duplicate(cleanName);
    throw e;
  }
}

/**
 * How many contributions of ANY status (drafts, removed and demo items included) use one field: the current form's choice per sector
 * (025) and Share Your Idea ideas whose current or original version names it (027) or that point at it (030). Deleting needs 0.
 */
export async function fieldUses(db: Db, sector: { id: number; slug: string }, field: { id: number; slug: string }): Promise<number> {
  let n = 0;
  try {
    n += Number((await db.query("SELECT count(DISTINCT contribution_id)::int AS n FROM contribution_scopes WHERE robot_type_id = $1", [field.id])).rows[0]?.n ?? 0);
  } catch (e) { if (!["42P01", "42703"].includes(code(e) ?? "")) throw e; }
  try {
    n += Number((await db.query(
      "SELECT count(*)::int AS n FROM cw_contributions c WHERE ((c.proposed->>'sector') = $1 AND (c.proposed->>'robotType') = $2) OR ((c.original->>'sector') = $1 AND (c.original->>'robotType') = $2)",
      [sector.slug, field.slug])).rows[0]?.n ?? 0);
  } catch (e) { if (!["42P01", "42703"].includes(code(e) ?? "")) throw e; }
  return n;
}

/** How many contributions of ANY status use each field of a sector (field id -> n): what deleting a field has to wait for (Sector Forms). */
export async function fieldAnyUses(db: Db, sector: { id: number; slug: string }): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const add = (id: number, n: number) => out.set(id, (out.get(id) ?? 0) + n);
  try {
    for (const r of (await db.query("SELECT robot_type_id AS id, count(DISTINCT contribution_id)::int AS n FROM contribution_scopes WHERE sector_id = $1 AND robot_type_id IS NOT NULL GROUP BY robot_type_id", [sector.id])).rows) add(Number(r.id), Number(r.n));
  } catch (e) { if (!["42P01", "42703"].includes(code(e) ?? "")) throw e; }
  try {
    for (const r of (await db.query(
      "SELECT r.id, count(DISTINCT c.id)::int AS n FROM sector_robot_types r JOIN cw_contributions c ON " +
      "((c.proposed->>'sector') = $2 AND (c.proposed->>'robotType') = r.slug) OR ((c.original->>'sector') = $2 AND (c.original->>'robotType') = r.slug) " +
      "WHERE r.sector_id = $1 GROUP BY r.id", [sector.id, sector.slug])).rows) add(Number(r.id), Number(r.n));
  } catch (e) { if (!["42P01", "42703"].includes(code(e) ?? "")) throw e; }
  return out;
}

/**
 * Inside the caller's transaction (an Admin approving a member's suggested field, fieldSuggestions.ts; migration 030): adds the field
 * with the source "member" at the end of the sector's list, after the same checks as addRobotType (the per-sector cap, a duplicate
 * name, the link code typed or made from the name). Locks the sector's fields while it checks. Returns the new field's id and link code.
 */
export async function insertSuggestedField(c: Db, o: { sectorId: number; name: string; slug?: unknown; description: string; adminId: number }): Promise<{ ok: true; id: number; slug: string } | Fail> {
  const have = (await c.query("SELECT slug, name, sort_order FROM sector_robot_types WHERE sector_id = $1 FOR UPDATE", [o.sectorId])).rows;
  if (have.length >= ROBOTS_PER_SECTOR) return fail(409, "LIMIT", `A sector can have up to ${ROBOTS_PER_SECTOR} fields. Archive one you no longer need first.`);
  const key = (n: string) => n.replace(/\s+/g, " ").toLowerCase();
  const same = have.find((r) => key(r.name) === key(o.name));
  if (same) return fail(409, "DUPLICATE", `This sector already has a field called "${same.name}". Use Edit & approve to give it another name, or reject it.`);
  const taken = new Set(have.map((r) => String(r.slug)));
  let slug: string;
  if (o.slug !== undefined && o.slug !== "") {
    const t = cleanSlug(o.slug);
    if ("error" in t) return fail(400, "VALIDATION_FAILED", t.error);
    if (taken.has(t.slug)) return fail(409, "DUPLICATE_SLUG", `This sector already has a field with the link code "${t.slug}".`);
    slug = t.slug;
  } else {
    const base = slugFor(o.name);
    slug = base;
    for (let i = 2; taken.has(slug); i++) slug = `${base.slice(0, SLUG_MAX - String(i).length - 1).replace(/-+$/, "")}-${i}`;
  }
  const order = have.reduce((m, r) => Math.max(m, Number(r.sort_order)), 0) + 10;
  const id = Number((await c.query(
    "INSERT INTO sector_robot_types (sector_id, slug, name, sort_order, updated_by, created_by, description, source, status) VALUES ($1, $2, $3, $4, $5, $5, $6, 'member', 'active') RETURNING id",
    [o.sectorId, slug, o.name, order, o.adminId, o.description || null])).rows[0].id);
  return { ok: true, id, slug };
}

/**
 * Deletes one field (robot type) of a sector, only when no contribution of any status uses it and no plugin manages it; otherwise it
 * answers why and offers Archive. The database refuses both cases too. Writes an Audit Log row (030).
 */
export async function deleteRobotType(db: Db, adminId: number, sectorSlug: string, robotId: number, adminName = ""): Promise<{ ok: true; robots: RobotType[] } | Fail> {
  try {
    const s = parseSectorSlug(sectorSlug) ? await sectorBySlug(db, sectorSlug) : null;
    if (!s) return NO_SECTOR();
    const list = await readRobots(db, s.id);
    const cur = list.find((r) => r.id === robotId);
    if (!cur) return NO_ROBOT();
    if (cur.source === "plugin") return fail(409, "PLUGIN_MANAGED", `"${cur.name}" is managed by a plugin (${cur.pluginKey ?? "plugin"}) and cannot be deleted. Hide or archive it instead.`);
    const uses = await fieldUses(db, s, cur);
    if (uses > 0) return fail(409, "IN_USE", `Can't delete "${cur.name}": ${uses} contribution${uses === 1 ? " uses" : "s use"} this field. Archive it instead.`);
    try {
      await db.query("DELETE FROM sector_robot_types WHERE id = $1 AND sector_id = $2", [robotId, s.id]);
    } catch (e) {
      // a contribution or a plugin claimed it in the meantime: the database refused (025's / 030's link, 030's trigger)
      if (code(e) === "23503" || code(e) === "23514") return fail(409, "IN_USE", `Can't delete "${cur.name}" now: something uses it. Archive it instead.`);
      throw e;
    }
    await audit(db, { actorId: adminId, actorName: adminName, role: "admin", action: "field_delete", targetType: "field", targetId: robotId, meta: { sector: s.slug, name: cur.name, slug: cur.slug } });
    return { ok: true, robots: await readRobots(db, s.id) };
  } catch (e) {
    if (code(e) === "42P01") return NOT_SET_UP();
    throw e;
  }
}

/**
 * Contribution Portal: how many contributions chose each robot type (field) of a sector: items sent with the current form
 * (contribution_scopes.robot_type_id, migration 025; drafts, removed and demo items left out) plus Share Your Idea ideas whose current or
 * original version names it (migration 027). A table that does not exist yet simply adds nothing.
 */
export async function fieldUseCounts(db: Db, sectorSlug: string): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const s = parseSectorSlug(sectorSlug) ? await sectorBySlug(db, sectorSlug) : null;
  if (!s) return out;
  const add = (id: number, n: number) => out.set(id, (out.get(id) ?? 0) + n);
  try {
    const { rows } = await db.query(
      "SELECT cs.robot_type_id AS id, count(DISTINCT c.id)::int AS n FROM contribution_scopes cs JOIN contributions c ON c.id = cs.contribution_id " +
      "WHERE cs.sector_id = $1 AND cs.robot_type_id IS NOT NULL AND c.status NOT IN ('draft','removed') AND NOT c.is_demo GROUP BY cs.robot_type_id", [s.id]);
    for (const r of rows) add(Number(r.id), Number(r.n));
  } catch (e) { if (!["42P01", "42703"].includes(code(e) ?? "")) throw e; }
  try {
    const { rows } = await db.query(
      "SELECT r.id, count(DISTINCT c.id)::int AS n FROM sector_robot_types r JOIN cw_contributions c ON " +
      "((c.proposed->>'sector') = $2 AND (c.proposed->>'robotType') = r.slug) OR ((c.original->>'sector') = $2 AND (c.original->>'robotType') = r.slug) " +
      "WHERE r.sector_id = $1 GROUP BY r.id", [s.id, s.slug]);
    for (const r of rows) add(Number(r.id), Number(r.n));
  } catch (e) { if (!["42P01", "42703"].includes(code(e) ?? "")) throw e; }
  return out;
}
