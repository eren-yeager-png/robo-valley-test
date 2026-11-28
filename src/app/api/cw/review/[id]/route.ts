// One contribution for a reviewer (GET: everything, including history, versions and feedback, never the attachment's bytes) and its
// actions (POST { action, rowVersion, ... }). The server decides: the shared transition function, the row version (409 when someone
// else changed it first), and who may do what (administrator-only actions answer 403 to everyone else).
import { preflight } from "../../../../../lib/cors";
import { readJson } from "../../../../../lib/http";
import { pool } from "../../../../../lib/db";
import { guardReviewer } from "../../../../../lib/reviewerGuard";
import { scopeProblem } from "../../../../../lib/reviewerSectors";
import { parseId } from "../../../../../lib/contributorGuard";
import { applyAction, getContribution, REVIEWER_ACTIONS, type Fail } from "../../../../../lib/cw/store";
import { publish, type Published } from "../../../../../lib/cw/publish";
import { actorOf } from "../../../../../lib/cw/reviewApi";
import { notifyAfter } from "../../../../../lib/cw/notify";
import * as R from "../../../../../lib/cw/shared";
import { crashed, failed, ok } from "../../../../../lib/cw/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const METHODS = "GET, POST, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);
const notFound = { ok: false as const, status: 404, error: "NOT_FOUND", message: "We could not find that contribution." };

/** The actions this API accepts: the reviewer's (with the Contribution Portal's Approve) and the administrator's (administrator-only ones answer
 *  403 to others). */
const ACCEPTED = new Set<string>([...REVIEWER_ACTIONS, ...R.ADMIN_ACTIONS]);

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardReviewer(req, METHODS);
  if ("res" in g) return g.res;
  const id = parseId((await ctx.params).id);
  if (id === null) return failed(req, notFound, METHODS);
  try {
    const scope = await scopeProblem(pool as never, g, { idea: id }); // a reviewer limited to some sectors (migration 030)
    if (scope) return failed(req, scope, METHODS);
    const item = await getContribution(pool as never, id);
    return item ? ok(req, { item }, METHODS) : failed(req, notFound, METHODS);
  } catch (e) {
    return crashed(req, e, METHODS, "review detail");
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardReviewer(req, METHODS, "modDecision");
  if ("res" in g) return g.res;
  const id = parseId((await ctx.params).id);
  if (id === null) return failed(req, notFound, METHODS);
  const body = await readJson(req, 64 * 1024);
  if ("error" in body) return body.error;
  const p = typeof body.body === "object" && body.body !== null && !Array.isArray(body.body) ? (body.body as Record<string, unknown>) : {};
  const action = typeof p.action === "string" ? p.action : "";
  if (!ACCEPTED.has(action)) return failed(req, { ok: false, status: 400, error: "UNKNOWN_ACTION", message: R.MESSAGES.notAllowed }, METHODS);
  try {
    const scope = await scopeProblem(pool as never, g, { idea: id });
    if (scope) return failed(req, scope, METHODS);
    const actor = await actorOf(g);
    if (action === "publish") {
      const pr = await publish(pool as never, { id, actor, rowVersion: p.rowVersion });
      if (!pr.ok) return failed(req, pr as Fail, METHODS);
      const done = pr as Published;
      if (done.published) notifyAfter("published", id);
      return ok(req, { item: done.detail, published: done.published }, METHODS);
    }
    const r = await applyAction(pool as never, { id, actor, action, payload: p });
    if (!r.ok) return failed(req, r as Fail, METHODS);
    if (action === "send_request") notifyAfter("sent", id);
    if (action === "decline" || action === "reject") notifyAfter("rejected", id);
    if (action === "request_changes") notifyAfter("changes", id);
    if (action === "reopen") notifyAfter("reopened", id);
    return ok(req, { item: r.detail, ...(r.message ? { message: r.message } : {}), ...(r.record ? { record: r.record } : {}) }, METHODS);
  } catch (e) {
    return crashed(req, e, METHODS, "review action");
  }
}
