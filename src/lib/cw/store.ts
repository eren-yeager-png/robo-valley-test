// The contribution workflow's data: create, read, list and every state change. Each change is ONE transaction that locks the row,
// checks the row version (optimistic locking), asks the shared transition function (public/cw/js/rules.js) whether the step is
// allowed, writes the change, appends the history line with the real signed-in user's name, and adds 1 to row_version.
// The original submission (original, resource, reference_links, kind, contributor) is written once at creation and never updated by
// any code here; the database refuses it too (migration 027's trigger).
import * as R from "./shared";
import { loadSectors, roleLabel, type SectorOption } from "./lookups";
import { APPROVED, PORTAL_ACTIONS, portalHistory, portalNextStatus, portalStatusLabel } from "../../../public/cw/js/portal-rules.js";
import { audit, optional, reviewerRole } from "../portalAudit";
import { recordSuggestion } from "../fieldSuggestions";

export type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number }> };
export type Pool = Q & { connect: () => Promise<Q & { release: () => void }> };
export type Actor = { userId: number; name: string; isAdmin: boolean };
export type Fail = { ok: false; status: number; error: string; message: string };

export class NotSetUp extends Error {
  constructor() { super("The contribution workflow is not set up yet (migration 027 or 028)."); }
}
// The checks migration 028 widened: refusing a new value means the database has 027 but not 028 yet (not a fault of the request).
const WIDENED_BY_028 = ["cw_contributions_status_ck", "cw_contributions_published_ck", "cw_contribution_feedback_ck"];
const notSetUp = (e: unknown) => {
  const err = (e ?? {}) as { code?: string; constraint?: string };
  return ["42P01", "42703"].includes(err.code ?? "") || (err.code === "23514" && WIDENED_BY_028.includes(err.constraint ?? ""));
};
/** Runs fn; a missing workflow table (027 not applied) or a check 028 widens (028 not applied) becomes NotSetUp. */
export async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) { if (notSetUp(e)) throw new NotSetUp(); throw e; }
}

const fail = (status: number, error: string, message: string): Fail => ({ ok: false, status, error, message });
const j = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export function toContribution(row: any) {
  return {
    id: Number(row.id), code: R.codeOf(row.id), status: String(row.status), statusLabel: portalStatusLabel(String(row.status), R.STATUS_LABEL),
    kind: String(row.kind),
    contributor: {
      name: String(row.contributor_name), firstName: R.firstNameOf(row.contributor_name), typeCode: String(row.contributor_type),
      typeLabel: roleLabel(String(row.contributor_type)), minor: row.contributor_minor === true,
    },
    submittedAt: iso(row.submitted_at), resource: j(row.resource) ?? null, references: j(row.reference_links) ?? [],
    original: j(row.original), proposed: j(row.proposed), notes: String(row.notes ?? ""), moderator: row.moderator_name ?? null,
    previewedVersion: num(row.previewed_version), publishedVersion: num(row.published_version), publishedAt: iso(row.published_at),
    publishError: row.publish_error ?? null, publishAttempts: Number(row.publish_attempts ?? 0), rowVersion: Number(row.row_version),
    updatedAt: iso(row.updated_at),
  };
}
export type Contribution = ReturnType<typeof toContribution>;

const COLS = "id, user_id, contributor_name, contributor_type, contributor_minor, kind, resource, reference_links, original, proposed, notes, status, moderator_id, moderator_name, previewed_version, published_version, published_at, publish_error, publish_attempts, row_version, submitted_at, updated_at";

