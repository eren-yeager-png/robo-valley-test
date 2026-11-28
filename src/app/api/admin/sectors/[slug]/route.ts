// Contribution Portal, administrators only: change one sector. Body: exactly one of
//   { "name": "..." }                        rename (the link code stays)
//   { "move": "up" | "down" }                one place in the list
//   { "archived": true | false }             archive (members no longer see it; refused while contributions there still wait) or restore
//   { "style": { "icon"?, "color"? } }       the card's icon and colour
// Archiving and the card's style need migration 030. One transaction with its Audit Log row.
import { requireAdmin } from "../../../../../lib/admin";
import { pool } from "../../../../../lib/db";
import { json, readJson } from "../../../../../lib/http";
import { changeSector, parseSectorChange } from "../../../../../lib/sectorsAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  if (auth.admin.mustChangePassword) return json({ success: false, error: "PASSWORD_CHANGE_REQUIRED", message: "Please choose your own password first." }, 403);
  const parsed = await readJson(req, 2048);
  if ("error" in parsed) return parsed.error;
  const change = parseSectorChange(parsed.body);
  if (!change) return json({ success: false, error: "VALIDATION_FAILED", message: "Send one change: a new name, a move, archive or restore, or the card's style." }, 400);
  try {
    const r = await changeSector(pool as never, { id: Number(auth.admin.id), name: auth.admin.fullName }, (await ctx.params).slug, change);
    if ("error" in r) return json({ success: false, error: r.error, message: r.message }, r.status);
    return json({ success: true, message: r.message });
  } catch {
    console.error("sectors: changing a sector failed"); // no names, ids or SQL in the log
    return json({ success: false, error: "SERVER_ERROR", message: "We could not save the change. Please try again." }, 500);
  }
}
