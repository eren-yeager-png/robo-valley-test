import { requireAdmin } from "../../../../lib/admin";
import { pool } from "../../../../lib/db";
import { json, readJson } from "../../../../lib/http";
import { parseUserId, setModerator } from "../../../../lib/moderators";

export const runtime = "nodejs";

// Admin-only: make a user a moderator, or remove the flag. Body: { "userId": 12, "moderator": true }.
// A moderator is a flag, not a role. Every change is audited by the database (ids only). Nobody can change their own flag.
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;

  const parsed = await readJson(req, 1024);
  if ("error" in parsed) return parsed.error;
  const b = (parsed.body ?? {}) as { userId?: unknown; moderator?: unknown };
  const userId = parseUserId(b.userId);
  if (userId === null || typeof b.moderator !== "boolean") {
    return json({ success: false, error: "VALIDATION_FAILED", message: "Send a user id and true or false." }, 400);
  }

  try {
    const r = await setModerator(pool, Number(auth.admin.id), userId, b.moderator);
    if (!("error" in r)) return json({ success: true, userId: r.userId, moderator: r.moderator, changed: r.changed });
    if (r.error === "SELF") return json({ success: false, error: "FORBIDDEN", message: "You cannot change your own moderator flag." }, 403);
    if (r.error === "NOT_FOUND") return json({ success: false, error: "NOT_FOUND", message: "No such user." }, 404);
    return json({ success: false, error: "FORBIDDEN", message: "You do not have access to this." }, 403);
  } catch {
    console.error("moderator change failed"); // no ids, SQL or personal data in logs
    return json({ success: false, error: "SERVER_ERROR", message: "We could not save the change. Please try again." }, 500);
  }
}
