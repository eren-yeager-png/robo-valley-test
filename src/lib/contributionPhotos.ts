// Contribution photos (migration 013). Pure validation plus three small database helpers. The API that calls them comes later.
//   * The file type is decided from the file CONTENT (JPEG or PNG signature), never from the browser's claim.
//   * LISTINGS READ METADATA ONLY (listPhotoMeta never touches contribution_photo_blobs). The bytes are read by getPhotoBytes,
//     one photo at a time, and only to serve that one image.
//   * The same limits are enforced again by CHECK constraints and a trigger in db/migrations/013_contribution_photos.sql.
import { createHash } from "node:crypto";
import { CONTRIBUTION_LIMITS, type PHOTO_MIMES } from "./contributions";
import { hasControlChars, type FieldErrors } from "./validation";

export type PhotoMime = (typeof PHOTO_MIMES)[number];
export type PhotoMeta = { id: number; contributionId: number; position: number; mime: PhotoMime; byteSize: number; alt: string };
export type PhotoInput = { mime: PhotoMime; bytes: Buffer; alt: string; sha256: string };
export type PhotoResult = { ok: true; value: PhotoInput } | { ok: false; errors: FieldErrors };

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
type Pool = Db & { connect: () => Promise<Db & { release: () => void }> };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

/** What the bytes really are: "image/png", "image/jpeg" or null. */
export function detectPhotoMime(bytes: Buffer): PhotoMime | null {
  if (bytes.length >= PNG_SIGNATURE.length && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return "image/png";
  if (bytes.length >= JPEG_SIGNATURE.length && bytes.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) return "image/jpeg";
  return null;
}

/**
 * Checks one photo as uploaded. `existingCount` is how many photos the contribution already has.
 * Alt text is required (a person using a screen reader needs it) and limited to altMax characters.
 */
export function validatePhoto(raw: { bytes?: unknown; mime?: unknown; alt?: unknown }, existingCount = 0): PhotoResult {
  const L = CONTRIBUTION_LIMITS;
  const errors: FieldErrors = {};
  const bytes = Buffer.isBuffer(raw.bytes) ? raw.bytes : Buffer.alloc(0);

  if (existingCount >= L.photosMax) errors.photo = `You can add up to ${L.photosMax} photos.`;
  else if (bytes.length === 0) errors.photo = "Choose a photo.";
  else if (bytes.length > L.photoBytesMax) errors.photo = "That photo is larger than 4 MB. Choose a smaller one.";
  else {
    const real = detectPhotoMime(bytes);
    if (!real) errors.photo = "Photos must be JPG or PNG.";
    else if (typeof raw.mime === "string" && raw.mime !== "" && raw.mime !== real) errors.photo = "The file does not match its type. Choose a JPG or PNG photo.";
  }

  const alt = typeof raw.alt === "string" ? raw.alt.replace(/\s+/g, " ").trim() : "";
  if (alt.length < L.altMin) errors.alt = "Describe the photo in a few words (for people who cannot see it).";
  else if (alt.length > L.altMax) errors.alt = `Keep the description to ${L.altMax} characters or fewer.`;
  else if (hasControlChars(alt)) errors.alt = "The description has characters that are not allowed.";

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { mime: detectPhotoMime(bytes)!, bytes, alt, sha256: createHash("sha256").update(bytes).digest("hex") } };
}

/** The metadata of the photos of these contributions. Never selects the image bytes. */
export const PHOTO_META_SQL =
  "SELECT id, contribution_id, position, mime, byte_size, alt_text FROM contribution_photos WHERE contribution_id = ANY($1::bigint[]) ORDER BY contribution_id, position";

export async function listPhotoMeta(db: Db, contributionIds: number[]): Promise<PhotoMeta[]> {
  if (contributionIds.length === 0) return [];
  const { rows } = await db.query(PHOTO_META_SQL, [contributionIds]);
  return rows.map((r) => ({ id: Number(r.id), contributionId: Number(r.contribution_id), position: Number(r.position), mime: r.mime, byteSize: Number(r.byte_size), alt: r.alt_text }));
}

/** The bytes of ONE photo (to serve that image). Returns null when there is no such photo. */
export async function getPhotoBytes(db: Db, photoId: number): Promise<{ mime: PhotoMime; bytes: Buffer } | null> {
  const { rows } = await db.query(
    "SELECT p.mime, b.data FROM contribution_photos p JOIN contribution_photo_blobs b ON b.photo_id = p.id WHERE p.id = $1", [photoId]);
  return rows[0] ? { mime: rows[0].mime, bytes: Buffer.from(rows[0].data) } : null;
}

/** Stores a validated photo in the first free position (1-3) of the contribution, in one transaction. Returns its id. */
export async function addPhoto(pool: Pool, contributionId: number, photo: PhotoInput): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: used } = await client.query("SELECT position FROM contribution_photos WHERE contribution_id = $1 FOR UPDATE", [contributionId]);
    const taken = new Set(used.map((r) => Number(r.position)));
    let position = 0;
    for (let i = 1; i <= CONTRIBUTION_LIMITS.photosMax && !position; i++) if (!taken.has(i)) position = i;
    if (!position) throw Object.assign(new Error("A contribution can have at most 3 photos."), { code: "23514", constraint: "contribution_photos_position_ck" });
    const { rows } = await client.query(
      "INSERT INTO contribution_photos (contribution_id, position, mime, byte_size, alt_text, file_sha256) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [contributionId, position, photo.mime, photo.bytes.length, photo.alt, photo.sha256]);
    await client.query("INSERT INTO contribution_photo_blobs (photo_id, data) VALUES ($1,$2)", [rows[0].id, photo.bytes]);
    await client.query("COMMIT");
    return Number(rows[0].id);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
