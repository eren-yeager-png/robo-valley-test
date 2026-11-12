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
// Portal PR2: the sector overview, one sector's list (tabs, search, category filter, sort, pages of 20), the detail view's contributor,
// structured categories and timeline, previous / next, and the CSV export. Contact details only ever come through readContact (the
// author allowed it AND the viewer is a flagged moderator), also in the CSV.
import { readContact, type Contact } from "./contributionContacts";
import { listPhotoMeta } from "./contributionPhotos";
import { splitBody } from "./contributionApi";
import { CONTRIBUTION_TYPES, STATUS_LABELS, type ContributionStatus } from "./contributions";
import { hasControlChars } from "./validation";
import { NEAR_DUPLICATE_SIMILARITY, normText, similarity } from "./spreadsheet/dedupe";
import { displayStatus, portalLabel, roundFacts, type DisplayStatus } from "./reviewStatus";
import { repliesForReview, type PortalEntry } from "./contributionReplies";
import { notesForReview } from "./contributionNotes";
import { PORTAL_TABS, ROUND_START_SQL } from "./reviewStatus";
import { directoryFor, splitFold, type DirectoryEntry } from "./directoryCategories";
import { ROLES } from "./roles";

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
/** The reason for not accepting is read by the contributor: at least 5 characters (portal PR2). */
export const REJECT_MIN = 5;
const TYPE_LABEL = new Map<string, string>(CONTRIBUTION_TYPES.map((t) => [t.id, t.label]));

export type Fail = { ok: false; status: number; error: string; message: string; fieldErrors?: Record<string, string>; duplicates?: Duplicate[] };
const fail = (status: number, error: string, message: string, fieldErrors?: Record<string, string>): Fail => ({ ok: false, status, error, message, ...(fieldErrors ? { fieldErrors } : {}) });
const NOT_SET_UP = () => fail(503, "NOT_SET_UP", "Reviewing is not set up yet.");
const NOT_FOUND = () => fail(404, "NOT_FOUND", "We could not find that contribution.");
const code = (e: unknown) => (e as { code?: string })?.code;

export type QueueItem = { id: number; title: string; type: string; typeLabel: string; status: ContributionStatus; statusLabel: string; display: DisplayStatus; displayLabel: string; sectors: string[]; submittedAt: string | null; photos: number };

/** A page of the queue for one status (oldest first for the pending list, so nothing waits forever). Drafts are never listed. */
export async function listQueue(db: Db, status: string): Promise<QueueItem[]> {
  const st = (QUEUE_STATUSES as readonly string[]).includes(status) ? status : "pending_review";
  const { rows } = await db.query(
    "SELECT c.id, c.title, c.type, c.status, c.submitted_at, " +
    "COALESCE((SELECT json_agg(s.name ORDER BY s.sort_order, s.slug) FROM contribution_scopes cs JOIN sectors s ON s.id = cs.sector_id WHERE cs.contribution_id = c.id), '[]'::json) AS sectors, " +
    "(SELECT count(*)::int FROM contribution_photos p WHERE p.contribution_id = c.id) AS photos " +
    "FROM contributions c WHERE c.status = $1::varchar AND NOT c.is_demo ORDER BY " + (st === "pending_review" ? "c.submitted_at ASC, c.id ASC" : "c.updated_at DESC, c.id DESC") + " LIMIT 100", [st]);
  const facts = st === "pending_review" ? await roundFacts(db, rows.map((r) => Number(r.id))) : new Map();
  return rows.map((r) => {
    const display = displayStatus(r.status, facts.get(Number(r.id)));
    return { id: Number(r.id), title: r.title, type: r.type, typeLabel: TYPE_LABEL.get(r.type) ?? "", status: r.status, statusLabel: STATUS_LABELS[r.status as ContributionStatus] ?? r.status, display, displayLabel: portalLabel(display), sectors: Array.isArray(r.sectors) ? r.sectors : [], submittedAt: r.submitted_at ? new Date(r.submitted_at).toISOString() : null, photos: Number(r.photos) };
  });
}

