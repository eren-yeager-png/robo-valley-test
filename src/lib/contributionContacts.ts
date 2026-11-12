// Private contact details of a contribution. This is the ONLY file that reads or writes contribution_contacts (migration 014) and
// contributions.share_contact_with_moderators (migration 021), and the only one that reads a profile's contact for a moderator.
//   * Since item 3 the Contribute form asks for no contact details. It has ONE box, unticked by default: "Let moderators contact me
//     using my profile details" (share_contact_with_moderators). Ticked, a flagged moderator sees the contributor's PROFILE name,
//     email and mobile for that contribution (READ_PROFILE_CONTACT_SQL); nobody else ever does.
//   * Details typed into the old form stay in contribution_contacts and keep their own rule: the contributor who owns the
//     contribution, always; a moderator ONLY when the contributor ticked "share with moderators"; nobody else (READ_CONTACT_SQL).
//   * Both rules are in the SQL itself, not left to the caller.
//   * Contact details never go into published output, counts or another person's "Your contributions": no other module
//     may mention the table (a test scans src/ for that), and nothing here logs a value.
//   * Every query lists its columns. No query selects every column.
import { CONTRIBUTION_LIMITS } from "./contributions";
import { hasControlChars, normalizeEmail, normalizeMobile, type FieldErrors } from "./validation";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export type ContactInput = { name: string; email: string | null; phone: string | null; shareWithModerators: boolean };
/** source: "profile" = the contributor's profile (they ticked the box in the new form); "form" = typed into the old form. */
export type Contact = ContactInput & { source?: "profile" | "form" };
export type ContactResult = { ok: true; value: ContactInput } | { ok: false; errors: FieldErrors };

/**
 * Checks contact details as typed in the form. At least one of email or phone is needed. Email is lower-cased; the phone is
 * the 10-digit Indian mobile number (+91 and spaces accepted). Sharing with moderators is OFF unless it is exactly `true`.
 */
export function validateContact(raw: unknown): ContactResult {
  const o = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const errors: FieldErrors = {};

  const name = typeof o.name === "string" ? o.name.replace(/\s+/g, " ").trim() : "";
  if (!name) errors.name = "Tell us who to contact.";
  else if (name.length > CONTRIBUTION_LIMITS.contactNameMax) errors.name = `Keep the name to ${CONTRIBUTION_LIMITS.contactNameMax} characters or fewer.`;
  else if (hasControlChars(name)) errors.name = "The name has characters that are not allowed.";

  const hasEmail = typeof o.email === "string" && o.email.trim() !== "";
  const hasPhone = typeof o.phone === "string" && o.phone.trim() !== "";
  const email = hasEmail ? normalizeEmail(o.email) : null;
  const phone = hasPhone ? normalizeMobile(o.phone) : null;
  if (hasEmail && !email) errors.email = "That email address does not look right.";
  if (hasPhone && !phone) errors.phone = "Enter a 10-digit mobile number.";
  if (!hasEmail && !hasPhone) errors.email = "Give an email address or a mobile number.";

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name, email, phone, shareWithModerators: o.shareWithModerators === true } };
}

/**
 * The one read query. $1 = contribution id, $2 = the viewer's user id. Whether the viewer is a moderator is read from the
 * database (users.is_moderator, migration 015), never supplied by the caller.
 * A row comes back only for the owner, or for a moderator when share_with_moderators is true. Anyone else gets no row.
 */
export const READ_CONTACT_SQL =
  "SELECT cc.contact_name, cc.email, cc.phone, cc.share_with_moderators " +
  "FROM contribution_contacts cc JOIN contributions c ON c.id = cc.contribution_id " +
  "WHERE cc.contribution_id = $1 AND (c.user_id = $2 OR (cc.share_with_moderators AND EXISTS (SELECT 1 FROM users m WHERE m.id = $2 AND m.is_moderator)))";

/**
 * The profile contact of the contributor, for a flagged moderator, ONLY when the contributor ticked "Let moderators contact me using
 * my profile details" on this contribution (migration 021). $1 = contribution id, $2 = the viewer's user id; whether the viewer is a
 * moderator is read from the database. Anyone else (the public, other members, an administrator without the flag) gets no row.
 */
