// The contributor's side of the Contribute pages: save a draft, edit, submit, delete a draft, add or remove one photo, and read
// your own contribution. EVERY query is tied to the signed-in owner (user_id = $owner): nobody can read or change someone else's.
// The wizard's extra fields (how it is done now, who is affected, time or cost, what should improve, role, district) are stored in the
// body as titled sections, so the tables from migrations 012 to 014 are enough. Status rules (who may move an item where) are in
// OWNER_RULES below and in the pull request description; the moderator's moves are in contributionReview.ts.
// Portal PR2: the form also sends `directory` (structured categories, src/lib/directoryCategories.ts); it is checked here and saved in
// the same transaction as the item, and your own item comes back with it (and the description without the folded copy) for Edit.
import { createHash } from "node:crypto";
import { addPhoto, detectPhotoMime, listPhotoMeta, validatePhoto, type PhotoMeta } from "./contributionPhotos";
import { readShareChoice, removeContact, readContact, saveContact, saveShareChoice, shareChoiceOf, validateContact, type Contact } from "./contributionContacts";
import { CONTRIBUTION_LIMITS, FORM_TYPE_IDS, contributionDbError, typeChosenSql, validateContribution, type ContributionStatus } from "./contributions";
import { stripPhotoMetadata } from "./photoClean";
import { applyRobots, fromRobotPageOf, planRobots, readFromRobotPage, readRobots, robotsOf, saveFromRobotPage } from "./contributionRobots";
import { hasControlChars, type FieldErrors } from "./validation";
import { directoryFor, readDirectory, saveDirectory, splitFold, type DirectoryEntry } from "./directoryCategories";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
type Pool = Db & { connect: () => Promise<Db & { release: () => void }> };

export const SECTION_LIMIT = 800; // each optional section
export const SECTIONS = [
  ["howNow", "How it is done now"], ["affected", "Who is affected"], ["timeCost", "Time or cost"], ["improvement", "What should improve"], ["role", "Role"], ["district", "District"],
] as const;
export type SectionKey = (typeof SECTIONS)[number][0];
export type Fields = { type: string; robotType: string; sectors: string[]; title: string; description: string } & Record<SectionKey, string>;

const oneLine = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
const multi = (s: unknown) => (typeof s === "string" ? s.replace(/\r\n/g, "\n").trim() : "");

/** Reads the fields from a request body (anything unknown is ignored). */
export function readFields(raw: unknown): Fields {
  const o = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const f: Fields = { type: oneLine(o.type), robotType: oneLine(o.robotType), sectors: Array.isArray(o.sectors) ? o.sectors.map(oneLine) : [], title: oneLine(o.title), description: multi(o.description), howNow: "", affected: "", timeCost: "", improvement: "", role: "", district: "" };
  for (const [k] of SECTIONS) f[k] = k === "role" || k === "district" ? oneLine(o[k]) : multi(o[k]);
  return f;
}

/** Puts the description and the filled sections together as the stored body. */
export function composeBody(f: Fields): string {
  const parts = [f.description];
  for (const [k, label] of SECTIONS) if (f[k]) parts.push(`## ${label}\n${f[k]}`);
  return parts.join("\n\n");
}
/** The reverse: the description and the sections out of a stored body (for editing). */
export function splitBody(body: string): { description: string } & Record<SectionKey, string> {
  const out = { description: "", howNow: "", affected: "", timeCost: "", improvement: "", role: "", district: "" } as { description: string } & Record<SectionKey, string>;
  const labelOf = new Map<string, SectionKey>(SECTIONS.map(([k, l]) => [l, k]));
  let cur: SectionKey | "description" = "description";
  const buf: Record<string, string[]> = { description: [] };
  for (const line of body.split("\n")) {
    const m = /^## (.+)$/.exec(line);
    if (m && labelOf.has(m[1])) { cur = labelOf.get(m[1])!; buf[cur] = buf[cur] ?? []; continue; }
    (buf[cur] = buf[cur] ?? []).push(line);
  }
  for (const k of Object.keys(buf)) (out as any)[k] = buf[k].join("\n").trim();
  return out;
}

