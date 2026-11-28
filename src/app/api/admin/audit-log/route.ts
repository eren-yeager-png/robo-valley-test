// The Audit Log (administrators only, reads only): ?page=, ?action= (a kind from AUDIT_ACTIONS), ?q= (who, what, which item).
import { requireAdmin } from "../../../../lib/admin";
import { pool } from "../../../../lib/db";
import { json } from "../../../../lib/http";
import { auditLog } from "../../../../lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  if (auth.admin.mustChangePassword) return json({ success: false, error: "PASSWORD_CHANGE_REQUIRED", message: "Please choose your own password first." }, 403);
  const p = new URL(req.url).searchParams;
  try {
    return json({ success: true, ...(await auditLog(pool as never, { page: Number(p.get("page")) || 1, action: p.get("action") ?? "", q: p.get("q") ?? "" })) }, 200, { "Cache-Control": "no-store" });
  } catch {
    console.error("audit log failed: server error");
    return json({ success: false, error: "SERVER_ERROR", message: "The audit log could not be loaded. Please try again." }, 500);
  }
}
