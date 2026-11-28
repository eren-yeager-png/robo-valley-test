// "My Contributions" (every portal): the signed-in person's OWN items, read-only: their ideas in the contribution workflow and what
// they sent with the current form, with the status a contributor sees, the reviewers' feedback and, for pending items of the current
// form, where to edit them. Any signed-in account (reviewers and administrators see their own items too). Never cached.
import { preflight } from "../../../../lib/cors";
import { pool } from "../../../../lib/db";
import { guardContributor } from "../../../../lib/contributorGuard";
import { myContributions } from "../../../../lib/cw/mine";
import { contributeReturnPath, mineReturnPath, siteUrl } from "../../../../lib/session";
import { crashed, ok } from "../../../../lib/cw/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const METHODS = "GET, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);

export async function GET(req: Request) {
  const g = await guardContributor(req, METHODS);
  if ("res" in g) return g.res;
  try {
    const site = siteUrl().replace(/\/+$/, "");
    const items = await myContributions(pool as never, g.userId, { editUrl: site + mineReturnPath() });
    return ok(req, { items, contributeUrl: site + contributeReturnPath() }, METHODS);
  } catch (e) {
    return crashed(req, e, METHODS, "mine");
  }
}
