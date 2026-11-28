// Contribution Portal: Admin > Sectors changes (administrators only; the routes call requireAdmin and this file checks the role again).
//   * add      a new sector at the end of the list; the link code (slug) is made from the name (or typed), unique, and never changes;
//   * rename   the name only (links keep working);
//   * move     one place up or down (the list is renumbered 10, 20, 30 ...; demo sectors are not touched);
//   * style    an icon (a short symbol) and a colour (#RRGGBB) for its card (migration 030);
//   * archive  out of every list members see and of the Contribute form (is_active = false, archived_at set; migration 030). Refused
//              while contributions in the sector still wait for a decision, so no queue becomes unreachable. Its contributions and
//              published ideas stay. Restore brings it back.
// Every change writes an Audit Log row (030; skipped before it). Sectors are never deleted.
import { audit } from "./portalAudit";
import { slugFor } from "./sectorForms";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
type Pool = Db & { connect: () => Promise<Db & { release: () => void }> };
export type Fail = { ok: false; status: number; error: string; message: string };
const fail = (status: number, error: string, message: string): Fail => ({ ok: false, status, error, message });
const code = (e: unknown) => (e as { code?: string } | null)?.code ?? "";
const missing = (e: unknown) => ["42P01", "42703"].includes(code(e));
const NOT_SET_UP_030 = (): Fail => fail(503, "NOT_SET_UP", "Sector icons, colours and archiving are not set up on this database yet (migration 030 is needed).");
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SECTOR_NAME_MAX = 100;
export type SectorChange = { name: string } | { move: "up" | "down" } | { archived: boolean } | { style: { icon?: string; color?: string } };

/** A sector name as stored: spaces collapsed, 2 to 100 characters, a letter or digit, no < or >. */
export function cleanSectorName(v: unknown): { name: string } | { error: string } {
  if (typeof v !== "string") return { error: "Type the sector's name." };
  if (/[\u0000-\u001F\u007F]/.test(v)) return { error: "The name cannot contain line breaks or control characters." };
  const name = v.normalize("NFC").replace(/\s+/g, " ").trim();
  if ([...name].length < 2) return { error: "The name needs at least 2 characters." };
  if ([...name].length > SECTOR_NAME_MAX) return { error: `The name can have up to ${SECTOR_NAME_MAX} characters.` };
  if (!/[\p{L}\p{N}]/u.test(name) || /[<>]/.test(name)) return { error: "The name needs a letter or number and cannot contain < or >." };
  return { name };
}
const cleanColor = (v: unknown): string | null | { error: string } => {
  if (v === undefined || v === null || v === "") return null;
  return typeof v === "string" && /^#[0-9A-Fa-f]{6}$/.test(v.trim()) ? v.trim().toUpperCase() : { error: "The colour must look like #1F7A5C." };
};
const cleanIcon = (v: unknown): string | null | { error: string } => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return { error: "The icon must be a short symbol, for example an emoji." };
  const i = v.normalize("NFC").trim();
  return !i ? null : i.length > 8 || /[\s<>&"]/.test(i) ? { error: "The icon must be a short symbol (up to 8 characters), for example an emoji." } : i;
};

/** Reads exactly one change from a request body, or null. */
export function parseSectorChange(b: unknown): SectorChange | null {
  if (!b || typeof b !== "object" || Array.isArray(b)) return null;
  const o = b as Record<string, unknown>;
  const k = Object.keys(o);
  if (k.length !== 1) return null;
  if (k[0] === "name" && typeof o.name === "string") return { name: o.name };
  if (k[0] === "move" && (o.move === "up" || o.move === "down")) return { move: o.move };
  if (k[0] === "archived" && typeof o.archived === "boolean") return { archived: o.archived };
  if (k[0] === "style" && o.style && typeof o.style === "object" && !Array.isArray(o.style)) {
    const st = o.style as Record<string, unknown>;
    if (Object.keys(st).some((x) => !["icon", "color"].includes(x) || (st[x] !== null && typeof st[x] !== "string"))) return null;
    return { style: st as { icon?: string; color?: string } };
  }
  return null;
}

