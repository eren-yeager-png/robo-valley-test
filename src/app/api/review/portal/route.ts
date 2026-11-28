// Contribution Portal (reads only): the sector grid and the rows of Moderation (?view=moderation, every reviewer), Publish Requests
// (?view=requests) and the Admin's Overview (?view=overview), administrators only, for both kinds of contributions. ?sector=<slug>
// picks one sector (Moderation opens the one with the most waiting when none is given). Every change goes through the existing routes.
import { preflight, withCors } from "../../../../lib/cors";
import { json } from "../../../../lib/http";
import { pool } from "../../../../lib/db";
import { guardReviewer } from "../../../../lib/reviewerGuard";
import { PORTAL_VIEWS, PortalNotSetUp, portalData, type PortalView } from "../../../../lib/portalReview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const METHODS = "GET, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export async function GET(req: Request) {
  const g = await guardReviewer(req, METHODS);
  if ("res" in g) return g.res;
  const url = new URL(req.url);
  const asked = url.searchParams.get("view") ?? "moderation";
  const view: PortalView = (PORTAL_VIEWS as readonly string[]).includes(asked) ? (asked as PortalView) : "moderation";
  if (view !== "moderation" && !g.isAdmin) return withCors(req, json({ success: false, error: "ADMIN_ONLY", message: "Only an administrator can open this." }, 403), METHODS);
  const raw = url.searchParams.get("sector") ?? "";
  const sector = raw.length <= 60 && SLUG.test(raw) ? raw : "";
  try {
    const { absent: _absent, ...data } = await portalData(pool as never, { view, sector, viewerId: g.userId, isAdmin: g.isAdmin, allowed: g.sectors });
    return withCors(req, json({ success: true, ...data }), METHODS);
  } catch (e) {
    if (e instanceof PortalNotSetUp) return withCors(req, json({ success: false, error: "NOT_SET_UP", message: e.message }, 503), METHODS);
    console.error("review portal failed: server error");
    return withCors(req, json({ success: false, error: "SERVER_ERROR", message: "The contributions could not be loaded. Please try again." }, 500), METHODS);
  }
}