/** Creates a contribution (status Submitted, proposed = a copy of original) with its attachment and first history line. */
export async function createContribution(pool: Pool, input: {
  userId: number; profile: { fullName: string; roleCode: string; typeLabel: string; minor: boolean };
  value: any; attachment?: { fileName: string; mime: string; bytes: Uint8Array; sha256: string } | null;
}) {
  const v = input.value;
  const original = { title: v.title, description: v.description, sector: v.sector, robotType: v.robotType, categories: v.categories, suitableFor: v.suitableFor, learningPath: v.learningPath };
  return guarded(async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const row = (await c.query(
        `INSERT INTO cw_contributions (user_id, contributor_name, contributor_type, contributor_minor, kind, resource, reference_links, original, proposed)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $8::jsonb) RETURNING id`,
        [input.userId, input.profile.fullName, input.profile.roleCode, input.profile.minor, v.kind,
          v.resource ? JSON.stringify(v.resource) : null, JSON.stringify(v.references), JSON.stringify(original)])).rows[0];
      const id = Number(row.id);
      if (input.attachment) {
        await c.query("INSERT INTO cw_contribution_attachments (contribution_id, file_name, mime, byte_size, file_sha256, data) VALUES ($1, $2, $3, $4, $5, $6)",
          [id, input.attachment.fileName, input.attachment.mime, input.attachment.bytes.length, input.attachment.sha256, input.attachment.bytes]);
      }
      await c.query("INSERT INTO cw_contribution_history (contribution_id, actor, actor_user_id, text) VALUES ($1, $2, $3, $4)",
        [id, `${input.profile.fullName} (${input.profile.typeLabel})`, input.userId, R.history.submitted(v.kind, v.resource, v.references.length)]);
      // Contribution Portal (030): a "suggest a field" (a Suggestion about "Robots by Sector › <Sector>") is also recorded as a suggestion
      await recordSuggestion(c, { id, userId: input.userId, name: input.profile.fullName, kind: String(v.kind ?? ""), path: String(v.resource?.path ?? ""),
        title: String(v.title ?? ""), description: String(v.description ?? "") });
      await c.query("COMMIT");
      return { id, code: R.codeOf(id) };
    } catch (e) {
      await c.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  });
}

async function extras(db: Q, id: number) {
  const versions = (await db.query("SELECT v, by_name, role, data, notes, created_at FROM cw_contribution_versions WHERE contribution_id = $1 ORDER BY v", [id])).rows
    .map((r) => ({ v: Number(r.v), by: String(r.by_name), role: String(r.role), data: j(r.data), notes: String(r.notes ?? ""), at: iso(r.created_at) }));
  const feedback = (await db.query("SELECT type, text, by_name, created_at FROM cw_contribution_feedback WHERE contribution_id = $1 ORDER BY id", [id])).rows
    .map((r) => ({ type: String(r.type), text: String(r.text), by: String(r.by_name), at: iso(r.created_at) }));
  const history = (await db.query("SELECT actor, text, created_at FROM cw_contribution_history WHERE contribution_id = $1 ORDER BY id", [id])).rows
    .map((r) => ({ actor: String(r.actor), text: String(r.text), at: iso(r.created_at) }));
  const a = (await db.query("SELECT file_name, mime, byte_size FROM cw_contribution_attachments WHERE contribution_id = $1", [id])).rows[0];
  return { versions, feedback, history, attachment: a ? { name: String(a.file_name), mime: String(a.mime), size: Number(a.byte_size) } : null };
}

/** One contribution with its versions, feedback, history and attachment details (never the file itself). null = no such id. */
export async function getContribution(db: Q, id: number) {
  return guarded(async () => {
    const row = (await db.query(`SELECT ${COLS} FROM cw_contributions WHERE id = $1`, [id])).rows[0];
    if (!row) return null;
    return { ...toContribution(row), ...(await extras(db, id)) };
  });
}
export type Detail = NonNullable<Awaited<ReturnType<typeof getContribution>>>;

/** The list for a filter (status list, or null for all), newest first, and the numbers for the tab badges. `allowed`: the sectors of a
 *  reviewer limited to some (migration 030); null = every sector. */
