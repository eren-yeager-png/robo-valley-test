import { preflight, withCors } from "../../../../lib/cors";
import { json } from "../../../../lib/http";
import { pool } from "../../../../lib/db";
import { enforceRateLimit } from "../../../../lib/apiRateLimit";
import { publicSectorCounts } from "../../../../lib/contributionHub";
import { SERVICE_CACHE_CONTROL } from "../../../../lib/serviceCache";

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
    if ((e as { code?: string })?.code === "42P01") { // migration 012 is not applied yet
      return withCors(req, json({ success: false, error: "NOT_SET_UP", message: "The Contribute hub is not set up yet." }, 503), METHODS);
    }
    console.error("hub counts failed: server error"); // nothing from the data in the log
    return withCors(req, json({ success: false, error: "SERVER_ERROR", message: "The numbers are not available right now. Please try again." }, 500), METHODS);
  }
}