export type Fail = { ok: false; status: number; error: string; message: string; fieldErrors?: FieldErrors };
export type Ok<T> = { ok: true } & T;
const errorsOf = (r: unknown) => (r as { errors: FieldErrors }).errors;
const fail = (status: number, error: string, message: string, fieldErrors?: FieldErrors): Fail => ({ ok: false, status, error, message, ...(fieldErrors ? { fieldErrors } : {}) });
const VALIDATION = "Please fix the highlighted fields.";
const NOT_FOUND = fail(404, "NOT_FOUND", "We could not find that contribution.");

/** What the owner may do in each status. "edit" says what happens to the status when the owner saves a change. */
export const OWNER_RULES: Record<ContributionStatus | "rejected" | "unpublished", { edit: ContributionStatus | "rejected" | "unpublished" | null; submit: boolean; deleteIt: boolean }> = {
  draft: { edit: "draft", submit: true, deleteIt: true },
  changes_requested: { edit: "changes_requested", submit: true, deleteIt: false },
  pending_review: { edit: "pending_review", submit: false, deleteIt: false },
  published: { edit: null, submit: false, deleteIt: false }, // read-only for the owner (owner decision 16-11-2026): no edit, photo or contact change
  unpublished: { edit: null, submit: false, deleteIt: false }, // read-only too: taken down by an administrator, the owner cannot change or resend it
  rejected: { edit: null, submit: false, deleteIt: false }, // final: the author starts a new contribution instead
  removed: { edit: null, submit: false, deleteIt: false }, // final: removed by an administrator as a duplicate or unsuitable
};
/** The statuses in which the owner may still change a contribution (the form, its photos and its contact details). */
export const EDITABLE_STATUSES = (Object.keys(OWNER_RULES) as (keyof typeof OWNER_RULES)[]).filter((s) => OWNER_RULES[s].edit !== null);

/** Why the owner cannot change this contribution any more, in words for the member. */
export function notEditable(status: string): Fail {
  if (status === "published") return fail(409, "NOT_EDITABLE", "This contribution is published, so it can no longer be changed. To add something, start a new contribution.");
  if (status === "unpublished") return fail(409, "NOT_EDITABLE", "This contribution was taken down by an administrator, so it can no longer be changed. You can start a new one.");
  return fail(409, "NOT_EDITABLE", "This contribution was closed by a moderator, so it cannot be changed. You can start a new one.");
}

/** The owner's contribution status, for the checks before a change (null = not yours or not there). */
async function ownStatus(db: Db, ownerId: number, id: number): Promise<string | null> {
  const { rows } = await db.query("SELECT status FROM contributions WHERE id = $1 AND user_id = $2", [id, ownerId]);
  return rows[0] ? String(rows[0].status) : null;
}

export async function activeSectorSlugs(db: Db): Promise<string[]> {
  const { rows } = await db.query("SELECT slug FROM sectors WHERE is_active AND NOT is_demo");
  return rows.map((r) => r.slug);
}