export async function listContributions(db: Q, statuses: string[] | null, sectors: SectorOption[], allowed: string[] | null = null) {
  return guarded(async () => {
    const rows = (await db.query(`SELECT ${COLS} FROM cw_contributions WHERE ($1::varchar[] IS NULL OR status = ANY($1::varchar[]))
       AND ($2::varchar[] IS NULL OR proposed->>'sector' = ANY($2::varchar[])) ORDER BY submitted_at DESC, id DESC`, [statuses, allowed])).rows;
    const counts = (await db.query(
      `SELECT count(*) FILTER (WHERE status = ANY($1::varchar[]))::int AS open, count(*) FILTER (WHERE status = ANY($2::varchar[]))::int AS awaiting FROM cw_contributions
        WHERE ($3::varchar[] IS NULL OR proposed->>'sector' = ANY($3::varchar[]))`,
      [R.MOD_FILTERS.Open, R.ADM_FILTERS["Awaiting me"], allowed])).rows[0];
    // who declined (a Moderator) or rejected (an Admin) each Rejected idea, the reason and when: shown in the Admin's Rejected filter
    const rejectedIds = rows.filter((r) => r.status === R.STATUS.REJECTED).map((r) => Number(r.id));
    const decisions = new Map<number, { type: string; by: string; text: string; at: string | null }>();
    if (rejectedIds.length) {
      for (const f of (await db.query(
        `SELECT DISTINCT ON (contribution_id) contribution_id, type, text, by_name, created_at FROM cw_contribution_feedback
          WHERE contribution_id = ANY($1::bigint[]) AND type IN ('decline', 'reject') ORDER BY contribution_id, id DESC`, [rejectedIds])).rows) {
        decisions.set(Number(f.contribution_id), { type: String(f.type), by: String(f.by_name), text: String(f.text), at: iso(f.created_at) });
      }
    }
    const items = rows.map((row) => {
      const c = toContribution(row);
      return {
        id: c.id, code: c.code, status: c.status, statusLabel: c.statusLabel, title: c.proposed.title, kind: c.kind,
        contributorName: c.contributor.name, contributorType: c.contributor.typeLabel,
        sector: c.proposed.sector, sectorName: R.sectorLabel(c.proposed.sector, sectors), moderator: c.moderator,
        ...(decisions.has(c.id) ? { decision: decisions.get(c.id) } : {}),
      };
    });
    return { items, counts: { open: Number(counts.open), awaiting: Number(counts.awaiting) } };
  });
}

/** Spam protection: this member's ideas in the last 24 hours, and how many of them had the same title in the last few minutes. */
export async function recentSubmissions(db: Q, userId: number, title: string) {
  return guarded(async () => {
    const r = (await db.query(
      `SELECT count(*) FILTER (WHERE submitted_at > now() - interval '24 hours')::int AS day,
              count(*) FILTER (WHERE submitted_at > now() - make_interval(mins => $3::int) AND lower(btrim(original->>'title')) = lower(btrim($2::text)))::int AS same
         FROM cw_contributions WHERE user_id = $1`, [userId, title, R.LIMITS.duplicateMinutes])).rows[0];
    return { day: Number(r?.day ?? 0), same: Number(r?.same ?? 0) };
  });
}

/** A contributor's own ideas, newest first, with the status a contributor sees. */
export async function listMine(db: Q, userId: number) {
  return guarded(async () => (await db.query(
    "SELECT id, kind, original, status, submitted_at, published_at FROM cw_contributions WHERE user_id = $1 ORDER BY submitted_at DESC, id DESC", [userId])).rows
    .map((r) => ({
      id: Number(r.id), code: R.codeOf(r.id), kind: String(r.kind), title: String(j(r.original).title), status: String(r.status),
      statusLabel: R.CONTRIBUTOR_STATUS_LABEL[r.status] ?? "In review", submittedAt: iso(r.submitted_at),
      publishedAt: r.status === R.STATUS.PUBLISHED ? iso(r.published_at) : null, // shown only while the idea is public
    })));
}

/** The attachment file, for Moderators and Admins only (the caller checks the role). */
export async function getAttachment(db: Q, id: number) {
  return guarded(async () => {
    const a = (await db.query("SELECT file_name, mime, byte_size, data FROM cw_contribution_attachments WHERE contribution_id = $1", [id])).rows[0];
    return a ? { name: String(a.file_name), mime: String(a.mime), size: Number(a.byte_size), data: a.data as Uint8Array } : null;
  });
}