export const READ_PROFILE_CONTACT_SQL =
  "SELECT u.full_name, u.email, u.mobile FROM contributions c JOIN users u ON u.id = c.user_id " +
  "WHERE c.id = $1 AND c.share_contact_with_moderators AND c.user_id <> $2 AND EXISTS (SELECT 1 FROM users m WHERE m.id = $2 AND m.is_moderator)";

/** The contact details this viewer may see, or null (no contact, or not allowed: the two look the same on purpose). */
export async function readContact(db: Db, contributionId: number, viewerUserId: number): Promise<Contact | null> {
  try {
    const p = (await db.query(READ_PROFILE_CONTACT_SQL, [contributionId, viewerUserId])).rows[0];
    if (p) return { name: p.full_name, email: p.email ?? null, phone: p.mobile ?? null, shareWithModerators: true, source: "profile" };
  } catch (e) {
    if ((e as { code?: string })?.code !== "42703") throw e; // before migration 021 nothing was shared this way: only the old form's details
  }
  const { rows } = await db.query(READ_CONTACT_SQL, [contributionId, viewerUserId]);
  const r = rows[0];
  return r ? { name: r.contact_name, email: r.email, phone: r.phone, shareWithModerators: r.share_with_moderators, source: "form" } : null;
}

/** The form's box as sent: true only when exactly true; undefined when the field is absent (an older form: leave the choice as it is). */
export function readShareChoice(raw: unknown): boolean | undefined {
  const o = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return "shareContact" in o ? o.shareContact === true : undefined;
}

/**
 * Saves the box for the owner's own contribution, inside the caller's transaction. Before migration 021 the column is missing: the
 * choice is then simply not saved (it counts as "not shared", the private side), and the rest of the save goes through.
 */
export async function saveShareChoice(db: Db, contributionId: number, ownerId: number, share: boolean): Promise<void> {
  await db.query("SAVEPOINT rv_share_choice");
  try {
    await db.query("UPDATE contributions SET share_contact_with_moderators = $3 WHERE id = $1 AND user_id = $2", [contributionId, ownerId, share]);
    await db.query("RELEASE SAVEPOINT rv_share_choice");
  } catch (e) {
    await db.query("ROLLBACK TO SAVEPOINT rv_share_choice");
    if ((e as { code?: string })?.code !== "42703") throw e;
  }
}

/** The owner's own choice, for Edit (false when not ticked, or before migration 021). */
export async function shareChoiceOf(db: Db, contributionId: number, ownerId: number): Promise<boolean> {
  try {
    const { rows } = await db.query("SELECT share_contact_with_moderators AS s FROM contributions WHERE id = $1 AND user_id = $2", [contributionId, ownerId]);
    return rows[0]?.s === true;
  } catch (e) {
    if ((e as { code?: string })?.code === "42703") return false;
    throw e;
  }
}

/** Saves (or replaces) the contact details. Only the owner of the contribution can; returns false for anyone else. */
export async function saveContact(db: Db, contributionId: number, ownerId: number, c: ContactInput): Promise<boolean> {
  const { rows } = await db.query(
    "INSERT INTO contribution_contacts (contribution_id, contact_name, email, phone, share_with_moderators) " +
      "SELECT c.id, $3, $4, $5, $6 FROM contributions c WHERE c.id = $1 AND c.user_id = $2 " +
      "ON CONFLICT (contribution_id) DO UPDATE SET contact_name = EXCLUDED.contact_name, email = EXCLUDED.email, " +
      "phone = EXCLUDED.phone, share_with_moderators = EXCLUDED.share_with_moderators " +
      "RETURNING contribution_id",
    [contributionId, ownerId, c.name, c.email, c.phone, c.shareWithModerators]);
  return rows.length === 1;
}

/** Removes the contact details. Only the owner can; returns whether a row was removed. */
export async function removeContact(db: Db, contributionId: number, ownerId: number): Promise<boolean> {
  const { rows } = await db.query(
    "DELETE FROM contribution_contacts cc USING contributions c WHERE cc.contribution_id = c.id AND c.id = $1 AND c.user_id = $2 RETURNING cc.contribution_id",
    [contributionId, ownerId]);
  return rows.length === 1;
}
