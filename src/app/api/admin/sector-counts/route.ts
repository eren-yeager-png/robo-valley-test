import { requireAdmin } from "../../../../lib/admin";
import { pool } from "../../../../lib/db";
import { json } from "../../../../lib/http";
import { sectorStatusCounts } from "../../../../lib/sectorCounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin only (not moderators, not members): contributions per sector by status. Read only, never cached.
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  try {
    return json({ success: true, ...(await sectorStatusCounts(pool as never)) }, 200, { "Cache-Control": "no-store" });
  } catch {
    console.error("sector counts failed: server error"); // no SQL, ids or personal data in logs
    return json({ success: false, error: "SERVER_ERROR", message: "The counts could not be read. Please try again." }, 500, { "Cache-Control": "no-store" });
  }
}