const reasonOf = (p: any) => (typeof p?.reason === "string" ? p.reason.trim() : typeof p?.feedback === "string" ? p.feedback.trim() : "");
/** The reason an action needs (decline, reject, request changes, reopen): required, at most LIMITS.reason characters. */
const reasonProblem = (reason: string) => (!reason ? R.MESSAGES.reasonRequired : reason.length > R.LIMITS.reason ? R.MESSAGES.tooLong : null);
const versionCount = async (c: Q, id: number) => Number((await c.query("SELECT count(*)::int AS n FROM cw_contribution_versions WHERE contribution_id = $1", [id])).rows[0].n);

/** The actions a Moderator may take: rules.js's, plus the Contribution Portal's Approve (portal-rules.js, needs migration 030). */
export const REVIEWER_ACTIONS: readonly string[] = [...R.MODERATOR_ACTIONS, ...PORTAL_ACTIONS];
/** What the Audit Log calls each action (opening and previewing are not decisions and are not logged). */
const AUDITED: Record<string, string> = {
  approve: "approve", save_draft: "edit", reset: "edit", send_request: "send_request", decline: "decline", admin_edit: "edit",
  request_changes: "request_changes", reject: "reject", unpublish: "unpublish", reopen: "reopen",
};

/**
 * Every Moderator and Admin action except publishing (see publish.ts). payload.rowVersion must be the row version the person saw
 * (except "open"). Each one also writes its Audit Log row in the same transaction (migration 030; skipped on an older database), and
 * fills 030's columns (who approved and when, when the request went to an Admin, the rejection reason, who edited it).
 * "approve" (the separate Approved step) needs 030: on an older database it answers NOT_SET_UP and changes nothing.
 * Returns { ok: true, detail, message? } or a Fail.
 */
