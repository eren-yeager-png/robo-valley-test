import { preflight, withCors } from "../../../../../lib/cors";
import { json, readJson } from "../../../../../lib/http";
import { pool } from "../../../../../lib/db";
import { addNote } from "../../../../../lib/contributionNotes";
import { type Fail } from "../../../../../lib/contributionReplies";
import { guardReviewer } from "../../../../../lib/reviewerGuard";
import { parseId } from "../../../../../lib/contributorGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const METHODS = "POST, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);

/** Body: { note: string } (3 to 1000 characters). An internal note: reviewers only, never shown to the contributor, never on their own item; saved with who and when. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardReviewer(req, METHODS, "modDecision");
  if ("res" in g) return g.res;
  const id = parseId((await ctx.params).id);
  if (id === null) return withCors(req, json({ success: false, error: "NOT_FOUND", message: "We could not find that contribution." }, 404), METHODS);
  const body = await readJson(req, 4 * 1024);
  if ("error" in body) return withCors(req, body.error, METHODS);
  const o = typeof body.body === "object" && body.body !== null && !Array.isArray(body.body) ? (body.body as Record<string, unknown>) : {};
  try {
    const r = await addNote(pool as never, g.userId, id, o.note);
    if (r.ok) return withCors(req, json({ success: true, id: r.id, at: r.at }, 201), METHODS);
    const f = r as Fail;
    return withCors(req, json({ success: false, error: f.error, message: f.message, ...(f.fieldErrors ? { fieldErrors: f.fieldErrors } : {}) }, f.status), METHODS);
  } catch {
    console.error("review note failed: server error");
    return withCors(req, json({ success: false, error: "SERVER_ERROR", message: "Something went wrong. Nothing was saved. Please try again." }, 500), METHODS);
  }
}