function checkFields(f: Fields, sectors: string[], forSubmit: boolean): { ok: true; value: ReturnType<typeof composeInput> } | Fail {
  const errors: FieldErrors = {};
  if (f.description.length < CONTRIBUTION_LIMITS.bodyMin) errors.description = `Tell us a little more (at least ${CONTRIBUTION_LIMITS.bodyMin} characters).`;
  else if (f.description.length > 2000) errors.description = "Keep the description to 2000 characters or fewer.";
  else if (/^## /m.test(f.description) || hasControlChars(f.description.replace(/\n/g, " "))) errors.description = "The description has characters that are not allowed.";
  for (const [k, label] of SECTIONS) {
    const v = f[k];
    if (v.length > SECTION_LIMIT) errors[k] = `Keep "${label}" to ${SECTION_LIMIT} characters or fewer.`;
    else if (v && (/^## /m.test(v) || hasControlChars(v.replace(/\n/g, " ")))) errors[k] = `"${label}" has characters that are not allowed.`;
  }
  const v = validateContribution({ type: f.type, robotType: f.robotType, title: f.title, body: composeBody(f), sectors: f.sectors }, sectors, { forSubmit });
  if (!v.ok) for (const [k, m] of Object.entries(errorsOf(v))) errors[k === "body" ? "description" : k] = errors[k === "body" ? "description" : k] ?? m;
  if (Object.keys(errors).length) return fail(400, "VALIDATION_FAILED", VALIDATION, errors);
  return { ok: true, value: composeInput(f, (v as { ok: true; value: { sectors: string[] } }).value.sectors) };
}
const composeInput = (f: Fields, sectors: string[]) => ({ type: f.type, robotType: f.robotType || null, title: f.title, body: composeBody(f), sectors });

/** The same words from anybody in the last 24 hours: a copy, not a new contribution. */
async function isDuplicate(db: Db, title: string, body: string, exceptId: number): Promise<boolean> {
  const { rows } = await db.query(
    "SELECT 1 FROM contributions WHERE lower(btrim(title)) = lower($1) AND lower(btrim(body)) = lower($2) AND id <> $3 AND created_at > now() - interval '24 hours' LIMIT 1",
    [title, body, exceptId]);
  return rows.length > 0;
}
const DUPLICATE = () => fail(409, "DUPLICATE", "This looks the same as something that was already sent. If it is yours, find it under Your contributions.");
/** Migration 018's safeguard: a live contribution with the same normalised title already exists in one of the chosen sectors. */
const SAME_TITLE = () => fail(409, "DUPLICATE", "Something with the same title is already waiting or published in this sector. Please check it, or give yours a clearer title.", { title: "This title is already used in this sector." });
const titleTaken = (e: unknown) => (e as { code?: string })?.code === "23505" && /contribution_title_keys/.test(String((e as { constraint?: string })?.constraint ?? (e as Error)?.message ?? ""));

/**
 * Where the contribution was started (migration 022): true only when the form was opened from a sector page ("Contribute to this
 * sector") and said so with exactly true. Read only when the contribution is created; an edit never changes it.
 */
export function readFromSectorPage(raw: unknown): boolean {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw as Record<string, unknown>).fromSectorPage === true;
}
/** Marks a just-created contribution as started from a sector page. Before migration 022 the column is missing: nothing is saved. */
async function saveFromSectorPage(db: Db, id: number, ownerId: number): Promise<void> {
  await db.query("SAVEPOINT rv_origin");
  try {
    await db.query("UPDATE contributions SET from_sector_page = true WHERE id = $1 AND user_id = $2", [id, ownerId]);
    await db.query("RELEASE SAVEPOINT rv_origin");
  } catch (e) {
    await db.query("ROLLBACK TO SAVEPOINT rv_origin");
    if ((e as { code?: string })?.code !== "42703") throw e;
  }
}
/** For Edit: true when the owner started this contribution from a sector page (false before migration 022). */
async function fromSectorPageOf(db: Db, id: number, ownerId: number): Promise<boolean> {
  try {
    const { rows } = await db.query("SELECT from_sector_page AS f FROM contributions WHERE id = $1 AND user_id = $2", [id, ownerId]);
    return rows[0]?.f === true;
  } catch (e) {
    if ((e as { code?: string })?.code === "42703") return false;
    throw e;
  }
}

/**
 * P1 (plugin 0.1.10): the form asked "What would you like to share?" and says so with typeChosen exactly true. Then the type must be
 * one of the form's three (problem, improve, resource). Absent: an older form, which did not ask (it always sends 'resource').
 */
export function readTypeChosen(raw: unknown): boolean {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw as Record<string, unknown>).typeChosen === true;
}
const CHOOSE_TYPE = "Choose what you would like to share: a problem, an idea, or a video or resource.";
/** Marks the type as chosen by the member (migration 023). Before 023 the column is missing: the type itself is still saved. */
async function saveTypeChosen(db: Db, id: number, ownerId: number): Promise<void> {
  await db.query("SAVEPOINT rv_type");
  try {
    await db.query("UPDATE contributions SET type_chosen = true WHERE id = $1 AND user_id = $2", [id, ownerId]);
    await db.query("RELEASE SAVEPOINT rv_type");
  } catch (e) {
    await db.query("ROLLBACK TO SAVEPOINT rv_type");
    if ((e as { code?: string })?.code !== "42703") throw e;
  }
}

const notSet = (e: unknown): Fail | null => ((e as { code?: string })?.code === "42P01" || (e as { code?: string })?.code === "42703" ? fail(503, "NOT_SET_UP", "Contributions are not set up yet.") : null);

/** Creates a draft (id undefined) or saves a change to your own contribution. */
export async function saveOwn(pool: Pool, ownerId: number, raw: unknown, id?: number): Promise<Ok<{ id: number; status: string }> | Fail> {
  const f = readFields(raw);
  const dir = readDirectory(typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>).directory : undefined);
  if (dir.present && !dir.ok) return fail(400, "VALIDATION_FAILED", VALIDATION, { directory: (dir as { message: string }).message });
  const share = readShareChoice(raw); // item 3: "Let moderators contact me using my profile details" (absent = an older form: unchanged)
  const typeChosen = readTypeChosen(raw); // P1: the member picked the type in the form (0.1.10 or later)
  const robots = readRobots(raw); // P3: the robot per chosen sector (0.1.11 or later); absent = an older form: the saved ones stay
  if ("error" in robots) return fail(400, "VALIDATION_FAILED", VALIDATION, { robots: robots.error });
  if (typeChosen && !FORM_TYPE_IDS.includes(f.type)) return fail(400, "VALIDATION_FAILED", VALIDATION, { type: CHOOSE_TYPE });
  const client = await pool.connect();
  try {
    const slugs = await activeSectorSlugs(client);
    await client.query("BEGIN");
    let status: string = "draft", cur: { status: string; type: string; type_chosen: boolean } | undefined;
    if (id !== undefined) {
      const { rows } = await client.query("SELECT status, type, " + typeChosenSql("contributions") + " AS type_chosen FROM contributions WHERE id = $1 AND user_id = $2 FOR UPDATE", [id, ownerId]);
      cur = rows[0];
      if (!cur) { await client.query("ROLLBACK"); return NOT_FOUND; }
      const rule = OWNER_RULES[cur.status as keyof typeof OWNER_RULES];
      if (!rule || rule.edit === null) { await client.query("ROLLBACK"); return notEditable(cur.status); }
      status = rule.edit;
      // Edit keeps the type the member chose: a form older than 0.1.10 (which always sends 'resource') never changes it
      if (!typeChosen && cur.type_chosen === true) f.type = cur.type;
    }
    const checked = checkFields(f, slugs, status !== "draft");
    if (!checked.ok) { await client.query("ROLLBACK"); return checked as Fail; }
    const v = (checked as { value: ReturnType<typeof composeInput> }).value;
    if (await isDuplicate(client, v.title, v.body, id ?? 0)) { await client.query("ROLLBACK"); return DUPLICATE(); }
    let cid = id ?? 0;
    if (id === undefined) {
      const ins = await client.query("INSERT INTO contributions (user_id, type, robot_type, title, body) VALUES ($1,$2,$3,$4,$5) RETURNING id", [ownerId, v.type, v.robotType, v.title, v.body]);
      cid = Number(ins.rows[0].id);
      if (readFromSectorPage(raw)) await saveFromSectorPage(client, cid, ownerId); // once, at creation
      if (typeChosen) await saveTypeChosen(client, cid, ownerId);
      if (readFromRobotPage(raw)) await saveFromRobotPage(client, cid, ownerId); // once, at creation
    } else {
      const backToReview = status === "pending_review" && cur!.status !== "pending_review";
      await client.query(
        "UPDATE contributions SET type=$3, robot_type=$4, title=$5, body=$6, status=$7::varchar, published_at = CASE WHEN $7::varchar = 'published' THEN published_at END, updated_at = now() WHERE id = $1 AND user_id = $2",
        [cid, ownerId, v.type, v.robotType, v.title, v.body, status]);
      void backToReview;
      if (typeChosen) await saveTypeChosen(client, cid, ownerId); // an older contribution gets its type once the member picks one in Edit
    }
    // new sectors first, then remove the ones no longer chosen: a submitted item must always keep at least one sector
    const want = await client.query("SELECT id, slug, name FROM sectors WHERE slug = ANY($1::text[])", [v.sectors]);
    for (const r of want.rows) await client.query("INSERT INTO contribution_scopes (contribution_id, sector_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [cid, r.id]);
    await client.query("DELETE FROM contribution_scopes WHERE contribution_id = $1 AND NOT (sector_id = ANY($2::int[]))", [cid, want.rows.map((r) => r.id)]);
    if (robots.present) { // P3: one robot per chosen sector, or Not sure; checked against Sector forms before anything is stored
      const p = await planRobots(client, cid, want.rows.map((r) => ({ id: Number(r.id), slug: r.slug, name: r.name })), robots.value);
      if ("error" in p) { await client.query("ROLLBACK"); return fail(400, "VALIDATION_FAILED", VALIDATION, { robots: p.error }); }
      if ("plan" in p) await applyRobots(client, cid, p.plan); // skip: migration 024 or 025 not applied yet, nothing to store
    }
    if (dir.present) await saveDirectory(client, cid, (dir as { value: DirectoryEntry[] }).value); // absent (an older form): the rows stay as they are
    if (share !== undefined) await saveShareChoice(client, cid, ownerId, share);
    await client.query("COMMIT");
    return { ok: true, id: cid, status };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (titleTaken(e)) return SAME_TITLE();
    const s = notSet(e); if (s) return s;
    const d = contributionDbError(e); if (d) return fail(400, "VALIDATION_FAILED", VALIDATION, { [d.field]: d.message });
    throw e;
  } finally { client.release(); }
}

/** Sends a draft (or an item that needs changes) for review. */
export async function submitOwn(pool: Pool, ownerId: number, id: number): Promise<Ok<{ id: number; status: string }> | Fail> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT type, robot_type, title, body, status FROM contributions WHERE id = $1 AND user_id = $2 FOR UPDATE", [id, ownerId]);
    const c = rows[0];
    if (!c) { await client.query("ROLLBACK"); return NOT_FOUND; }
    const rule = OWNER_RULES[c.status as keyof typeof OWNER_RULES];
    if (!rule?.submit) {
      await client.query("ROLLBACK");
      const why = c.status === "pending_review" ? "This is already waiting for review."
        : c.status === "published" ? "This contribution is already published."
        : c.status === "unpublished" ? "This contribution was taken down by an administrator, so it cannot be sent again. You can start a new one."
        : "This contribution cannot be sent right now.";
      return fail(409, "NOT_SUBMITTABLE", why);
    }
    const scopes = await client.query("SELECT s.slug FROM contribution_scopes cs JOIN sectors s ON s.id = cs.sector_id WHERE cs.contribution_id = $1", [id]);
    const v = validateContribution({ type: c.type, robotType: c.robot_type, title: c.title, body: c.body, sectors: scopes.rows.map((r) => r.slug) }, await activeSectorSlugs(client), { forSubmit: true });
    if (!v.ok) { await client.query("ROLLBACK"); return fail(400, "VALIDATION_FAILED", VALIDATION, Object.fromEntries(Object.entries(errorsOf(v)).map(([k, m]) => [k === "body" ? "description" : k, m]))); }
    if (await isDuplicate(client, c.title, c.body, id)) { await client.query("ROLLBACK"); return DUPLICATE(); }
    await client.query("UPDATE contributions SET status = 'pending_review', submitted_at = COALESCE(submitted_at, now()), published_at = NULL, updated_at = now() WHERE id = $1 AND user_id = $2", [id, ownerId]);
    await client.query("COMMIT");
    return { ok: true, id, status: "pending_review" };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (titleTaken(e)) return SAME_TITLE();
    const s = notSet(e); if (s) return s;
    const d = contributionDbError(e); if (d) return fail(400, "VALIDATION_FAILED", VALIDATION, { [d.field]: d.message });
    throw e;
  } finally { client.release(); }
}

