import { preflight, withCors } from "../../../../lib/cors";
import { json } from "../../../../lib/http";
import { pool } from "../../../../lib/db";
import { getForReview } from "../../../../lib/contributionReview";
import { guardReviewer } from "../../../../lib/reviewerGuard";
import { parseId } from "../../../../lib/contributorGuard";
import { recordView } from "../../../../lib/contributionViews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const METHODS = "GET, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);

/** One submitted item to read, with its audit trail, replies and internal notes. Contact details appear only when the author allowed reviewers to see them. Opening it records the view (not on your own item). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardReviewer(req, METHODS);
  if ("res" in g) return g.res;
  const id = parseId((await ctx.params).id);
  const missing = () => withCors(req, json({ success: false, error: "NOT_FOUND", message: "We could not find that contribution." }, 404), METHODS);
  if (id === null) return missing();
  try {
    await recordView(pool as never, g.userId, id);
    const item = await getForReview(pool as never, g.userId, id, g.isAdmin);
    return item ? withCors(req, json({ success: true, item }), METHODS) : missing();
  } catch (e) {
    if ((e as { code?: string })?.code === "42P01") return withCors(req, json({ success: false, error: "NOT_SET_UP", message: "Reviewing is not set up yet." }, 503), METHODS);
    console.error("review read failed: server error");
    return withCors(req, json({ success: false, error: "SERVER_ERROR", message: "Something went wrong. Please try again." }, 500), METHODS);
  }
}
