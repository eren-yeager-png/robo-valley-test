import { requireAdmin } from "../../../../../../../lib/admin";
import { pool } from "../../../../../../../lib/db";
import { json, readJson } from "../../../../../../../lib/http";
import { changeRobotType, parseRobotChange, parseRobotId } from "../../../../../../../lib/sectorForms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin-only (P2): change one robot type of a sector's form. Body: exactly one of
//   { "name": "Drone sprayers" }   rename (the link code stays the same)
//   { "active": false }            switch off (hidden from the form; contributions that chose it keep it) / true: switch on again
//   { "move": "up" | "down" }      move one place in the list
// There is no DELETE: robot types are never deleted.
export async function PATCH(req: Request, ctx: { params: Promise<{ slug: string; id: string }> }) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  if (auth.admin.mustChangePassword) return json({ success: false, error: "PASSWORD_CHANGE_REQUIRED", message: "Please choose your own password first." }, 403);

  const parsed = await readJson(req, 2048);
  if ("error" in parsed) return parsed.error;
  const { slug, id } = await ctx.params;
  const robotId = parseRobotId(id);
  if (robotId === null) return json({ success: false, error: "NOT_FOUND", message: "We could not find that robot type in this sector." }, 404);
  const change = parseRobotChange(parsed.body);
  if (!change) return json({ success: false, error: "VALIDATION_FAILED", message: "Send one change: a new name, on or off, or a move up or down." }, 400);
  try {
    const r = await changeRobotType(pool, Number(auth.admin.id), slug, robotId, change);
    if ("error" in r) return json({ success: false, error: r.error, message: r.message }, r.status);
    return json({ success: true, robots: r.robots });
  } catch {
    console.error("sector forms: changing a robot type failed"); // no names, ids or SQL in the log
    return json({ success: false, error: "SERVER_ERROR", message: "We could not save the change. Please try again." }, 500);
  }
}
