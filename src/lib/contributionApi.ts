// The contributor's side of the Contribute pages: save a draft, edit, submit, delete a draft, add or remove one photo, and read
// your own contribution. EVERY query is tied to the signed-in owner (user_id = $owner): nobody can read or change someone else's.
// The wizard's extra fields (how it is done now, who is affected, time or cost, what should improve, role, district) are stored in the
// body as titled sections, so the tables from migrations 012 to 014 are enough. Status rules (who may move an item where) are in
// OWNER_RULES below and in the pull request description; the moderator's moves are in contributionReview.ts.
// Portal PR2: the form also sends `directory` (structured categories, src/lib/directoryCategories.ts); it is checked here and saved in
// the same transaction as the item, and your own item comes back with it (and the description without the folded copy) for Edit.
import { createHash } from "node:crypto";
import { addPhoto, detectPhotoMime, listPhotoMeta, validatePhoto, type PhotoMeta } from "./contributionPhotos";
import { removeContact, readContact, saveContact, validateContact, type Contact } from "./contributionContacts";
import { CONTRIBUTION_LIMITS, contributionDbError, validateContribution, type ContributionStatus } from "./contributions";
import { stripPhotoMetadata } from "./photoClean";
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
  published: { edit: "pending_review", submit: false, deleteIt: false }, // an edited published item goes back to review and leaves the public numbers
  unpublished: { edit: "pending_review", submit: true, deleteIt: false }, // editing an unpublished item asks for review again
  rejected: { edit: null, submit: false, deleteIt: false }, // final: the author starts a new contribution instead
  removed: { edit: null, submit: false, deleteIt: false }, // final: removed by an administrator as a duplicate or unsuitable
};

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

const notSet = (e: unknown): Fail | null => ((e as { code?: string })?.code === "42P01" || (e as { code?: string })?.code === "42703" ? fail(503, "NOT_SET_UP", "Contributions are not set up yet.") : null);

