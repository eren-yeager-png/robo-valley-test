// Contribution Portal (reads only, administrators): Sector Forms' sector grid ("n fields · m suggestions") and one sector's fields
// (robot types, with where each came from and how many contributions chose it) and the suggested fields still waiting. Adding and
// changing a field go through the existing routes (/api/admin/sector-forms/<slug>/robots).
import { requireAdmin } from "../../../../../lib/admin";
import { pool } from "../../../../../lib/db";
import { json } from "../../../../../lib/http";
import { sectorFormsPortal } from "../../../../../lib/portalFields";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  if (auth.admin.mustChangePassword) return json({ success: false, error: "PASSWORD_CHANGE_REQUIRED", message: "Please choose your own password first." }, 403);
  const raw = new URL(req.url).searchParams.get("sector") ?? "";
  try {
    return json({ success: true, ...(await sectorFormsPortal(pool as never, raw.length <= 60 && SLUG.test(raw) ? raw : "")) });
  } catch (e) {
    if (["42P01", "42703"].includes((e as { code?: string })?.code ?? "")) return json({ success: false, error: "NOT_SET_UP", message: "Sectors are not set up on this database yet." }, 503);
    console.error("sector forms portal failed: server error");
    return json({ success: false, error: "SERVER_ERROR", message: "Sector forms could not be loaded. Please try again." }, 500);
  }
}
