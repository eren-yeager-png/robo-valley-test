// Contribution Portal, administrators only: add a sector. Body: { "name": "Healthcare", "slug"?: "healthcare", "icon"?: "🩺",
// "color"?: "#1F7A5C" } (icon and colour need migration 030). The link code is made from the name when none is typed, and never changes.
// Sectors are never deleted (they can be archived: PATCH /api/admin/sectors/<slug>). One transaction with its Audit Log row.
import { requireAdmin } from "../../../../lib/admin";
import { pool } from "../../../../lib/db";
import { json, readJson } from "../../../../lib/http";
import { addSector } from "../../../../lib/sectorsAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  if (auth.admin.mustChangePassword) return json({ success: false, error: "PASSWORD_CHANGE_REQUIRED", message: "Please choose your own password first." }, 403);
  const parsed = await readJson(req, 2048);
  if ("error" in parsed) return parsed.error;
  const b = (parsed.body ?? {}) as { name?: unknown; slug?: unknown; icon?: unknown; color?: unknown };
  try {
    const r = await addSector(pool as never, { id: Number(auth.admin.id), name: auth.admin.fullName }, b);
    if ("error" in r) return json({ success: false, error: r.error, message: r.message }, r.status);
    return json({ success: true, sector: r.sector, message: `"${r.sector.name}" was added at the end of the list.` });
  } catch {
    console.error("sectors: adding a sector failed"); // no names, ids or SQL in the log
    return json({ success: false, error: "SERVER_ERROR", message: "We could not add the sector. Please try again." }, 500);
  }
}
