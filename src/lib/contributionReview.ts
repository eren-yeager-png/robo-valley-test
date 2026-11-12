// The reviewers' side: the queue, one item to read, and the decisions. Who may call is decided by reviewerGuard.ts.
//   verify          pending_review, no status change     (note optional; a reviewer has checked it)          any reviewer
//   request_changes pending_review -> changes_requested  (note required: the author sees it)                 any reviewer
//   reject          pending_review -> rejected, final    (note required: the author sees it)                 any reviewer
//   approve         pending_review -> published          (note optional)                                     ADMIN ONLY
//   remove          pending_review -> removed, final     (reason required: duplicate or unsuitable)          ADMIN ONLY
//   unpublish       published -> unpublished             (note required)                                     ADMIN ONLY
//   republish       unpublished -> published             (note optional)                                     ADMIN ONLY
// Moderators review (verify, request changes, reject) but never approve, publish, unpublish or remove.
// Approve is blocked while a likely duplicate is live in one of the same sectors, unless an administrator confirms it with a reason;
// the check runs again inside the decision's transaction, and the database itself refuses two live items with the same normalised
// title in one sector (migration 018).
// Every decision is ONE transaction: the item row is locked, the rules are checked, the audit row is written (append only, migration
// 017) and the status is changed. No audit row, no decision: if the audit table is missing the answer is 503 and nothing changes.
// A reviewer can never decide on their own contribution. Drafts are never visible here.
// Portal PR1 (migration 019): each item also carries its display status (New / In review / Replied ..., src/lib/reviewStatus.ts), the
// replies to the contributor and the internal notes. Without 019 those lists are simply empty and pending items show as "New".
import { readContact, type Contact } from "./contributionContacts";
import { listPhotoMeta } from "./contributionPhotos";
import { splitBody } from "./contributionApi";
import { CONTRIBUTION_TYPES, STATUS_LABELS, type ContributionStatus } from "./contributions";
import { hasControlChars } from "./validation";
import { NEAR_DUPLICATE_SIMILARITY, normText, similarity } from "./spreadsheet/dedupe";
import { displayStatus, portalLabel, roundFacts, type DisplayStatus } from "./reviewStatus";
import { repliesForReview, type PortalEntry } from "./contributionReplies";
import { notesForReview } from "./contributionNotes";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
type Pool = Db & { connect: () => Promise<Db & { release: () => void }> };

export const ACTIONS = {
  verify: { from: "pending_review", to: "pending_review", note: "optional", adminOnly: false },
  approve: { from: "pending_review", to: "published", note: "optional", adminOnly: true },
  request_changes: { from: "pending_review", to: "changes_requested", note: "required", adminOnly: false },
  reject: { from: "pending_review", to: "rejected", note: "required", adminOnly: false },
  remove: { from: "pending_review", to: "removed", note: "required", adminOnly: true },
  unpublish: { from: "published", to: "unpublished", note: "required", adminOnly: true },
  republish: { from: "unpublished", to: "published", note: "optional", adminOnly: true },
} as const;
export type Action = keyof typeof ACTIONS;
export const QUEUE_STATUSES = ["pending_review", "changes_requested", "published", "unpublished", "rejected", "removed"] as const;
/** Live statuses: the ones a duplicate can collide with (the same list as migration 018's key table). */
export const LIVE_STATUSES = ["pending_review", "changes_requested", "published"] as const;
export type Duplicate = { id: number; title: string; status: string; statusLabel: string; similarity: number; exact: boolean };

/**
 * Likely duplicates of one contribution: other live, non-demo contributions that share at least one sector and whose title is the same
 * after normalising, or at least NEAR_DUPLICATE_SIMILARITY similar (trigram, the same measure the school upload uses). Newest first, up to 10.
 */
