// Replies to the contributor (migration 019). Any reviewer (administrator or flagged moderator) can reply on any submitted item that is
// not their own; the contributor reads every reply under My Contributions, whatever the status. Replies are append only (the database
// refuses changes), and each one records who wrote it and when, so it is also a work-log entry.
// Optional email: OFF unless CONTRIBUTION_REPLY_EMAIL is exactly "true". The email only says that a reply is waiting (no reply text);
// a failed email never undoes the reply.
import { sendReplyNoticeEmail } from "./email";
import { hasControlChars } from "./validation";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
type Pool = Db & { connect: () => Promise<Db & { release: () => void }> };

export type Fail = { ok: false; status: number; error: string; message: string; fieldErrors?: Record<string, string> };
const fail = (status: number, error: string, message: string, fieldErrors?: Record<string, string>): Fail => ({ ok: false, status, error, message, ...(fieldErrors ? { fieldErrors } : {}) });
const code = (e: unknown) => (e as { code?: string })?.code;
export const NOT_SET_UP = () => fail(503, "NOT_SET_UP", "Replies and notes are not set up on this database yet (migration 019).");
export const NOT_FOUND = () => fail(404, "NOT_FOUND", "We could not find that contribution.");

export const REPLY_MIN = 3, REPLY_MAX = 2000;

/** Checks a reply or note: text, trimmed, min..max characters, no control characters except line breaks. */
export function checkText(raw: unknown, field: string, min: number, max: number, what: string): { ok: true; text: string } | Fail {
  if (typeof raw !== "string") return fail(400, "VALIDATION_FAILED", `Please write the ${what}.`, { [field]: `Write the ${what} (at least ${min} characters).` });
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (text.length < min) return fail(400, "VALIDATION_FAILED", `Please write the ${what}.`, { [field]: `Write the ${what} (at least ${min} characters).` });
  if (text.length > max) return fail(400, "VALIDATION_FAILED", `The ${what} is too long.`, { [field]: `Keep the ${what} to ${max} characters or fewer.` });
  if (hasControlChars(text.replace(/\n/g, " "))) return fail(400, "VALIDATION_FAILED", `Please fix the ${what}.`, { [field]: `The ${what} has characters that are not allowed.` });
  return { ok: true, text };
}

/** The item a reviewer may write about: submitted (not a draft) and not their own. */
export async function itemForReviewer(db: Db, reviewerId: number, id: number): Promise<{ ok: true; userId: number; title: string } | Fail> {
  const { rows } = await db.query("SELECT user_id, title FROM contributions WHERE id = $1 AND status <> 'draft'", [id]);
  const c = rows[0];
  if (!c) return NOT_FOUND();
  if (Number(c.user_id) === reviewerId) return fail(403, "OWN_ITEM", "You cannot review your own contribution. Another reviewer will.");
  return { ok: true, userId: Number(c.user_id), title: String(c.title) };
}

export const replyEmailEnabled = (env: NodeJS.ProcessEnv = process.env) => env.CONTRIBUTION_REPLY_EMAIL === "true";

export async function addReply(pool: Pool, reviewerId: number, id: number, raw: unknown, env: NodeJS.ProcessEnv = process.env): Promise<{ ok: true; id: number; at: string; emailed: boolean } | Fail> {
  const v = checkText(raw, "message", REPLY_MIN, REPLY_MAX, "reply");
  if (!v.ok) return v as Fail;
  let replyId: number, at: string, author: { userId: number; title: string };
  try {
    const item = await itemForReviewer(pool, reviewerId, id);
    if (!item.ok) return item as Fail;
    author = item as { userId: number; title: string };
    const { rows } = await pool.query("INSERT INTO contribution_replies (contribution_id, author_id, message) VALUES ($1,$2,$3) RETURNING id, created_at", [id, reviewerId, (v as { text: string }).text]);
    replyId = Number(rows[0].id); at = new Date(rows[0].created_at).toISOString();
  } catch (e) {
    if (code(e) === "42P01" || code(e) === "42703") return NOT_SET_UP();
    if (code(e) === "23503") return NOT_FOUND(); // the item was deleted meanwhile
    throw e;
  }
  let emailed = false;
  if (replyEmailEnabled(env)) {
    try {
      const to = (await pool.query("SELECT email FROM users WHERE id = $1", [author.userId])).rows[0]?.email;
      if (typeof to === "string" && to) {
        await sendReplyNoticeEmail(to, author.title, env);
        await pool.query("UPDATE contribution_replies SET email_sent_at = now() WHERE id = $1 AND email_sent_at IS NULL", [replyId]);
        emailed = true;
      }
    } catch {
      console.error("reply notice email failed"); // the reply is saved; no address or text in the log
    }
  }
  return { ok: true, id: replyId, at, emailed };
}

export type MemberReply = { message: string; at: string };

/** The replies on these items (the caller has already limited the ids to the member's own items), oldest first, at most 20 per item. */
export async function repliesForItems(db: Db, ids: number[]): Promise<Map<number, MemberReply[]>> {
  const out = new Map<number, MemberReply[]>();
  if (ids.length === 0) return out;
  try {
    const { rows } = await db.query(
      "SELECT contribution_id, message, created_at FROM (SELECT contribution_id, message, created_at, id, " +
      "row_number() OVER (PARTITION BY contribution_id ORDER BY created_at DESC, id DESC) AS n FROM contribution_replies WHERE contribution_id = ANY($1::bigint[])) x " +
      "WHERE n <= 20 ORDER BY contribution_id, created_at ASC, id ASC", [ids]);
    for (const r of rows) {
      const k = Number(r.contribution_id);
      (out.get(k) ?? out.set(k, []).get(k)!).push({ message: String(r.message), at: new Date(r.created_at).toISOString() });
    }
  } catch (e) {
    if (code(e) !== "42P01") throw e; // 019 not applied: no replies yet
  }
  return out;
}

export type PortalEntry = { text: string; at: string; by: string };

/** For reviewers: every reply on one item, newest first, with who wrote it (first name only). */
export async function repliesForReview(db: Db, id: number): Promise<PortalEntry[]> {
  try {
    const { rows } = await db.query(
      "SELECT p.message, p.created_at, u.full_name FROM contribution_replies p LEFT JOIN users u ON u.id = p.author_id WHERE p.contribution_id = $1 ORDER BY p.created_at DESC, p.id DESC", [id]);
    return rows.map((r) => ({ text: String(r.message), at: new Date(r.created_at).toISOString(), by: firstWord(r.full_name) }));
  } catch (e) {
    if (code(e) === "42P01") return [];
    throw e;
  }
}

export const firstWord = (name: unknown) => (typeof name === "string" && name.trim() ? name.trim().split(/\s+/)[0]!.slice(0, 40) : "A former reviewer");