export type History = { action: string; note: string | null; at: string; by: string };
export type ReviewItem = QueueItem & {
  authorLabel: string; own: boolean; description: string; sections: { label: string; text: string }[]; role: string; district: string;
  photoList: { id: number; alt: string; mime: string }[]; contact: Contact | null; history: History[]; actions: Action[];
  duplicates: Duplicate[]; verified: boolean; replies: PortalEntry[]; notes: PortalEntry[];
  /** portal PR2 */ contributor: string; stakeholder: string; categories: DirectoryEntry[] | null; timeline: TimelineEntry[]; reason: string | null; sectorSlugs: string[];
};
export type TimelineEntry = { at: string; text: string; detail: string | null };

/** One non-draft item to read. The contact details come back only through readContact: the author allowed reviewers AND the viewer is a flagged moderator. */
export async function getForReview(db: Db, viewerId: number, id: number, isAdmin = false): Promise<ReviewItem | null> {
  const { rows } = await db.query("SELECT c.id, c.user_id, c.title, c.body, c.type, c.status, c.submitted_at, u.full_name, u.role AS user_role FROM contributions c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = $1 AND c.status <> 'draft'", [id]);
  const c = rows[0];
  if (!c) return null;
  const sc = await db.query("SELECT s.name, s.slug FROM contribution_scopes cs JOIN sectors s ON s.id = cs.sector_id WHERE cs.contribution_id = $1 ORDER BY s.sort_order, s.slug", [id]);
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
  const categories = (await directoryFor(db, [Number(c.id)])).get(Number(c.id)) ?? null;
  const contributor = contributorLabel(c.full_name), reviewNames = await reviewerNames(db, Number(c.id));
  const timeline: TimelineEntry[] = [
    ...(c.submitted_at ? [{ at: new Date(c.submitted_at).toISOString(), text: `Submitted by ${contributor}`, detail: null }] : []),
    ...history.map((h, i) => ({ at: h.at, text: `${TIMELINE_WORDS[h.action] ?? h.action} by ${reviewNames[i] ?? "a reviewer"}`, detail: h.note })),
    ...replies.map((r) => ({ at: r.at, text: `Replied to the contributor: ${r.by}`, detail: r.text })),
    ...notes.map((n) => ({ at: n.at, text: `Internal note: ${n.by}`, detail: n.text })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return {
    id: Number(c.id), title: c.title, type: c.type, typeLabel: TYPE_LABEL.get(c.type) ?? "", status: c.status, statusLabel: STATUS_LABELS[c.status as ContributionStatus] ?? c.status, display, displayLabel: portalLabel(display),
    sectors: sc.rows.map((r) => r.name), submittedAt: c.submitted_at ? new Date(c.submitted_at).toISOString() : null, photos: photos.length,
    authorLabel: `Member #${c.user_id}`, own, description: parts.description, sections: labels.filter(([k]) => parts[k]).map(([k, l]) => ({ label: l, text: parts[k] })),
    role: parts.role, district: parts.district, photoList: photos.map((p) => ({ id: p.id, alt: p.alt, mime: p.mime })), contact, history,
    actions: own ? [] : (Object.keys(ACTIONS) as Action[]).filter((a) => ACTIONS[a].from === c.status && (isAdmin || !ACTIONS[a].adminOnly)),
    duplicates: c.status === "pending_review" || c.status === "unpublished" ? await findDuplicates(db, Number(c.id), c.title).catch(() => []) : [],
    verified: history.some((h) => h.action === "verify"), replies, notes,
    contributor, stakeholder: stakeholderLabel(c.user_role), categories, sectorSlugs: sc.rows.map((r) => r.slug),
    // with structured categories the folded copy is left out of the description; an older item shows its description as it is
    ...(categories ? { description: splitFold(parts.description).text } : {}),
    timeline, reason: ["rejected", "removed", "changes_requested", "unpublished"].includes(c.status) ? history.find((h) => h.note && ["reject", "remove", "request_changes", "unpublish"].includes(h.action))?.note ?? null : null,
  };
}

export function checkDecision(action: unknown, note: unknown): { ok: true; action: Action; note: string | null } | Fail {
  if (typeof action !== "string" || !(action in ACTIONS)) return fail(400, "VALIDATION_FAILED", "Choose a decision.", { action: "Choose a decision." });
  const a = action as Action;
  const n = typeof note === "string" ? note.replace(/\r\n/g, "\n").trim() : "";
  if (note !== undefined && note !== null && typeof note !== "string") return fail(400, "VALIDATION_FAILED", "Please fix the note.", { note: "The note must be text." });
  if (ACTIONS[a].note === "required" && n.length < NOTE_MIN) return fail(400, "VALIDATION_FAILED", "Please write a note for the author.", { note: `Write a short note for the author (at least ${NOTE_MIN} characters).` });
  if (a === "reject" && n.length < REJECT_MIN) return fail(400, "VALIDATION_FAILED", "Please give the reason the contributor will see.", { note: `Write the reason for not accepting (at least ${REJECT_MIN} characters).` });
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

/* ---------- portal PR2: the sector overview, one sector's list, previous / next, the CSV ---------- */

const TIMELINE_WORDS: Record<string, string> = { verify: "Marked as verified", approve: "Approved and published", request_changes: "Changes requested", reject: "Not accepted", remove: "Removed", unpublish: "Unpublished", republish: "Published again" };

/** "Asha Kumari Rao" -> "Asha R." (first name and the last name's initial, as in the agreed design); one word stays as it is. */
export function contributorLabel(fullName: unknown): string {
  const w = typeof fullName === "string" ? fullName.trim().split(/\s+/).filter(Boolean) : [];
  if (w.length === 0) return "A member";
  return (w.length === 1 ? w[0]! : `${w[0]} ${w[w.length - 1]![0]!.toUpperCase()}.`).slice(0, 60);
}
export const stakeholderLabel = (role: unknown) => (role === "admin" ? "Administrator" : ROLES.find((r) => r[0] === role)?.[1] ?? "");

/** The first names of the reviewers behind each decision, in the same order as getForReview's history (newest first). */
async function reviewerNames(db: Db, id: number): Promise<string[]> {
  try {
    const { rows } = await db.query("SELECT u.full_name FROM contribution_reviews r LEFT JOIN users u ON u.id = r.reviewer_id WHERE r.contribution_id = $1 ORDER BY r.created_at DESC, r.id DESC", [id]);
    return rows.map((r) => (typeof r.full_name === "string" && r.full_name.trim() ? r.full_name.trim().split(/\s+/)[0]!.slice(0, 40) : "a former reviewer"));
  } catch { return []; }
}

export type PortalTab = (typeof PORTAL_TABS)[number] | "all";
export const PORTAL_TAB_LIST: readonly PortalTab[] = [...PORTAL_TABS, "all"];
export const PAGE_SIZE = 20;
export type PortalSort = "new" | "old";
export type ListOptions = { tab?: string; q?: string; category?: string; sort?: string; page?: number };

export type SectorCard = { slug: string; name: string; contributions: number; contributors: number; pending: number; published: number; rejected: number };
export type PortalTotals = { all: number; pending: number; published: number; rejected: number };

/** Every active sector (including the ones with nothing yet), with its numbers. An item in several sectors counts under each. Drafts, removed and demo items never count. */
export async function sectorOverview(db: Db): Promise<{ totals: PortalTotals; sectors: SectorCard[] }> {
  const live = "c.status NOT IN ('draft','removed') AND NOT c.is_demo";
  const t = (await db.query(`SELECT count(*)::int AS all_n, count(*) FILTER (WHERE c.status = 'pending_review')::int AS pending, count(*) FILTER (WHERE c.status = 'published')::int AS published, count(*) FILTER (WHERE c.status = 'rejected')::int AS rejected FROM contributions c WHERE ${live}`)).rows[0] ?? {};
  const { rows } = await db.query(
    "SELECT s.slug, s.name, count(DISTINCT c.id)::int AS contributions, count(DISTINCT c.user_id)::int AS contributors, " +
    "count(DISTINCT c.id) FILTER (WHERE c.status = 'pending_review')::int AS pending, count(DISTINCT c.id) FILTER (WHERE c.status = 'published')::int AS published, " +
    "count(DISTINCT c.id) FILTER (WHERE c.status = 'rejected')::int AS rejected " +
    `FROM sectors s LEFT JOIN contribution_scopes cs ON cs.sector_id = s.id LEFT JOIN contributions c ON c.id = cs.contribution_id AND ${live} ` +
    "WHERE s.is_active AND NOT s.is_demo GROUP BY s.id ORDER BY s.sort_order, s.name");
  return {
    totals: { all: Number(t.all_n ?? 0), pending: Number(t.pending ?? 0), published: Number(t.published ?? 0), rejected: Number(t.rejected ?? 0) },
    sectors: rows.map((r) => ({ slug: r.slug, name: r.name, contributions: Number(r.contributions), contributors: Number(r.contributors), pending: Number(r.pending), published: Number(r.published), rejected: Number(r.rejected) })),
  };
}

export type PortalRow = {
  id: number; title: string; alsoIn: string[]; contributor: string; stakeholder: string; categories: string[];
  submittedAt: string | null; status: ContributionStatus; display: DisplayStatus; displayLabel: string;
};
export type SectorList = {
  sector: { slug: string; name: string }; tab: PortalTab; sort: PortalSort; q: string; category: string;
  counts: Record<PortalTab, number>; contributions: number; contributors: number;
  rows: PortalRow[]; page: number; pages: number; matching: number; categoriesUsed: string[];
};
type FullRow = PortalRow & { userId: number };

/** One sector's items with everything the list, the CSV and previous / next need. Needs migration 019. */
async function sectorRows(db: Db, slug: string): Promise<{ sector: { slug: string; name: string }; rows: FullRow[] } | null> {
  const sec = (await db.query("SELECT slug, name FROM sectors WHERE slug = $1 AND NOT is_demo", [slug])).rows[0];
  if (!sec) return null;
  const { rows } = await db.query(
    "SELECT c.id, c.title, c.status, c.submitted_at, c.user_id, u.full_name, u.role AS user_role, " +
    `EXISTS (SELECT 1 FROM contribution_replies p WHERE p.contribution_id = c.id AND p.created_at >= ${ROUND_START_SQL}) AS replied, ` +
    `EXISTS (SELECT 1 FROM contribution_views v WHERE v.contribution_id = c.id AND v.last_viewed_at >= ${ROUND_START_SQL}) AS viewed, ` +
    "COALESCE((SELECT json_agg(s2.name ORDER BY s2.sort_order, s2.slug) FROM contribution_scopes cs2 JOIN sectors s2 ON s2.id = cs2.sector_id WHERE cs2.contribution_id = c.id AND s2.slug <> $1), '[]'::json) AS also_in, " +
    "COALESCE((SELECT json_agg(cc.category ORDER BY cc.position) FROM contribution_categories cc WHERE cc.contribution_id = c.id), '[]'::json) AS categories " +
    "FROM contributions c JOIN contribution_scopes cs ON cs.contribution_id = c.id JOIN sectors s ON s.id = cs.sector_id AND s.slug = $1 " +
    "LEFT JOIN users u ON u.id = c.user_id WHERE c.status NOT IN ('draft','removed') AND NOT c.is_demo", [slug]);
  return {
    sector: { slug: sec.slug, name: sec.name },
    rows: rows.map((r) => {
      const display = displayStatus(r.status, { replied: r.replied === true, viewed: r.viewed === true });
      return {
        id: Number(r.id), title: r.title, alsoIn: Array.isArray(r.also_in) ? r.also_in : [], contributor: contributorLabel(r.full_name), stakeholder: stakeholderLabel(r.user_role),
        categories: Array.isArray(r.categories) ? r.categories : [], submittedAt: r.submitted_at ? new Date(r.submitted_at).toISOString() : null,
        status: r.status, display, displayLabel: portalLabel(display), userId: Number(r.user_id),
      };
    }),
  };
}

const cleanOptions = (o: ListOptions) => ({
  tab: (PORTAL_TAB_LIST as readonly string[]).includes(o.tab ?? "") ? (o.tab as PortalTab) : ("new" as PortalTab),
  q: typeof o.q === "string" ? o.q.replace(/\s+/g, " ").trim().slice(0, 100) : "",
  category: typeof o.category === "string" ? o.category.trim().slice(0, 40) : "",
  sort: (o.sort === "old" ? "old" : "new") as PortalSort,
  page: Number.isSafeInteger(o.page) && (o.page as number) > 0 ? (o.page as number) : 1,
});

/** The tab, search, category filter and sort applied (no pages). */
function applyOptions(rows: FullRow[], o: ReturnType<typeof cleanOptions>): FullRow[] {
  const q = o.q.toLowerCase();
  const out = rows.filter((r) => (o.tab === "all" || r.display === o.tab) && (!o.category || r.categories.includes(o.category)) && (!q || `${r.title} ${r.contributor}`.toLowerCase().includes(q)));
  const time = (r: FullRow) => (r.submittedAt ? Date.parse(r.submittedAt) : 0);
  return out.sort((a, b) => (o.sort === "old" ? time(a) - time(b) || a.id - b.id : time(b) - time(a) || b.id - a.id));
}

export async function sectorList(db: Db, slug: string, opts: ListOptions = {}): Promise<SectorList | null> {
  const data = await sectorRows(db, slug);
  if (!data) return null;
  const o = cleanOptions(opts);
  const counts = Object.fromEntries(PORTAL_TAB_LIST.map((t) => [t, t === "all" ? data.rows.length : data.rows.filter((r) => r.display === t).length])) as Record<PortalTab, number>;
  const matching = applyOptions(data.rows, o);
  const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const page = Math.min(o.page, pages);
  return {
    sector: data.sector, tab: o.tab, sort: o.sort, q: o.q, category: o.category, counts,
    contributions: data.rows.length, contributors: new Set(data.rows.map((r) => r.userId)).size,
    rows: matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(({ userId: _u, ...r }) => r), page, pages, matching: matching.length,
    categoriesUsed: [...new Set(data.rows.flatMap((r) => r.categories))],
  };
}

/** The items before and after this one in the same sector list (same tab, search, filter and sort), for Previous / Next. */
export async function neighbours(db: Db, slug: string, opts: ListOptions, id: number): Promise<{ prev: number | null; next: number | null; position: number; of: number }> {
  const data = await sectorRows(db, slug);
  if (!data) return { prev: null, next: null, position: 0, of: 0 };
  // the open item stays in the list it was opened from, even though opening it moved it from New to In review
  const o = cleanOptions(opts), here = data.rows.find((r) => r.id === id);
  const list = applyOptions(data.rows, o);
  if (here && !list.some((r) => r.id === id)) { list.push(here); list.splice(0, list.length, ...applyOptions(list, { ...o, tab: "all", q: "", category: "" })); }
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) return { prev: null, next: null, position: 0, of: list.length };
  return { prev: list[i - 1]?.id ?? null, next: list[i + 1]?.id ?? null, position: i + 1, of: list.length };
}

export const EXPORT_MAX_ROWS = 2000;
/** One CSV cell: quoted, quotes doubled, and a leading = + - @ (or tab / carriage return) neutralised so a spreadsheet never runs it as a formula. */
export function csvCell(v: unknown): string {
  let t = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return '"' + t.replace(/"/g, '""') + '"';
}

/**
 * The sector list as CSV (the same tab, search, filter and sort, every page, up to EXPORT_MAX_ROWS). Contact details come only from
 * readContact, the same privacy rule as the screen: empty unless the author shared them AND the viewer is a flagged moderator.
 */
export async function exportCsv(db: Db, viewerId: number, slug: string, opts: ListOptions): Promise<{ filename: string; csv: string; rows: number } | null> {
  const data = await sectorRows(db, slug);
  if (!data) return null;
  const list = applyOptions(data.rows, cleanOptions({ ...opts, page: 1 })).slice(0, EXPORT_MAX_ROWS);
  const header = ["ID", "Title", "Also in", "Contributor", "Stakeholder category", "Directory categories", "Submitted", "Status", "Contact name", "Contact email", "Contact mobile"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of list) {
    const contact = await readContact(db, r.id, viewerId).catch(() => null);
    lines.push([r.id, r.title, r.alsoIn.join("; "), r.contributor, r.stakeholder, r.categories.join("; "), r.submittedAt ?? "", r.displayLabel, contact?.name ?? "", contact?.email ?? "", contact?.phone ?? ""].map(csvCell).join(","));
  }
  const day = new Date().toISOString().slice(0, 10);
  return { filename: `contributions-${data.sector.slug}-${day}.csv`, csv: "\uFEFF" + lines.join("\r\n") + "\r\n", rows: list.length };
}
