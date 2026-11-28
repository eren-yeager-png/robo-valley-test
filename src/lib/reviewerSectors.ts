// Contribution Portal (migration 030): the sectors a moderator reviews, set by an administrator in Users & Roles.
//   * No row for a moderator = every sector, exactly as before 030 (and on a database without 030).
//   * Administrators are never limited.
//   * Enforced by the server: guardReviewer reads the list on every reviewing request, and each route checks the item's sectors before
//     showing or changing it (an item sent with the current form can be in several sectors: one of them is enough). An idea whose
//     sector is "Not sure" is reviewed by the moderators who are not limited (and by administrators).
//   * Only administrators change the list (requireAdmin in the route, and checked again here); every change writes an Audit Log row.
import { audit } from "./portalAudit";
import { reviewerOf } from "./moderators";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
type Pool = Db & { connect: () => Promise<Db & { release: () => void }> };
export type Fail = { ok: false; status: number; error: string; message: string };
const fail = (status: number, error: string, message: string): Fail => ({ ok: false, status, error, message });
const missing = (e: unknown) => ["42P01", "42703"].includes((e as { code?: string } | null)?.code ?? "");
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_SECTORS = 50;
export const NOT_YOUR_SECTOR: Fail = fail(403, "NOT_YOUR_SECTOR", "This contribution is in a sector you do not review. An administrator can change your sectors in Users & Roles.");

/** null = every sector; otherwise the sector slugs this reviewer reviews. */
export async function reviewerSectors(db: Db, userId: number, isAdmin: boolean): Promise<string[] | null> {
  if (isAdmin) return null;
  try {
    const { rows } = await db.query(
      "SELECT s.slug FROM moderator_sectors m JOIN sectors s ON s.id = m.sector_id WHERE m.user_id = $1 ORDER BY s.sort_order, s.slug", [userId]);
    return rows.length ? rows.map((r) => String(r.slug)) : null;
  } catch (e) {
    if (missing(e)) return null; // 030 not applied: every moderator reviews every sector, as before
    throw e;
  }
}

/** May a reviewer with these sectors (null = all) act on an item in these sectors? */
export const mayReview = (allowed: string[] | null, sectors: string[]) => allowed === null || sectors.some((s) => allowed.includes(s));

/** The sectors of an item sent with the current form ([] when there is no such item). */
export async function formItemSectors(db: Db, id: number): Promise<string[]> {
  const { rows } = await db.query("SELECT s.slug FROM contribution_scopes cs JOIN sectors s ON s.id = cs.sector_id WHERE cs.contribution_id = $1", [id]);
  return rows.map((r) => String(r.slug));
}
/** The sector of a Share Your Idea idea (its current version), or null when there is no such idea (or the workflow is not set up). */
export async function ideaSector(db: Db, id: number): Promise<string | null> {
  try {
    const { rows } = await db.query("SELECT proposed->>'sector' AS sector FROM cw_contributions WHERE id = $1", [id]);
    return rows[0] ? String(rows[0].sector ?? "") : null;
  } catch (e) {
    if (missing(e)) return null;
    throw e;
  }
}
/** For a reviewing route: null when this reviewer may handle that item (or it does not exist: the route answers 404 itself). */
export async function scopeProblem(db: Db, g: { sectors: string[] | null }, item: { form?: number; idea?: number }): Promise<Fail | null> {
  if (g.sectors === null) return null;
  if (item.form !== undefined) {
    const s = await formItemSectors(db, item.form);
    return s.length === 0 || mayReview(g.sectors, s) ? null : NOT_YOUR_SECTOR;
  }
  if (item.idea !== undefined) {
    const s = await ideaSector(db, item.idea);
    return s === null || mayReview(g.sectors, [s]) ? null : NOT_YOUR_SECTOR;
  }
  return null;
}

/** Users & Roles: every limited moderator's sectors (user id -> [{ slug, name }]). ready = false before 030. */
export async function moderatorSectorMap(db: Db): Promise<{ ready: boolean; map: Map<string, { slug: string; name: string }[]> }> {
  const map = new Map<string, { slug: string; name: string }[]>();
  try {
    const { rows } = await db.query(
      "SELECT m.user_id, s.slug, s.name FROM moderator_sectors m JOIN sectors s ON s.id = m.sector_id ORDER BY m.user_id, s.sort_order, s.name");
    for (const r of rows) map.set(String(r.user_id), [...(map.get(String(r.user_id)) ?? []), { slug: String(r.slug), name: String(r.name) }]);
    return { ready: true, map };
  } catch (e) {
    if (missing(e)) return { ready: false, map };
    throw e;
  }
}

/** A list of sector slugs from a request body, or null when it is not one. */
export function parseSectorList(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > MAX_SECTORS) return null;
  const out: string[] = [];
  for (const s of v) {
    if (typeof s !== "string" || s.length > 60 || !SLUG.test(s)) return null;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** Sets the sectors a moderator reviews ([] = every sector). Administrators only; one transaction with its Audit Log row. */
export async function setReviewerSectors(pool: Pool, admin: { id: number; name: string }, userId: number, slugs: string[]):
  Promise<{ ok: true; sectors: { slug: string; name: string }[] } | Fail> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const a = (await c.query("SELECT 1 FROM users WHERE id = $1 AND role = 'admin'", [admin.id])).rows[0];
    if (!a) { await c.query("ROLLBACK"); return fail(403, "FORBIDDEN", "You do not have access to this."); }
    const u = (await c.query("SELECT full_name FROM users WHERE id = $1", [userId])).rows[0];
    if (!u) { await c.query("ROLLBACK"); return fail(404, "NOT_FOUND", "No such user."); }
    const r = await reviewerOf(c, userId); // the moderator flag is read in moderators.ts only
    if (r.ok && r.isAdmin) { await c.query("ROLLBACK"); return fail(400, "ADMIN_ALL_SECTORS", "Administrators review every sector."); }
    if (!r.ok || !r.isModerator) { await c.query("ROLLBACK"); return fail(400, "NOT_MODERATOR", "Make this person a moderator first."); }
    const found = slugs.length ? (await c.query("SELECT id, slug, name FROM sectors WHERE slug = ANY($1::varchar[]) AND NOT is_demo ORDER BY sort_order, name", [slugs])).rows : [];
    if (found.length !== slugs.length) { await c.query("ROLLBACK"); return fail(400, "VALIDATION_FAILED", "One of those sectors does not exist."); }
    await c.query("DELETE FROM moderator_sectors WHERE user_id = $1", [userId]);
    for (const s of found) await c.query("INSERT INTO moderator_sectors (user_id, sector_id, created_by) VALUES ($1, $2, $3)", [userId, s.id, admin.id]);
    await audit(c, { actorId: admin.id, actorName: admin.name, role: "admin", action: "moderator_sectors", targetType: "user", targetId: userId,
      meta: { person: String(u.full_name ?? ""), sectors: found.map((s) => String(s.slug)), all: found.length === 0 } }, true);
    await c.query("COMMIT");
    return { ok: true, sectors: found.map((s) => ({ slug: String(s.slug), name: String(s.name) })) };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    if (missing(e)) return fail(503, "NOT_SET_UP", "Moderators per sector are not set up on this database yet (migration 030 is needed).");
    throw e;
  } finally {
    c.release();
  }
}