/** Creates a draft (id undefined) or saves a change to your own contribution. */
export async function saveOwn(pool: Pool, ownerId: number, raw: unknown, id?: number): Promise<Ok<{ id: number; status: string }> | Fail> {
  const f = readFields(raw);
  const dir = readDirectory(typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>).directory : undefined);
  if (dir.present && !dir.ok) return fail(400, "VALIDATION_FAILED", VALIDATION, { directory: (dir as { message: string }).message });
  const client = await pool.connect();
  try {
    const slugs = await activeSectorSlugs(client);
    await client.query("BEGIN");
    let status: string = "draft", cur: { status: string } | undefined;
    if (id !== undefined) {
      const { rows } = await client.query("SELECT status FROM contributions WHERE id = $1 AND user_id = $2 FOR UPDATE", [id, ownerId]);
      cur = rows[0];
      if (!cur) { await client.query("ROLLBACK"); return NOT_FOUND; }
      const rule = OWNER_RULES[cur.status as keyof typeof OWNER_RULES];
      if (!rule || rule.edit === null) { await client.query("ROLLBACK"); return fail(409, "NOT_EDITABLE", "This contribution was closed by a moderator, so it cannot be changed. You can start a new one."); }
      status = rule.edit;
    }
    const checked = checkFields(f, slugs, status !== "draft");
    if (!checked.ok) { await client.query("ROLLBACK"); return checked as Fail; }
    const v = (checked as { value: ReturnType<typeof composeInput> }).value;
    if (await isDuplicate(client, v.title, v.body, id ?? 0)) { await client.query("ROLLBACK"); return DUPLICATE(); }
    let cid = id ?? 0;
    if (id === undefined) {
      const ins = await client.query("INSERT INTO contributions (user_id, type, robot_type, title, body) VALUES ($1,$2,$3,$4,$5) RETURNING id", [ownerId, v.type, v.robotType, v.title, v.body]);
      cid = Number(ins.rows[0].id);
    } else {
      const backToReview = status === "pending_review" && cur!.status !== "pending_review";
      await client.query(
        "UPDATE contributions SET type=$3, robot_type=$4, title=$5, body=$6, status=$7::varchar, published_at = CASE WHEN $7::varchar = 'published' THEN published_at END, updated_at = now() WHERE id = $1 AND user_id = $2",
        [cid, ownerId, v.type, v.robotType, v.title, v.body, status]);
      void backToReview;
    }
    // new sectors first, then remove the ones no longer chosen: a submitted item must always keep at least one sector
    const want = await client.query("SELECT id, slug FROM sectors WHERE slug = ANY($1::text[])", [v.sectors]);
    for (const r of want.rows) await client.query("INSERT INTO contribution_scopes (contribution_id, sector_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [cid, r.id]);
    await client.query("DELETE FROM contribution_scopes WHERE contribution_id = $1 AND NOT (sector_id = ANY($2::int[]))", [cid, want.rows.map((r) => r.id)]);
    if (dir.present) await saveDirectory(client, cid, (dir as { value: DirectoryEntry[] }).value); // absent (an older form): the rows stay as they are
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
    if (!rule?.submit) { await client.query("ROLLBACK"); return fail(409, "NOT_SUBMITTABLE", c.status === "pending_review" ? "This is already waiting for review." : "This contribution cannot be sent right now."); }
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
    const { rows } = await db.query("SELECT id, type, robot_type, title, body, status, created_at, updated_at FROM contributions WHERE id = $1 AND user_id = $2", [id, ownerId]);
    const c = rows[0];
    if (!c) return NOT_FOUND;
    const scopes = await db.query("SELECT s.slug FROM contribution_scopes cs JOIN sectors s ON s.id = cs.sector_id WHERE cs.contribution_id = $1 ORDER BY s.slug", [id]);
    const photos: PhotoMeta[] = await listPhotoMeta(db, [id]).catch(() => []);
    const contact: Contact | null = await readContact(db, id, ownerId).catch(() => null);
    const parts = splitBody(c.body);
    // for Edit: the structured categories (or, for an item saved before PR2, the ones in the folded text) and your own words without the fold
    const fold = splitFold(parts.description);
    const directory = (await directoryFor(db, [id])).get(id) ?? fold.entries ?? [];
    return { ok: true, contribution: { id: Number(c.id), status: c.status, editable: OWNER_RULES[c.status as keyof typeof OWNER_RULES]?.edit !== null, type: c.type, robotType: c.robot_type ?? "", sectors: scopes.rows.map((r) => r.slug), title: c.title, ...parts, description: fold.entries ? fold.text : parts.description, directory, photos: photos.map((p) => ({ id: p.id, position: p.position, alt: p.alt, mime: p.mime })), contact } };
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
    const own = await pool.query("SELECT status FROM contributions WHERE id = $1 AND user_id = $2", [id, ownerId]);
    if (!own.rows[0]) return NOT_FOUND;
    if (OWNER_RULES[own.rows[0].status as keyof typeof OWNER_RULES]?.edit === null) return fail(409, "NOT_EDITABLE", "This contribution was closed by a moderator, so it cannot be changed.");
    const count = Number((await pool.query("SELECT count(*)::int AS n FROM contribution_photos WHERE contribution_id = $1", [id])).rows[0].n);
    const checked = validatePhoto({ bytes: file.bytes, alt: file.alt }, count);
    if (!checked.ok) return fail(400, "VALIDATION_FAILED", VALIDATION, errorsOf(checked));
    const clean = stripPhotoMetadata(checked.value.bytes, checked.value.mime);
    if (!clean) return fail(400, "VALIDATION_FAILED", VALIDATION, { photo: "We could not read that photo. Choose another JPG or PNG." });
    if (detectPhotoMime(clean) !== checked.value.mime) return fail(400, "VALIDATION_FAILED", VALIDATION, { photo: "We could not read that photo. Choose another JPG or PNG." });
    const photoId = await addPhoto(pool, id, { mime: checked.value.mime, bytes: clean, alt: checked.value.alt, sha256: createHash("sha256").update(clean).digest("hex") });
    await sendBackToReview(pool, ownerId, id);
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
    const { rows } = await pool.query("DELETE FROM contribution_photos p USING contributions c WHERE p.id = $3 AND p.contribution_id = c.id AND c.id = $1 AND c.user_id = $2 AND c.status <> 'rejected' RETURNING p.id", [id, ownerId, photoId]);
    if (!rows[0]) return NOT_FOUND;
    await sendBackToReview(pool, ownerId, id);
    return { ok: true, id: photoId };
  } catch (e) { const s = notSet(e); if (s) return s; throw e; }
}
/** A change to the photos of a published or unpublished item is an edit too: it goes back to review. */
async function sendBackToReview(db: Db, ownerId: number, id: number): Promise<void> {
  await db.query("UPDATE contributions SET status = 'pending_review', published_at = NULL, updated_at = now() WHERE id = $1 AND user_id = $2 AND status IN ('published','unpublished')", [id, ownerId]);
}

/** Your private contact details: validated here, saved by the contact module (owner only). */
export async function saveOwnContact(db: Db, ownerId: number, id: number, raw: unknown): Promise<Ok<{ id: number }> | Fail> {
  const v = validateContact(raw);
  if (!v.ok) return fail(400, "VALIDATION_FAILED", VALIDATION, errorsOf(v));
  try {
    return (await saveContact(db, id, ownerId, v.value)) ? { ok: true, id } : NOT_FOUND;
  } catch (e) { const s = notSet(e); if (s) return s; throw e; }
}
export async function removeOwnContact(db: Db, ownerId: number, id: number): Promise<Ok<{ id: number }> | Fail> {
  try {
    return (await removeContact(db, id, ownerId)) ? { ok: true, id } : NOT_FOUND;
  } catch (e) { const s = notSet(e); if (s) return s; throw e; }
}
