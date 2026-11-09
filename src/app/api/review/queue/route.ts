import { preflight, withCors } from "../../../../lib/cors";
import { json } from "../../../../lib/http";
import { pool } from "../../../../lib/db";
import { listQueue } from "../../../../lib/contributionReview";
import { guardReviewer } from "../../../../lib/reviewerGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const METHODS = "GET, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);

/** Reviewers only. ?status=pending_review (default), changes_requested, published, unpublished or rejected. Never cached. */
export async function GET(req: Request) {
  const g = await guardReviewer(req, METHODS);
  if ("res" in g) return g.res;
  try {
    const items = await listQueue(pool as never, new URL(req.url).searchParams.get("status") ?? "pending_review");
    return withCors(req, json({ success: true, items }), METHODS);
  } catch (e) {
    if ((e as { code?: string })?.code === "42P01") return withCors(req, json({ success: false, error: "NOT_SET_UP", message: "Reviewing is not set up yet." }, 503), METHODS);
    console.error("review queue failed: server error");
    return withCors(req, json({ success: false, error: "SERVER_ERROR", message: "The list could not be loaded. Please try again." }, 500), METHODS);
  }
}
