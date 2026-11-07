import { requireAdmin } from "../../../../lib/admin";
import { json } from "../../../../lib/http";
import { pool } from "../../../../lib/db";
import { rateLimitSummary } from "../../../../lib/apiRateLimit";
import { tableExists } from "../../../../lib/adminStats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin only, read-only. Aggregates about the Find a Service rate limiter over the last hour (no addresses, hashes or keys). */
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  try {
    if (!(await tableExists(pool, "api_rate_limits"))) return json({ success: false, error: "NOT_SET_UP", message: "The rate-limit table is not set up in this database yet (migration 011)." }, 503);
    return json({ success: true, ...(await rateLimitSummary(pool)) }, 200);
  } catch {
    console.error("rate-limit-check failed: server error");
    return json({ success: false, error: "SERVER_ERROR", message: "The check is not available right now." }, 500);
  }
}
