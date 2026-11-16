import { preflight, withCors } from "../../../../lib/cors";
import { json } from "../../../../lib/http";
import { pool } from "../../../../lib/db";
import { enforceRateLimit } from "../../../../lib/apiRateLimit";
import { publicSectorCounts } from "../../../../lib/contributionHub";
import { SERVICE_CACHE_CONTROL } from "../../../../lib/serviceCache";
import { logDbError } from "../../../../lib/dbError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METHODS = "GET, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);

/**
 * Public. The Contribute hub's numbers: for each real sector, how many published contributions it has and, from 5 contributors up,
 * how many contributors. Aggregates only. A successful answer may be cached for a minute; errors and 429 are never cached.
 */
export async function GET(req: Request) {
  const limited = await enforceRateLimit(req, "hubCounts");
  if (limited) return withCors(req, limited, METHODS);
  try {
    const sectors = await publicSectorCounts(pool);
    return withCors(req, json({ success: true, sectors }, 200, { "Cache-Control": SERVICE_CACHE_CONTROL }), METHODS);
  } catch (e) {
    // The real cause goes to the server log (a code, and for a missing table or column its name; never data). The answer stays friendly.
    if (logDbError("contribute sectors", e) === "not_set_up") { // a migration (012 sectors and contributions, 016 the first sector) is not applied yet
      return withCors(req, json({ success: false, error: "NOT_SET_UP", message: "The Contribute hub is not set up yet." }, 503), METHODS);
    }
    return withCors(req, json({ success: false, error: "SERVER_ERROR", message: "The numbers are not available right now. Please try again." }, 500), METHODS);
  }
}