export async function findDuplicates(db: Db, id: number, title: string): Promise<Duplicate[]> {
  const { rows } = await db.query(
    "SELECT c.id, c.title, c.status FROM contributions c WHERE c.id <> $1 AND NOT c.is_demo AND c.status = ANY($2::varchar[]) " +
    "AND EXISTS (SELECT 1 FROM contribution_scopes a JOIN contribution_scopes b ON b.sector_id = a.sector_id WHERE a.contribution_id = c.id AND b.contribution_id = $1) " +
    "ORDER BY c.id DESC LIMIT 500", [id, LIVE_STATUSES as unknown as string[]]);
  const me = normText(title);
  return rows.map((r) => { const t = normText(r.title); const s = me && t ? (me === t ? 1 : similarity(me, t)) : 0; return { id: Number(r.id), title: r.title, status: r.status, statusLabel: STATUS_LABELS[r.status as ContributionStatus] ?? r.status, similarity: Math.round(s * 100) / 100, exact: me === t }; })
    .filter((d) => d.exact || d.similarity >= NEAR_DUPLICATE_SIMILARITY).slice(0, 10);
}
export const NOTE_MIN = 3, NOTE_MAX = 1000;
const TYPE_LABEL = new Map<string, string>(CONTRIBUTION_TYPES.map((t) => [t.id, t.label]));

export type Fail = { ok: false; status: number; error: string; message: string; fieldErrors?: Record<string, string>; duplicates?: Duplicate[] };
const fail = (status: number, error: string, message: string, fieldErrors?: Record<string, string>): Fail => ({ ok: false, status, error, message, ...(fieldErrors ? { fieldErrors } : {}) });
const NOT_SET_UP = () => fail(503, "NOT_SET_UP", "Reviewing is not set up yet.");
const NOT_FOUND = () => fail(404, "NOT_FOUND", "We could not find that contribution.");
const code = (e: unknown) => (e as { code?: string })?.code;

export type QueueItem = { id: number; title: string; type: string; typeLabel: string; status: ContributionStatus; statusLabel: string; display: DisplayStatus; displayLabel: string; sectors: string[]; submittedAt: string | null; photos: number };

/** A page of the queue for one status (oldest first for the pending list, so nothing waits forever). Drafts are never listed. */
export async function listQueue(db: Db, status: string, filter: { sector?: string | null; verified?: boolean | null } = {}): Promise<QueueItem[]> {
  const st = (QUEUE_STATUSES as readonly string[]).includes(status) ? status : "pending_review";
  // Optional filters (used by the admin sector counts): one sector by slug, and/or only items a reviewer has verified (true) or has not verified yet (false). Values are parameters, never text in the SQL.
  const params: unknown[] = [st];
  let extra = "";
  if (filter.sector) { params.push(filter.sector); extra += " AND EXISTS (SELECT 1 FROM contribution_scopes f JOIN sectors fs ON fs.id = f.sector_id WHERE f.contribution_id = c.id AND fs.slug = $" + params.length + "::varchar)"; }
  if (filter.verified === true || filter.verified === false) extra += (filter.verified ? " AND EXISTS" : " AND NOT EXISTS") + " (SELECT 1 FROM contribution_reviews fr WHERE fr.contribution_id = c.id AND fr.action = 'verify')";
  const { rows } = await db.query(
    "SELECT c.id, c.title, c.type, c.status, c.submitted_at, " +
    "COALESCE((SELECT json_agg(s.name ORDER BY s.sort_order, s.slug) FROM contribution_scopes cs JOIN sectors s ON s.id = cs.sector_id WHERE cs.contribution_id = c.id), '[]'::json) AS sectors, " +
    "(SELECT count(*)::int FROM contribution_photos p WHERE p.contribution_id = c.id) AS photos " +
    "FROM contributions c WHERE c.status = $1::varchar AND NOT c.is_demo" + extra + " ORDER BY " + (st === "pending_review" ? "c.submitted_at ASC, c.id ASC" : "c.updated_at DESC, c.id DESC") + " LIMIT 100", params);
  return rows.map((r) => ({ id: Number(r.id), title: r.title, type: r.type, typeLabel: TYPE_LABEL.get(r.type) ?? "", status: r.status, statusLabel: STATUS_LABELS[r.status as ContributionStatus] ?? r.status, sectors: Array.isArray(r.sectors) ? r.sectors : [], submittedAt: r.submitted_at ? new Date(r.submitted_at).toISOString() : null, photos: Number(r.photos) }));
}

