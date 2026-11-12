import { preflight, withCors } from "../../../../lib/cors";
import { json } from "../../../../lib/http";
import { pool } from "../../../../lib/db";
import { exportCsv } from "../../../../lib/contributionReview";
import { guardReviewer } from "../../../../lib/reviewerGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const METHODS = "GET, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);

/**
 * GET ?sector=<slug>&tab=&q=&cat=&sort= : one sector's list as CSV (every page of the same view, up to 2000 rows). Reviewers only.
 * Contact details only where the existing privacy query (readContact, the same as the screen) returns them; otherwise those cells stay empty.
 */
export async function GET(req: Request) {
  const g = await guardReviewer(req, METHODS);
  if ("res" in g) return g.res;
  const u = new URL(req.url);
  const slug = u.searchParams.get("sector") ?? "";
  const missing = () => withCors(req, json({ success: false, error: "NOT_FOUND", message: "We could not find that sector." }, 404), METHODS);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 60) return missing();
  try {
    const out = await exportCsv(pool as never, g.userId, slug, { tab: u.searchParams.get("tab") ?? undefined, q: u.searchParams.get("q") ?? undefined, category: u.searchParams.get("cat") ?? undefined, sort: u.searchParams.get("sort") ?? undefined });
    if (!out) return missing();
    return withCors(req, new Response(out.csv, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${out.filename}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }), METHODS);
  } catch (e) {
    if ((e as { code?: string })?.code === "42P01") return withCors(req, json({ success: false, error: "NOT_SET_UP", message: "Reviewing is not set up yet (migration 019 is needed)." }, 503), METHODS);
    console.error("review export failed: server error");
    return withCors(req, json({ success: false, error: "SERVER_ERROR", message: "Something went wrong. Please try again." }, 500), METHODS);
  }
}
