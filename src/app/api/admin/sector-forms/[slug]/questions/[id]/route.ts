import { requireAdmin } from "../../../../../../../lib/admin";
import { pool } from "../../../../../../../lib/db";
import { json, readJson } from "../../../../../../../lib/http";
import { parseRobotId } from "../../../../../../../lib/sectorForms";
import { changeQuestion, parseQuestionChange } from "../../../../../../../lib/sectorQuestions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin-only (P5): change one question of a sector's form. Body: exactly one of
//   { "label": "..." }            correct the wording          { "options": ["...", "..."] }  correct the choices (pick-one only)
//   { "required": true | false }  at most 2 required (on only)   { "active": true | false }     switch on (up to 5) / off (never deleted)
//   { "move": "up" | "down" }     move one place
// The kind (text or choice) cannot change. There is no DELETE: questions are never deleted.
export async function PATCH(req: Request, ctx: { params: Promise<{ slug: string; id: string }> }) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  if (auth.admin.mustChangePassword) return json({ success: false, error: "PASSWORD_CHANGE_REQUIRED", message: "Please choose your own password first." }, 403);

  const parsed = await readJson(req, 8192);
  if ("error" in parsed) return parsed.error;
  const { slug, id } = await ctx.params;
  const questionId = parseRobotId(id); // the same id rule as robot types: a positive whole number
  if (questionId === null) return json({ success: false, error: "NOT_FOUND", message: "We could not find that question in this sector." }, 404);
  const change = parseQuestionChange(parsed.body);
  if (!change) return json({ success: false, error: "VALIDATION_FAILED", message: "Send one change: the wording, the choices, required or not, on or off, or a move up or down." }, 400);
  try {
    const r = await changeQuestion(pool as never, Number(auth.admin.id), slug, questionId, change);
    if ("error" in r) return json({ success: false, error: r.error, message: r.message }, r.status);
    return json({ success: true, questions: r.questions });
  } catch {
    console.error("sector forms: changing a question failed"); // no wording, ids or SQL in the log
    return json({ success: false, error: "SERVER_ERROR", message: "We could not save the change. Please try again." }, 500);
  }
}