export type History = { action: string; note: string | null; at: string; by: string };
export type ReviewItem = QueueItem & {
  authorLabel: string; own: boolean; description: string; sections: { label: string; text: string }[]; role: string; district: string;
  photoList: { id: number; alt: string; mime: string }[]; contact: Contact | null; history: History[]; actions: Action[];
  duplicates: Duplicate[]; verified: boolean; replies: PortalEntry[]; notes: PortalEntry[];
};

/** One non-draft item to read. The contact details come back only through readContact: the author allowed reviewers AND the viewer is a flagged moderator. */
export async function getForReview(db: Db, viewerId: number, id: number, isAdmin = false): Promise<ReviewItem | null> {
  const { rows } = await db.query("SELECT id, user_id, title, body, type, status, submitted_at FROM contributions WHERE id = $1 AND status <> 'draft'", [id]);
  const c = rows[0];
  if (!c) return null;
  const sc = await db.query("SELECT s.name FROM contribution_scopes cs JOIN sectors s ON s.id = cs.sector_id WHERE cs.contribution_id = $1 ORDER BY s.sort_order, s.slug", [id]);
  const photos = await listPhotoMeta(db, [id]).catch(() => []);
  const contact = await readContact(db, id, viewerId).catch(() => null);
  let history: History[] = [];
  try {
    history = (await db.query("SELECT action, note, created_at, reviewer_id FROM contribution_reviews WHERE contribution_id = $1 ORDER BY created_at DESC, id DESC", [id])).rows
      .map((r) => ({ action: r.action, note: r.note, at: new Date(r.created_at).toISOString(), by: r.reviewer_id ? `Reviewer #${r.reviewer_id}` : "A reviewer" }));
  } catch (e) { if (code(e) !== "42P01") throw e; }
  const parts = splitBody(c.body);
  const labels: [keyof typeof parts, string][] = [["howNow", "How it is done now"], ["affected", "Who is affected"], ["timeCost", "Time or cost"], ["improvement", "What should improve"]];
  const own = Number(c.user_id) === viewerId;
  const display = displayStatus(c.status, (await roundFacts(db, [Number(c.id)])).get(Number(c.id)));
  const [replies, notes] = await Promise.all([repliesForReview(db, Number(c.id)), notesForReview(db, Number(c.id))]);
  return {
    id: Number(c.id), title: c.title, type: c.type, typeLabel: TYPE_LABEL.get(c.type) ?? "", status: c.status, statusLabel: STATUS_LABELS[c.status as ContributionStatus] ?? c.status, display, displayLabel: portalLabel(display),
    sectors: sc.rows.map((r) => r.name), submittedAt: c.submitted_at ? new Date(c.submitted_at).toISOString() : null, photos: photos.length,
    authorLabel: `Member #${c.user_id}`, own, description: parts.description, sections: labels.filter(([k]) => parts[k]).map(([k, l]) => ({ label: l, text: parts[k] })),
    role: parts.role, district: parts.district, photoList: photos.map((p) => ({ id: p.id, alt: p.alt, mime: p.mime })), contact, history,
    actions: own ? [] : (Object.keys(ACTIONS) as Action[]).filter((a) => ACTIONS[a].from === c.status && (isAdmin || !ACTIONS[a].adminOnly)),
    duplicates: c.status === "pending_review" || c.status === "unpublished" ? await findDuplicates(db, Number(c.id), c.title).catch(() => []) : [],
    verified: history.some((h) => h.action === "verify"), replies, notes,
  };
}

export function checkDecision(action: unknown, note: unknown): { ok: true; action: Action; note: string | null } | Fail {
  if (typeof action !== "string" || !(action in ACTIONS)) return fail(400, "VALIDATION_FAILED", "Choose a decision.", { action: "Choose a decision." });
  const a = action as Action;
  const n = typeof note === "string" ? note.replace(/\r\n/g, "\n").trim() : "";
  if (note !== undefined && note !== null && typeof note !== "string") return fail(400, "VALIDATION_FAILED", "Please fix the note.", { note: "The note must be text." });
  if (ACTIONS[a].note === "required" && n.length < NOTE_MIN) return fail(400, "VALIDATION_FAILED", "Please write a note for the author.", { note: `Write a short note for the author (at least ${NOTE_MIN} characters).` });
  if (n.length > NOTE_MAX) return fail(400, "VALIDATION_FAILED", "The note is too long.", { note: `Keep the note to ${NOTE_MAX} characters or fewer.` });
  if (hasControlChars(n.replace(/\n/g, " "))) return fail(400, "VALIDATION_FAILED", "Please fix the note.", { note: "The note has characters that are not allowed." });
  return { ok: true, action: a, note: n || null };
}

