// Internal notes (migration 019): for reviewers only. No contributor-facing query reads contribution_notes (My Contributions, the
// owner's GET and the public counts never touch it), so a note can never reach the contributor. Append only, with who and when.
import { NOT_FOUND, NOT_SET_UP, checkText, firstWord, itemForReviewer, type Fail, type PortalEntry } from "./contributionReplies";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
const code = (e: unknown) => (e as { code?: string })?.code;

export const NOTE_MIN = 3, NOTE_MAX = 1000;

export async function addNote(db: Db, reviewerId: number, id: number, raw: unknown): Promise<{ ok: true; id: number; at: string } | Fail> {
  const v = checkText(raw, "note", NOTE_MIN, NOTE_MAX, "note");
  if (!v.ok) return v as Fail;
  try {
    const item = await itemForReviewer(db, reviewerId, id);
    if (!item.ok) return item as Fail;
    const { rows } = await db.query("INSERT INTO contribution_notes (contribution_id, author_id, note) VALUES ($1,$2,$3) RETURNING id, created_at", [id, reviewerId, (v as { text: string }).text]);
    return { ok: true, id: Number(rows[0].id), at: new Date(rows[0].created_at).toISOString() };
  } catch (e) {
    if (code(e) === "42P01" || code(e) === "42703") return NOT_SET_UP();
    if (code(e) === "23503") return NOT_FOUND();
    throw e;
  }
}

/** For reviewers: every internal note on one item, newest first, with who wrote it (first name only). */
export async function notesForReview(db: Db, id: number): Promise<PortalEntry[]> {
  try {
    const { rows } = await db.query(
      "SELECT n.note, n.created_at, u.full_name FROM contribution_notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.contribution_id = $1 ORDER BY n.created_at DESC, n.id DESC", [id]);
    return rows.map((r) => ({ text: String(r.note), at: new Date(r.created_at).toISOString(), by: firstWord(r.full_name) }));
  } catch (e) {
    if (code(e) === "42P01") return [];
    throw e;
  }
}
