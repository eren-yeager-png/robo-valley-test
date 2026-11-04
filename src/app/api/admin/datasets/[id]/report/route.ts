import { requireAdmin } from "../../../../../../lib/admin";
import { json } from "../../../../../../lib/http";
import { pool } from "../../../../../../lib/db";
import { reportCsv, type StoredReport } from "../../../../../../lib/uploadReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin only. The upload report of one dataset as a CSV: every skipped, merged and refused row with its row number. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  const { id } = await ctx.params;
  if (!/^\d{1,18}$/.test(id)) return json({ success: false, error: "VALIDATION_FAILED", message: "That dataset id is not valid." }, 400);
  try {
    const { rows } = await pool.query("SELECT report FROM service_datasets WHERE id = $1", [id]);
    if (!rows[0]) return json({ success: false, error: "NOT_FOUND", message: "That upload was not found." }, 404);
    return new Response(reportCsv((rows[0].report as StoredReport | null) ?? null), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="upload-report-${id}.csv"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    console.error("upload report download failed: server error");
    return json({ success: false, error: "SERVER_ERROR", message: "The report could not be read." }, 500);
  }
}
