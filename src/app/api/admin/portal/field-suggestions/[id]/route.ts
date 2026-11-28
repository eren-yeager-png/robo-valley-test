// Contribution Portal (migration 030), administrators only: decide one suggested field.
//   POST { "action": "approve", "name"?, "slug"?, "description"? }   adds the field at once ("Suggested by member"); with a changed name,
//                                                                    link code or description = Edit & approve
//   POST { "action": "reject", "reason": "..." }                     the reason is required
// One transaction with its Audit Log row. 503 NOT_SET_UP before 030.
import { requireAdmin } from "../../../../../../lib/admin";
import { pool } from "../../../../../../lib/db";
import { json, readJson } from "../../../../../../lib/http";
import { decideSuggestion, parseDecision } from "../../../../../../lib/fieldSuggestions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  if (auth.admin.mustChangePassword) return json({ success: false, error: "PASSWORD_CHANGE_REQUIRED", message: "Please choose your own password first." }, 403);
  const raw = (await ctx.params).id;
  const id = /^[1-9]\d{0,14}$/.test(raw) ? Number(raw) : null;
  if (id === null) return json({ success: false, error: "NOT_FOUND", message: "We could not find that suggestion." }, 404);
  const parsed = await readJson(req, 8 * 1024);
  if ("error" in parsed) return parsed.error;
  const d = parseDecision(parsed.body);
  if (!d) return json({ success: false, error: "VALIDATION_FAILED", message: "Send approve or reject." }, 400);
  try {
    const r = await decideSuggestion(pool as never, { id: Number(auth.admin.id), name: auth.admin.fullName }, id, d);
    if ("error" in r) return json({ success: false, error: r.error, message: r.message }, r.status);
    return json({ success: true, suggestion: r.suggestion, fieldId: r.fieldId, message: r.message });
  } catch {
    console.error("field suggestion decision failed: server error"); // no names, ids or SQL in the log
    return json({ success: false, error: "SERVER_ERROR", message: "We could not save the decision. Nothing was changed. Please try again." }, 500);
  }
}
