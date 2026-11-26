// The signed-in member's own ideas (new form), read-only: number, title, type of request and the status a contributor sees.
import { preflight } from "../../../../lib/cors";
import { pool } from "../../../../lib/db";
import { guardContributor } from "../../../../lib/contributorGuard";
import { listMine } from "../../../../lib/cw/store";
import { crashed, ok } from "../../../../lib/cw/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const METHODS = "GET, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);

export async function GET(req: Request) {
  const g = await guardContributor(req, METHODS);
  if ("res" in g) return g.res;
  try {
    return ok(req, { items: await listMine(pool as never, g.userId) }, METHODS);
  } catch (e) {
    return crashed(req, e, METHODS, "mine");
  }
}