async function isAdmin(db: Db, id: number) {
  return Boolean((await db.query("SELECT 1 FROM users WHERE id = $1 AND role = 'admin'", [id])).rows[0]);
}
/** How many contributions in a sector still wait for a decision (both kinds; drafts, demo and decided ones left out). */
export async function waitingIn(db: Db, sector: { id: number; slug: string }): Promise<number> {
  let n = 0;
  try {
    n += Number((await db.query(
      "SELECT count(DISTINCT c.id)::int AS n FROM contributions c JOIN contribution_scopes cs ON cs.contribution_id = c.id WHERE cs.sector_id = $1 AND c.status IN ('pending_review', 'changes_requested') AND NOT c.is_demo",
      [sector.id])).rows[0]?.n ?? 0);
  } catch (e) { if (!missing(e)) throw e; }
  try {
    n += Number((await db.query(
      "SELECT count(*)::int AS n FROM cw_contributions WHERE proposed->>'sector' = $1 AND status IN ('submitted', 'under_review', 'draft', 'approved', 'pending', 'changes_requested', 'resubmitted', 'publishing', 'failed')",
      [sector.slug])).rows[0]?.n ?? 0);
  } catch (e) { if (!missing(e)) throw e; }
  return n;
}

/** Adds a sector at the end of the list. */
export async function addSector(pool: Pool, admin: { id: number; name: string }, b: { name?: unknown; slug?: unknown; icon?: unknown; color?: unknown }):
  Promise<{ ok: true; sector: { slug: string; name: string } } | Fail> {
  const nm = cleanSectorName(b.name);
  if ("error" in nm) return fail(400, "VALIDATION_FAILED", nm.error);
  const icon = cleanIcon(b.icon), color = cleanColor(b.color);
  if (icon && typeof icon === "object") return fail(400, "VALIDATION_FAILED", icon.error);
  if (color && typeof color === "object") return fail(400, "VALIDATION_FAILED", color.error);
  let typed: string | null = null;
  if (b.slug !== undefined && b.slug !== "") {
    if (typeof b.slug !== "string" || b.slug.length > 60 || !SLUG.test(b.slug)) return fail(400, "VALIDATION_FAILED", "The link code can use lower-case letters, digits and single hyphens (up to 60 characters).");
    typed = b.slug;
  }
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    if (!(await isAdmin(c, admin.id))) { await c.query("ROLLBACK"); return fail(403, "FORBIDDEN", "You do not have access to this."); }
    const all = (await c.query("SELECT slug, name, sort_order FROM sectors FOR UPDATE")).rows;
    const same = all.find((s) => String(s.name).replace(/\s+/g, " ").toLowerCase() === nm.name.toLowerCase());
    if (same) { await c.query("ROLLBACK"); return fail(409, "DUPLICATE", `There is already a sector called "${same.name}".`); }
    const taken = new Set(all.map((s) => String(s.slug)));
    let slug = typed ?? slugFor(nm.name).replace(/^robot$/, "sector");
    if (typed && taken.has(typed)) { await c.query("ROLLBACK"); return fail(409, "DUPLICATE_SLUG", `The link code "${typed}" is already used by another sector.`); }
    for (let i = 2, base = slug; taken.has(slug); i++) slug = `${base.slice(0, 60 - String(i).length - 1).replace(/-+$/, "")}-${i}`;
    const order = all.reduce((m, s) => Math.max(m, Number(s.sort_order)), 0) + 10;
    let id: number;
    if (icon || color) {
      try {
        id = Number((await c.query("INSERT INTO sectors (slug, name, sort_order, icon, color) VALUES ($1, $2, $3, $4, $5) RETURNING id", [slug, nm.name, order, icon, color])).rows[0].id);
      } catch (e) {
        if (missing(e)) { await c.query("ROLLBACK"); return NOT_SET_UP_030(); }
        throw e;
      }
    } else {
      id = Number((await c.query("INSERT INTO sectors (slug, name, sort_order) VALUES ($1, $2, $3) RETURNING id", [slug, nm.name, order])).rows[0].id);
    }
    await audit(c, { actorId: admin.id, actorName: admin.name, role: "admin", action: "sector_add", targetType: "sector", targetId: id, meta: { slug, name: nm.name } }, true);
    await c.query("COMMIT");
    return { ok: true, sector: { slug, name: nm.name } };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    if (code(e) === "23505") return fail(409, "DUPLICATE_SLUG", "Another sector was added with that link code at the same time. Please try again.");
    throw e;
  } finally {
    c.release();
  }
}

