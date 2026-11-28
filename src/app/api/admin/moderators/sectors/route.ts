// Contribution Portal (migration 030), administrators only: the sectors a moderator reviews. Body: { "userId": 12, "sectors": ["education"] }
// ([] = every sector, as before). Administrators always review every sector. One transaction with its Audit Log row.
import { requireAdmin } from "../../../../../lib/admin";
import { pool } from "../../../../../lib/db";
import { json, readJson } from "../../../../../lib/http";
import { parseUserId } from "../../../../../lib/moderators";
import { parseSectorList, setReviewerSectors } from "../../../../../lib/reviewerSectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  if (auth.admin.mustChangePassword) return json({ success: false, error: "PASSWORD_CHANGE_REQUIRED", message: "Please choose your own password first." }, 403);
  const parsed = await readJson(req, 4096);
  if ("error" in parsed) return parsed.error;
  const b = (parsed.body ?? {}) as { userId?: unknown; sectors?: unknown };
  const userId = parseUserId(b.userId), sectors = parseSectorList(b.sectors);
  if (userId === null || sectors === null) return json({ success: false, error: "VALIDATION_FAILED", message: "Send a user id and a list of sectors ([] = every sector)." }, 400);
  try {
    const r = await setReviewerSectors(pool as never, { id: Number(auth.admin.id), name: auth.admin.fullName }, userId, sectors);
    if ("error" in r) return json({ success: false, error: r.error, message: r.message }, r.status);
    return json({ success: true, sectors: r.sectors, message: r.sectors.length ? `Reviews ${r.sectors.map((s) => s.name).join(", ")}.` : "Reviews every sector." });
  } catch {
    console.error("moderator sectors change failed"); // no ids, SQL or personal data in logs
    return json({ success: false, error: "SERVER_ERROR", message: "We could not save the change. Please try again." }, 500);
  }
}