/** Your own contribution, for editing: the fields, the photos' details (never the bytes) and your own contact details. */
export async function getOwn(db: Db, ownerId: number, id: number): Promise<Ok<{ contribution: Record<string, unknown> }> | Fail> {
  try {
    const { rows } = await db.query("SELECT id, type, " + typeChosenSql("contributions") + " AS type_chosen, robot_type, title, body, status, created_at, updated_at FROM contributions WHERE id = $1 AND user_id = $2", [id, ownerId]);
    const c = rows[0];
    if (!c) return NOT_FOUND;
    const scopes = await db.query("SELECT s.slug FROM contribution_scopes cs JOIN sectors s ON s.id = cs.sector_id WHERE cs.contribution_id = $1 ORDER BY s.slug", [id]);
    const photos: PhotoMeta[] = await listPhotoMeta(db, [id]).catch(() => []);
    const contact: Contact | null = await readContact(db, id, ownerId).catch(() => null);
    const shareContact = await shareChoiceOf(db, id, ownerId).catch(() => false);
    const fromSectorPage = await fromSectorPageOf(db, id, ownerId).catch(() => false);
    const chosen = await robotsOf(db, id).catch(() => null); // P3 (null before 024/025)
    const robots = (chosen ?? []).filter((r) => r.robot).map((r) => ({ sector: r.sector, slug: r.robot!.slug, name: r.robot!.name, active: r.robot!.active }));
    const fromRobotPage = await fromRobotPageOf(db, id, ownerId).catch(() => false);
    const parts = splitBody(c.body);
    // for Edit: the structured categories (or, for an item saved before PR2, the ones in the folded text) and your own words without the fold
    const fold = splitFold(parts.description);
    const directory = (await directoryFor(db, [id])).get(id) ?? fold.entries ?? [];
    return { ok: true, contribution: { id: Number(c.id), status: c.status, editable: OWNER_RULES[c.status as keyof typeof OWNER_RULES]?.edit !== null, type: c.type, typeChosen: c.type_chosen === true, robotType: c.robot_type ?? "", sectors: scopes.rows.map((r) => r.slug), title: c.title, ...parts, description: fold.entries ? fold.text : parts.description, directory, photos: photos.map((p) => ({ id: p.id, position: p.position, alt: p.alt, mime: p.mime })), contact, shareContact, fromSectorPage, robots, fromRobotPage } };
  } catch (e) { const s = notSet(e); if (s) return s; throw e; }
}

