// Public: the published ideas for the Community Ideas page. Reads ONLY the public records (cw_public_contributions), never the
// contributions themselves, so drafts, pending requests, notes, history and feedback can never appear. The contributor is shown by
// first name (and type, unless a minor or the setting says otherwise). Fetched every time the page is viewed: never cached.
import { preflight, withCors } from "../../../../lib/cors";
import { enforceRateLimit } from "../../../../lib/apiRateLimit";
import { pool } from "../../../../lib/db";
import { listPublic } from "../../../../lib/cw/store";
import { crashed, ok } from "../../../../lib/cw/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const METHODS = "GET, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);

export async function GET(req: Request) {
  const limited = await enforceRateLimit(req, "cwPublic");
  if (limited) return withCors(req, limited, METHODS);
  try {
    return ok(req, { items: await listPublic(pool as never) }, METHODS);
  } catch (e) {
    return crashed(req, e, METHODS, "public");
  }
}