/** Renames, moves, styles, archives or restores one (non-demo) sector. */
export async function changeSector(pool: Pool, admin: { id: number; name: string }, slug: string, change: SectorChange): Promise<{ ok: true; message: string } | Fail> {
  if (!SLUG.test(slug) || slug.length > 60) return fail(404, "NOT_FOUND", "We could not find that sector.");
  let newName = "";
  if ("name" in change) {
    const nm = cleanSectorName(change.name);
    if ("error" in nm) return fail(400, "VALIDATION_FAILED", nm.error);
    newName = nm.name;
  }
  const c = await pool.connect();
  const log = (action: string, id: number, meta: Record<string, unknown>) =>
    audit(c, { actorId: admin.id, actorName: admin.name, role: "admin", action, targetType: "sector", targetId: id, meta: { slug, ...meta } }, true);
  try {
    await c.query("BEGIN");
    if (!(await isAdmin(c, admin.id))) { await c.query("ROLLBACK"); return fail(403, "FORBIDDEN", "You do not have access to this."); }
    const list = (await c.query("SELECT id, slug, name, sort_order, is_active FROM sectors WHERE NOT is_demo ORDER BY sort_order, name FOR UPDATE")).rows;
    const at = list.findIndex((s) => s.slug === slug);
    if (at < 0) { await c.query("ROLLBACK"); return fail(404, "NOT_FOUND", "We could not find that sector."); }
    const cur = list[at];
    const id = Number(cur.id);
    let message = "Saved.";
    if ("name" in change) {
      const same = list.find((s) => s.slug !== slug && String(s.name).replace(/\s+/g, " ").toLowerCase() === newName.toLowerCase());
      if (same) { await c.query("ROLLBACK"); return fail(409, "DUPLICATE", `There is already a sector called "${same.name}".`); }
      if (newName !== cur.name) {
        await c.query("UPDATE sectors SET name = $2 WHERE id = $1", [id, newName]);
        await log("sector_rename", id, { from: cur.name, to: newName });
      }
      message = `Renamed to "${newName}". Its link code stays "${slug}".`;
    } else if ("move" in change) {
      const to = change.move === "up" ? at - 1 : at + 1;
      if (to >= 0 && to < list.length) {
        const ids = list.map((s) => Number(s.id));
        [ids[at], ids[to]] = [ids[to], ids[at]];
        await c.query("UPDATE sectors s SET sort_order = v.o FROM unnest($1::int[], $2::int[]) AS v(id, o) WHERE s.id = v.id", [ids, ids.map((_, i) => (i + 1) * 10)]);
        await log("sector_reorder", id, { name: cur.name, move: change.move, position: to + 1 });
      }
      message = "Moved.";
    } else if ("archived" in change) {
      if (change.archived) {
        const waiting = await waitingIn(c, { id, slug });
        if (waiting > 0) { await c.query("ROLLBACK"); return fail(409, "STILL_WAITING", `${waiting} contribution${waiting === 1 ? " in this sector is" : "s in this sector are"} still waiting for a decision. Decide ${waiting === 1 ? "it" : "them"} first, then archive the sector.`); }
        await c.query("UPDATE sectors SET archived_at = now(), is_active = false WHERE id = $1", [id]);
        await log("sector_archive", id, { name: cur.name });
        message = `"${cur.name}" is archived: members no longer see it. Its contributions stay.`;
      } else {
        await c.query("UPDATE sectors SET archived_at = NULL, is_active = true WHERE id = $1", [id]);
        await log("sector_restore", id, { name: cur.name });
        message = `"${cur.name}" is back for members.`;
      }
    } else {
      const icon = cleanIcon(change.style.icon), color = cleanColor(change.style.color);
      if (icon && typeof icon === "object") { await c.query("ROLLBACK"); return fail(400, "VALIDATION_FAILED", icon.error); }
      if (color && typeof color === "object") { await c.query("ROLLBACK"); return fail(400, "VALIDATION_FAILED", color.error); }
      const sets: string[] = [], params: unknown[] = [id];
      if ("icon" in change.style) { params.push(icon); sets.push(`icon = $${params.length}`); }
      if ("color" in change.style) { params.push(color); sets.push(`color = $${params.length}`); }
      if (sets.length) {
        await c.query(`UPDATE sectors SET ${sets.join(", ")} WHERE id = $1`, params);
        await log("sector_style", id, { name: cur.name, icon, color });
      }
      message = "The sector's card is updated.";
    }
    await c.query("COMMIT");
    return { ok: true, message };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    if (missing(e)) return NOT_SET_UP_030();
    throw e;
  } finally {
    c.release();
  }
}
