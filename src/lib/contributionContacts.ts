// Private contact details of a contribution (migration 014). This is the ONLY file that reads or writes contribution_contacts.
//   * Who may read: the contributor who owns the contribution, always; a moderator ONLY when the contributor ticked
//     "share with moderators"; nobody else. The rule is in the SQL itself (READ_CONTACT_SQL), not left to the caller.
//   * Contact details never go into published output, counts or another person's "Your contributions": no other module
//     may mention the table (a test scans src/ for that), and nothing here logs a value.
//   * Every query lists its columns. No query selects every column.
import { CONTRIBUTION_LIMITS } from "./contributions";
import { hasControlChars, normalizeEmail, normalizeMobile, type FieldErrors } from "./validation";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export type ContactInput = { name: string; email: string | null; phone: string | null; shareWithModerators: boolean };
export type Contact = ContactInput;
export type Viewer = { userId: number; isModerator: boolean };
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
 * The one read query. $1 = contribution id, $2 = the viewer's user id, $3 = whether the viewer is a moderator.
 * A row comes back only for the owner, or for a moderator when share_with_moderators is true. Anyone else gets no row.
 */
export const READ_CONTACT_SQL =
  "SELECT cc.contact_name, cc.email, cc.phone, cc.share_with_moderators " +
  "FROM contribution_contacts cc JOIN contributions c ON c.id = cc.contribution_id " +
  "WHERE cc.contribution_id = $1 AND (c.user_id = $2 OR ($3::boolean AND cc.share_with_moderators))";

/** The contact details this viewer may see, or null (no contact, or not allowed: the two look the same on purpose). */
export async function readContact(db: Db, contributionId: number, viewer: Viewer): Promise<Contact | null> {
  const { rows } = await db.query(READ_CONTACT_SQL, [contributionId, viewer.userId, viewer.isModerator === true]);
  const r = rows[0];
  return r ? { name: r.contact_name, email: r.email, phone: r.phone, shareWithModerators: r.share_with_moderators } : null;
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