export async function applyAction(pool: Pool, input: { id: number; actor: Actor; action: string; payload: any }): Promise<{ ok: true; detail: Detail; message?: string; record?: any } | Fail> {
  const { id, actor, action } = input;
  const p = input.payload && typeof input.payload === "object" ? input.payload : {};
  if (!REVIEWER_ACTIONS.includes(action) && !R.ADMIN_ACTIONS.includes(action)) return fail(400, "UNKNOWN_ACTION", R.MESSAGES.notAllowed);
  if (action === "publish") return fail(400, "UNKNOWN_ACTION", R.MESSAGES.notAllowed); // has its own procedure
  if (R.ADMIN_ACTIONS.includes(action) && !actor.isAdmin) return fail(403, "ADMIN_ONLY", R.MESSAGES.adminOnly);
  const sectors = ["save_draft", "send_request", "decline", "preview", "approve"].includes(action) ? await loadSectors(pool) : [];

  return guarded(async () => {
    const c = await pool.connect();
    let message: string | undefined, record: any;
    try {
      await c.query("BEGIN");
      const row = (await c.query(`SELECT ${COLS} FROM cw_contributions WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!row) { await c.query("ROLLBACK"); return fail(404, "NOT_FOUND", "We could not find that contribution."); }
      const cur = toContribution(row);
      if (action !== "open" && Number(p.rowVersion) !== cur.rowVersion) { await c.query("ROLLBACK"); return fail(409, "STALE", R.MESSAGES.stale); }
      const versions = await versionCount(c, id);
      const step = portalNextStatus(action, { status: cur.status, versions, publishedVersion: cur.publishedVersion });
      if (!step.ok) { await c.query("ROLLBACK"); return fail(409, "NOT_ALLOWED", R.MESSAGES.notAllowed); }
      const log = (text: string, who = actor.name, whoId: number | null = actor.userId) =>
        c.query("INSERT INTO cw_contribution_history (contribution_id, actor, actor_user_id, text) VALUES ($1, $2, $3, $4)", [id, who, whoId, text]);
      const update = (sets: string, params: unknown[]) =>
        c.query(`UPDATE cw_contributions SET ${sets}, row_version = row_version + 1, updated_at = now() WHERE id = $1`, [id, ...params]);
      const feedback = (type: string, text: string) =>
        c.query("INSERT INTO cw_contribution_feedback (contribution_id, type, text, by_user_id, by_name) VALUES ($1, $2, $3, $4, $5)", [id, type, text, actor.userId, actor.name]);
      // a Moderator's decline: kept as 'decline' (migration 028); a database without 028 only knows 'reject', so it is stored as that
      const declineFeedback = async (text: string) => {
        await c.query("SAVEPOINT cw_decline");
        try {
          await feedback("decline", text);
          await c.query("RELEASE SAVEPOINT cw_decline");
        } catch (e) {
          if ((e as { code?: string })?.code !== "23514") throw e;
          await c.query("ROLLBACK TO SAVEPOINT cw_decline");
          await feedback("reject", text);
        }
      };
      const proposedFromPayload = () => R.cleanProposed(p.proposed, { sectors, minor: cur.contributor.minor });
      const auditMeta: Record<string, unknown> = { code: cur.code, title: cur.proposed.title, from: cur.status, to: step.to };
      const notesFromPayload = () => (typeof p.notes === "string" ? p.notes.trim().slice(0, R.LIMITS.notes) : cur.notes);

      switch (action) {
        case "open":
          if (cur.status === R.STATUS.SUBMITTED) {
            await update("status = $2, moderator_id = $3, moderator_name = $4", [step.to, actor.userId, actor.name]);
            await log(R.history.opened());
          }
          break;
        case "save_draft": {
          const { error, value } = proposedFromPayload();
          if (error) { await c.query("ROLLBACK"); return fail(400, "VALIDATION_FAILED", error); }
          const ch = R.changedFields(value, cur.proposed);
          await update("status = $2, proposed = $3::jsonb, notes = $4, moderator_id = coalesce(moderator_id, $5), moderator_name = coalesce(moderator_name, $6)",
            [step.to, JSON.stringify(value), notesFromPayload(), actor.userId, actor.name]);
          await log(R.history.draft(ch));
          if (ch.length) await optional(c, "UPDATE cw_contributions SET edited_by = $2 WHERE id = $1", [id, actor.userId], true);
          auditMeta.changed = ch;
          message = R.MESSAGES.draftSaved;
          break;
        }
        case "reset":
          // from Approved the approval is undone too (back to the draft); otherwise the status stays
          await (cur.status !== step.to ? update("proposed = original, status = $2", [step.to]) : update("proposed = original", []));
          await log(R.history.reset());
          auditMeta.reset = true;
          break;
        case "approve": {
          // Approve as-is (no proposed sent: the current version) or Edit & approve (the edited version). Needs 030 (the columns below).
          const pr = p.proposed ? proposedFromPayload() : R.cleanProposed(cur.proposed, { sectors, minor: cur.contributor.minor });
          if (pr.error) { await c.query("ROLLBACK"); return fail(400, "VALIDATION_FAILED", pr.error); }
          const sendError = R.validateSend(pr.value);
          if (sendError) { await c.query("ROLLBACK"); return fail(400, "VALIDATION_FAILED", sendError); }
          const vsOriginal = R.changedFields(pr.value, cur.original);
          const editedNow = R.changedFields(pr.value, cur.proposed).length > 0;
          await update("status = $2, proposed = $3::jsonb, notes = $4, moderator_id = coalesce(moderator_id, $5), moderator_name = coalesce(moderator_name, $6), " +
            "approved_by = $5, approved_at = now(), edited_by = CASE WHEN $7::boolean THEN $5 ELSE edited_by END",
            [step.to, JSON.stringify(pr.value), notesFromPayload(), actor.userId, actor.name, editedNow || vsOriginal.length > 0]);
          await log(portalHistory.approved(vsOriginal));
          auditMeta.changed = vsOriginal;
          message = "Approved. It is not public: send the publishing request to an Admin when it is ready.";
          break;
        }
        case "send_request": {
          const { error, value } = proposedFromPayload();
          if (error) { await c.query("ROLLBACK"); return fail(400, "VALIDATION_FAILED", error); }
          const sendError = R.validateSend(value);
          if (sendError) { await c.query("ROLLBACK"); return fail(400, "VALIDATION_FAILED", sendError); }
          const notes = notesFromPayload();
          const resub = cur.status === R.STATUS.CHANGES || versions > 0;
          const n = versions + 1;
          await c.query("INSERT INTO cw_contribution_versions (contribution_id, v, by_user_id, by_name, role, data, notes) VALUES ($1, $2, $3, $4, 'Moderator', $5::jsonb, $6)",
            [id, n, actor.userId, actor.name, JSON.stringify(value), notes]);
          await update("status = $2, proposed = $3::jsonb, notes = $4, previewed_version = NULL, moderator_id = coalesce(moderator_id, $5), moderator_name = coalesce(moderator_name, $6)",
            [step.to, JSON.stringify(value), notes, actor.userId, actor.name]);
          await log(R.history.sent(resub, n, R.changedFields(value, cur.original)));
          // 030: when the request went; the one-step path (from review, not from Approved) is an approval too
          const oneStep = cur.status !== APPROVED;
          await optional(c, "UPDATE cw_contributions SET publish_requested_at = now(), approved_by = CASE WHEN $3::boolean THEN $2 ELSE approved_by END, " +
            "approved_at = CASE WHEN $3::boolean THEN now() ELSE approved_at END, edited_by = CASE WHEN $4::boolean THEN $2 ELSE edited_by END WHERE id = $1",
            [id, actor.userId, oneStep, R.changedFields(value, cur.proposed).length > 0], true);
          auditMeta.version = n;
          auditMeta.changed = R.changedFields(value, cur.original);
          message = `Request sent to Admin. Status: ${R.STATUS_LABEL[step.to]}. It is still not public.`;
          break;
        }
        case "decline": {
          const reason = reasonOf(p), problem = reasonProblem(reason);
          if (problem) { await c.query("ROLLBACK"); return fail(400, "VALIDATION_FAILED", problem); }
          const pr = p.proposed ? proposedFromPayload() : { error: null, value: cur.proposed };
          if (pr.error) { await c.query("ROLLBACK"); return fail(400, "VALIDATION_FAILED", pr.error); }
          await update("status = $2, proposed = $3::jsonb, notes = $4", [step.to, JSON.stringify(pr.value), notesFromPayload()]);
          await declineFeedback(reason); // a Moderator's decline: Admins see who, why and when in the Rejected filter
          await log(R.history.declined(reason));
          await optional(c, "UPDATE cw_contributions SET reject_reason = $2 WHERE id = $1", [id, reason], true);
          auditMeta.reason = reason;
          break;
        }
        case "preview": {
          if (Number(p.version) !== versions) { await c.query("ROLLBACK"); return fail(409, "STALE", R.MESSAGES.stale); }
          if (R.earnBlocked(cur.contributor.minor, cur.proposed.learningPath)) { await c.query("ROLLBACK"); return fail(409, "EARN_MINOR", R.MESSAGES.earnMinorPublish); }
          if (cur.previewedVersion !== versions) {
            await update("previewed_version = $2", [versions]);
            await log(R.history.previewed(versions));
          }
          record = R.toPublicRecord({ ...cur, version: versions }, { sectors, version: versions });
          break;
        }
        case "admin_edit": {
          const title = typeof p.title === "string" ? p.title.trim() : "", description = typeof p.description === "string" ? p.description.trim() : "";
          if (!title || !description) { await c.query("ROLLBACK"); return fail(400, "VALIDATION_FAILED", R.MESSAGES.sendLength); }
          if (title.length > R.LIMITS.title || description.length > R.LIMITS.description) { await c.query("ROLLBACK"); return fail(400, "VALIDATION_FAILED", R.MESSAGES.tooLong); }
          const next = { ...cur.proposed, title, description };
          const ch = R.changedFields(next, cur.proposed);
          if (ch.length) {
            const n = versions + 1;
            await c.query("INSERT INTO cw_contribution_versions (contribution_id, v, by_user_id, by_name, role, data, notes) VALUES ($1, $2, $3, $4, 'Admin', $5::jsonb, $6)",
              [id, n, actor.userId, actor.name, JSON.stringify(next), cur.notes]);
            await update("proposed = $2::jsonb, previewed_version = NULL", [JSON.stringify(next)]);
            // after publishing the live card stays as it is until the Admin previews and publishes this new version
            await log(R.AFTER_PUBLISHING.includes(cur.status) ? R.history.adminEditAfter(ch, n) : R.history.adminEdit(ch, n));
            await optional(c, "UPDATE cw_contributions SET edited_by = $2 WHERE id = $1", [id, actor.userId], true);
          }
          auditMeta.changed = ch;
          break;
        }
        case "request_changes":
        case "reject": {
          const reason = reasonOf(p), problem = reasonProblem(reason);
          if (problem) { await c.query("ROLLBACK"); return fail(400, "VALIDATION_FAILED", problem); }
          await update("status = $2", [step.to]);
          await feedback(action === "reject" ? "reject" : "changes", reason);
          await log(action === "reject" ? R.history.rejected(reason) : R.history.changes(reason));
          if (action === "reject") await optional(c, "UPDATE cw_contributions SET reject_reason = $2 WHERE id = $1", [id, reason], true);
          auditMeta.reason = reason;
          break;
        }
        case "unpublish": {
          // one transaction: the card goes and the status changes together, so the two can never disagree
          await c.query("DELETE FROM cw_public_contributions WHERE contribution_id = $1", [id]);
          const left = (await c.query("SELECT count(*)::int AS n FROM cw_public_contributions WHERE contribution_id = $1", [id])).rows[0];
          if (Number(left.n) !== 0) throw new Error("The public card was not removed.");
          await update("status = $2, previewed_version = NULL, publish_error = NULL", [step.to]); // publishing again needs a new preview
          await log(R.history.unpublished());
          message = R.MESSAGES.unpublished;
          break;
        }
        case "reopen": {
          const reason = reasonOf(p), problem = reasonProblem(reason);
          if (problem) { await c.query("ROLLBACK"); return fail(400, "VALIDATION_FAILED", problem); }
          await update("status = $2, previewed_version = NULL", [step.to]); // back to the Moderator who had it (if any)
          await feedback("reopen", reason);
          await log(R.history.reopened(reason));
          auditMeta.reason = reason;
          break;
        }
      }
      const kind = AUDITED[action];
      if (kind && (action !== "admin_edit" || ((auditMeta.changed as string[] | undefined) ?? []).length > 0)) {
        await audit(c, { actorId: actor.userId, actorName: actor.name, role: reviewerRole(actor.isAdmin), action: kind, targetType: "idea", targetId: id, meta: auditMeta }, true);
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
    const detail = (await getContribution(pool, id))!;
    return { ok: true as const, detail, ...(message ? { message } : {}), ...(record ? { record } : {}) };
  });
}

/** The public website's records (Community Ideas), newest first. The ONLY reader of public data: it never reads cw_contributions. */
export async function listPublic(db: Q) {
  return guarded(async () => (await db.query(`SELECT * FROM cw_public_contributions ORDER BY published_at DESC, contribution_id DESC`)).rows.map(publicRow));
}
/** One public record by contribution id, read exactly as the public list reads it (used to verify a publish). */
export async function readPublic(db: Q, id: number) {
  return guarded(async () => {
    const r = (await db.query("SELECT * FROM cw_public_contributions WHERE contribution_id = $1", [id])).rows[0];
    return r ? publicRow(r) : null;
  });
}
export function publicRow(r: any) {
  return {
    id: Number(r.contribution_id), code: R.codeOf(r.contribution_id), version: Number(r.version),
    title: String(r.title), description: String(r.description), sector: String(r.sector_slug), sectorName: String(r.sector_name),
    robotTypeName: String(r.robot_type_name), categories: j(r.categories) ?? [], suitableFor: j(r.suitable_for) ?? [], learningPath: String(r.learning_path ?? ""),
    kind: String(r.kind), resource: j(r.resource) ?? null, references: j(r.reference_links) ?? [],
    contributor: R.publicContributor(String(r.contributor_first_name), String(r.contributor_type ?? ""), r.contributor_minor === true),
    publishedAt: iso(r.published_at),
  };
}
