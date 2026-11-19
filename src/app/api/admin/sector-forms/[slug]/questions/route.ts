import { requireAdmin } from "../../../../../../lib/admin";
import { pool } from "../../../../../../lib/db";
import { json, readJson } from "../../../../../../lib/http";
import { addQuestion, parseNewQuestion } from "../../../../../../lib/sectorQuestions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin-only (P5): add a question to a sector's form. Body: { "label": "...", "kind": "text" | "choice", "options": ["..."],
// "required": false }. Up to 5 on per sector, at most 2 required. Questions are never deleted, so this folder has no DELETE.
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  if (auth.admin.mustChangePassword) return json({ success: false, error: "PASSWORD_CHANGE_REQUIRED", message: "Please choose your own password first." }, 403);

  const parsed = await readJson(req, 8192);
  if ("error" in parsed) return parsed.error;
  const q = parseNewQuestion(parsed.body);
  if ("error" in q) return json({ success: false, error: "VALIDATION_FAILED", message: q.error }, 400);
  const { slug } = await ctx.params;
  try {
    const r = await addQuestion(pool as never, Number(auth.admin.id), slug, q.value);
    if ("error" in r) return json({ success: false, error: r.error, message: r.message }, r.status);
    return json({ success: true, question: r.question });
  } catch {
    console.error("sector forms: adding a question failed"); // no wording, ids or SQL in the log
    return json({ success: false, error: "SERVER_ERROR", message: "We could not save the question. Please try again." }, 500);
  }
}
