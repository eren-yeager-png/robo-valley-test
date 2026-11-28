import { requireAdmin } from "../../../../lib/admin";
import { pool } from "../../../../lib/db";
import { json } from "../../../../lib/http";
import { sectorStatusCounts } from "../../../../lib/sectorCounts";
import { logDbError } from "../../../../lib/dbError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Sectors page's words for the two problems an administrator can act on (the page itself is drawn in the browser now).
const NOT_SET_UP = "Contributions are not set up on this database yet: the contribution tables come from migrations 012 to 019 (Settings shows which ones this database has). Nothing was changed.";
const UNREACHABLE = "The database did not answer. Nothing was changed. Please try again in a moment.";

// Admin only (not moderators, not members): contributions per sector by status. Read only, never cached.
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  try {
    return json({ success: true, ...(await sectorStatusCounts(pool as never)) }, 200, { "Cache-Control": "no-store" });
  } catch (e) {
    const why = logDbError("admin sector counts", e); // the cause goes to the log (no SQL, ids or personal data); the answer stays plain
    if (why === "not_set_up") return json({ success: false, error: "NOT_SET_UP", message: NOT_SET_UP }, 503, { "Cache-Control": "no-store" });
    if (why === "unreachable") return json({ success: false, error: "UNREACHABLE", message: UNREACHABLE }, 503, { "Cache-Control": "no-store" });
    return json({ success: false, error: "SERVER_ERROR", message: "The counts could not be read. Please try again." }, 500, { "Cache-Control": "no-store" });
  }
}