/** Deletes your own DRAFT (nothing else can be deleted by its author). */
export async function deleteDraft(db: Db, ownerId: number, id: number): Promise<Ok<{ id: number }> | Fail> {
  try {
    const { rows } = await db.query("DELETE FROM contributions WHERE id = $1 AND user_id = $2 AND status = 'draft' RETURNING id", [id, ownerId]);
    if (rows[0]) return { ok: true, id };
    const own = await db.query("SELECT status FROM contributions WHERE id = $1 AND user_id = $2", [id, ownerId]);
    return own.rows[0] ? fail(409, "NOT_DELETABLE", "Only a draft can be deleted.") : NOT_FOUND;
  } catch (e) { const s = notSet(e); if (s) return s; throw e; }
}

/** Adds ONE photo to your contribution: the type is decided from the bytes, the size is limited, the description is required, and the hidden metadata (GPS and more) is removed before it is stored. */
export async function addOwnPhoto(pool: Pool, ownerId: number, id: number, file: { bytes: Buffer; alt: string }): Promise<Ok<{ photoId: number; bytes: number }> | Fail> {
  try {
    const status = await ownStatus(pool, ownerId, id);
    if (status === null) return NOT_FOUND;
    if ((OWNER_RULES[status as keyof typeof OWNER_RULES]?.edit ?? null) === null) return notEditable(status);
    const count = Number((await pool.query("SELECT count(*)::int AS n FROM contribution_photos WHERE contribution_id = $1", [id])).rows[0].n);
    const checked = validatePhoto({ bytes: file.bytes, alt: file.alt }, count);
    if (!checked.ok) return fail(400, "VALIDATION_FAILED", VALIDATION, errorsOf(checked));
    const clean = stripPhotoMetadata(checked.value.bytes, checked.value.mime);
    if (!clean) return fail(400, "VALIDATION_FAILED", VALIDATION, { photo: "We could not read that photo. Choose another JPG or PNG." });
    if (detectPhotoMime(clean) !== checked.value.mime) return fail(400, "VALIDATION_FAILED", VALIDATION, { photo: "We could not read that photo. Choose another JPG or PNG." });
    const photoId = await addPhoto(pool, id, { mime: checked.value.mime, bytes: clean, alt: checked.value.alt, sha256: createHash("sha256").update(clean).digest("hex") });
    return { ok: true, photoId, bytes: clean.length };
  } catch (e) {
    const s = notSet(e); if (s) return s;
    const d = contributionDbError(e) ?? ((e as { code?: string })?.code === "23514" ? { field: "photo", message: "A contribution can have at most 3 photos." } : null);
    if (d) return fail(400, "VALIDATION_FAILED", VALIDATION, { [d.field]: d.message });
    throw e;
  }
}
export async function removeOwnPhoto(pool: Pool, ownerId: number, id: number, photoId: number): Promise<Ok<{ id: number }> | Fail> {
  try {
    const status = await ownStatus(pool, ownerId, id);
    if (status === null) return NOT_FOUND;
    if ((OWNER_RULES[status as keyof typeof OWNER_RULES]?.edit ?? null) === null) return notEditable(status);
    // the status is checked again inside the DELETE, so a change of status in between cannot slip a removal through
    const { rows } = await pool.query("DELETE FROM contribution_photos p USING contributions c WHERE p.id = $3 AND p.contribution_id = c.id AND c.id = $1 AND c.user_id = $2 AND c.status = ANY($4::varchar[]) RETURNING p.id", [id, ownerId, photoId, EDITABLE_STATUSES]);
    if (!rows[0]) return NOT_FOUND;
    return { ok: true, id: photoId };
  } catch (e) { const s = notSet(e); if (s) return s; throw e; }
}

