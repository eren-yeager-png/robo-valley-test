import { preflight, withCors } from "../../../../../../lib/cors";
import { json, readJson } from "../../../../../../lib/http";
import { pool } from "../../../../../../lib/db";
import { decide, type Fail } from "../../../../../../lib/contributionReview";
import { guardReviewer } from "../../../../../../lib/reviewerGuard";
import { parseId } from "../../../../../../lib/contributorGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const METHODS = "POST, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);

/** Body: { action: "approve" | "request_changes" | "reject" | "unpublish" | "republish", note?: string }. One transaction, audited. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardReviewer(req, METHODS, "modDecision");
  if ("res" in g) return g.res;
  const id = parseId((await ctx.params).id);
  if (id === null) return withCors(req, json({ success: false, error: "NOT_FOUND", message: "We could not find that contribution." }, 404), METHODS);
  const body = await readJson(req, 4 * 1024);
  if ("error" in body) return withCors(req, body.error, METHODS);
  const o = typeof body.body === "object" && body.body !== null && !Array.isArray(body.body) ? (body.body as Record<string, unknown>) : {};
  try {
    const r = await decide(pool as never, g.userId, id, o.action, o.note);
    if (r.ok) return withCors(req, json({ success: true, id: r.id, status: r.status, action: r.action }), METHODS);
    const f = r as Fail;
    return withCors(req, json({ success: false, error: f.error, message: f.message, ...(f.fieldErrors ? { fieldErrors: f.fieldErrors } : {}) }, f.status), METHODS);
  } catch {
    console.error("moderation decision failed: server error");
    return withCors(req, json({ success: false, error: "SERVER_ERROR", message: "Something went wrong. Nothing was changed. Please try again." }, 500), METHODS);
  }
}
