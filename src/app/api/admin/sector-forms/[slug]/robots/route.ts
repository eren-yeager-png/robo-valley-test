import { requireAdmin } from "../../../../../../lib/admin";
import { pool } from "../../../../../../lib/db";
import { json, readJson } from "../../../../../../lib/http";
import { addRobotType } from "../../../../../../lib/sectorForms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin-only (P2): add a robot type (a "field") to a sector's form. Body: { "name": "Drone sprayers" }; the link code is made from the
// name. Contribution Portal (migration 030), all optional: "slug" (the link code, typed by the administrator; unique in the sector),
// "description", "icon" (a short symbol) and "status" ("active" or "hidden"). Deleting a field is DELETE on robots/<id>.
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  if (auth.admin.mustChangePassword) return json({ success: false, error: "PASSWORD_CHANGE_REQUIRED", message: "Please choose your own password first." }, 403);

  const parsed = await readJson(req, 4096);
  if ("error" in parsed) return parsed.error;
  const { slug } = await ctx.params;
  const b = (parsed.body ?? {}) as { name?: unknown; slug?: unknown; description?: unknown; icon?: unknown; status?: unknown };
  try {
    const r = await addRobotType(pool, Number(auth.admin.id), slug, b.name, { slug: b.slug, description: b.description, icon: b.icon, status: b.status }, auth.admin.fullName);
    if ("error" in r) return json({ success: false, error: r.error, message: r.message }, r.status);
    return json({ success: true, robot: r.robot });
  } catch {
    console.error("sector forms: adding a robot type failed"); // no names, ids or SQL in the log
    return json({ success: false, error: "SERVER_ERROR", message: "We could not save the robot type. Please try again." }, 500);
  }
}
