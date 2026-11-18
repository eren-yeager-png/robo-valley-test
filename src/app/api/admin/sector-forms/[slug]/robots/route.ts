import { requireAdmin } from "../../../../../../lib/admin";
import { pool } from "../../../../../../lib/db";
import { json, readJson } from "../../../../../../lib/http";
import { addRobotType } from "../../../../../../lib/sectorForms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin-only (P2): add a robot type to a sector's form. Body: { "name": "Drone sprayers" }. The link code is made from the name.
// Robot types are never deleted, so this folder has no DELETE.
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  if (auth.admin.mustChangePassword) return json({ success: false, error: "PASSWORD_CHANGE_REQUIRED", message: "Please choose your own password first." }, 403);

  const parsed = await readJson(req, 2048);
  if ("error" in parsed) return parsed.error;
  const { slug } = await ctx.params;
  try {
    const r = await addRobotType(pool, Number(auth.admin.id), slug, (parsed.body as { name?: unknown } | null)?.name);
    if ("error" in r) return json({ success: false, error: r.error, message: r.message }, r.status);
    return json({ success: true, robot: r.robot });
  } catch {
    console.error("sector forms: adding a robot type failed"); // no names, ids or SQL in the log
    return json({ success: false, error: "SERVER_ERROR", message: "We could not save the robot type. Please try again." }, 500);
  }
}