/** Your private contact details: validated here, saved by the contact module (owner only). */
export async function saveOwnContact(db: Db, ownerId: number, id: number, raw: unknown): Promise<Ok<{ id: number }> | Fail> {
  const v = validateContact(raw);
  if (!v.ok) return fail(400, "VALIDATION_FAILED", VALIDATION, errorsOf(v));
  try {
    const status = await ownStatus(db, ownerId, id);
    if (status === null) return NOT_FOUND;
    if ((OWNER_RULES[status as keyof typeof OWNER_RULES]?.edit ?? null) === null) return notEditable(status);
    return (await saveContact(db, id, ownerId, v.value)) ? { ok: true, id } : NOT_FOUND;
  } catch (e) { const s = notSet(e); if (s) return s; throw e; }
}
export async function removeOwnContact(db: Db, ownerId: number, id: number): Promise<Ok<{ id: number }> | Fail> {
  try {
    const status = await ownStatus(db, ownerId, id);
    if (status === null) return NOT_FOUND;
    if ((OWNER_RULES[status as keyof typeof OWNER_RULES]?.edit ?? null) === null) return notEditable(status);
    return (await removeContact(db, id, ownerId)) ? { ok: true, id } : NOT_FOUND;
  } catch (e) { const s = notSet(e); if (s) return s; throw e; }
}
