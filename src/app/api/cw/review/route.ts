// The review lists: ?view=workspace (the reviewers' workspace) or ?view=approvals (Admin Approval Dashboard, administrators only), with
// a filter from the spec (Open, Awaiting Admin, ... / Awaiting me, ...). Also the numbers for the tab badges and, for the workspace,
// how many older (old form) contributions still wait in the existing Moderation page.
import { preflight } from "../../../../lib/cors";
import { pool } from "../../../../lib/db";
import { guardReviewer } from "../../../../lib/reviewerGuard";
import { earlierOpenCount, loadSectors } from "../../../../lib/cw/lookups";
import { listContributions } from "../../../../lib/cw/store";
import * as R from "../../../../lib/cw/shared";
import { crashed, failed, ok } from "../../../../lib/cw/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const METHODS = "GET, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);

export async function GET(req: Request) {
  const g = await guardReviewer(req, METHODS);
  if ("res" in g) return g.res;
  const url = new URL(req.url);
  const view = url.searchParams.get("view") === "approvals" ? "approvals" : "workspace";
  if (view === "approvals" && !g.isAdmin) return failed(req, { ok: false, status: 403, error: "ADMIN_ONLY", message: R.MESSAGES.adminOnly }, METHODS);
  const filters: Record<string, string[] | null> = view === "approvals" ? R.ADM_FILTERS : R.MOD_FILTERS;
  const asked = url.searchParams.get("filter") ?? "";
  const filter = Object.prototype.hasOwnProperty.call(filters, asked) ? asked : Object.keys(filters)[0];
  try {
    const sectors = await loadSectors(pool as never);
    const { items, counts } = await listContributions(pool as never, filters[filter], sectors);
    return ok(req, { view, filter, items, counts, ...(view === "workspace" ? { earlier: await earlierOpenCount(pool as never) } : {}) }, METHODS);
  } catch (e) {
    return crashed(req, e, METHODS, "review list");
  }
}