export async function decide(pool: Pool, reviewerId: number, id: number, rawAction: unknown, rawNote: unknown, isAdmin = false, confirmDuplicate: unknown = false): Promise<{ ok: true; id: number; status: string; action: Action } | Fail> {
  const v = checkDecision(rawAction, rawNote);
  if (!v.ok) return v as Fail;
  const ok = v as { action: Action; note: string | null };
  const rule = ACTIONS[ok.action];
  if (rule.adminOnly && !isAdmin) return fail(403, "ADMIN_ONLY", "Only an administrator can approve, publish, unpublish or remove a contribution. You can verify it, ask for changes or reject it.");
  const override = confirmDuplicate === true;
  if (override && (ok.note ?? "").length < NOTE_MIN) return fail(400, "VALIDATION_FAILED", "Please give a reason for approving a possible duplicate.", { note: `Write the reason (at least ${NOTE_MIN} characters).` });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT user_id, status FROM contributions WHERE id = $1 AND status <> 'draft' FOR UPDATE", [id]);
    const c = rows[0];
    if (!c) { await client.query("ROLLBACK"); return NOT_FOUND(); }
    if (Number(c.user_id) === reviewerId) { await client.query("ROLLBACK"); return fail(403, "OWN_ITEM", "You cannot review your own contribution. Another reviewer will."); }
    if (c.status !== rule.from) { await client.query("ROLLBACK"); return fail(409, "WRONG_STATUS", `That cannot be done now: this contribution is "${STATUS_LABELS[c.status as ContributionStatus] ?? c.status}". Reload the page to see where it stands.`); }
    let note = ok.note;
    if (rule.to === "published") { // re-checked here, inside the transaction, not only when the item was sent
      const dups = await findDuplicates(client, id, String((await client.query("SELECT title FROM contributions WHERE id = $1", [id])).rows[0]?.title ?? ""));
      if (dups.length && !override) { await client.query("ROLLBACK"); return { ...fail(409, "DUPLICATE_WARNING", "This looks like a duplicate of something already live in the same sector. Check it, then confirm with a reason if it really is different."), duplicates: dups }; }
      if (dups.length) note = `Approved despite a possible duplicate of ${dups.map((d) => "#" + d.id).join(", ")}: ${ok.note}`.slice(0, NOTE_MAX);
    }
    await client.query("INSERT INTO contribution_reviews (contribution_id, reviewer_id, action, note) VALUES ($1,$2,$3,$4)", [id, reviewerId, ok.action, note]);
    if (rule.to !== c.status) await client.query("UPDATE contributions SET status = $2::varchar, published_at = CASE WHEN $2::varchar = 'published' THEN now() END, updated_at = now() WHERE id = $1", [id, rule.to]);
    await client.query("COMMIT");
    return { ok: true, id, status: rule.to, action: ok.action };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (code(e) === "42P01" || code(e) === "42703") return NOT_SET_UP();
    // the database's own duplicate safeguard (migration 018) refused it: something with the same title went live in the meantime
    if (code(e) === "23505" && /contribution_title_keys/.test(String((e as { constraint?: string })?.constraint ?? (e as Error)?.message ?? ""))) return fail(409, "DUPLICATE", "Something with the same title is already live in the same sector. Nothing was changed.");
    // 23514 on a rule means migration 017 or 018 has not been applied (rejected / unpublished / removed / verify are not allowed yet): nothing was changed
    if (code(e) === "23514" && /contribution_reviews_(action|note)_ck/.test(String((e as { constraint?: string })?.constraint ?? (e as Error)?.message ?? ""))) return NOT_SET_UP();
    if (code(e) === "23514" && /contributions_status_ck/.test(String((e as { constraint?: string })?.constraint ?? (e as Error)?.message ?? ""))) return NOT_SET_UP();
    throw e;
  } finally { client.release(); }
}
