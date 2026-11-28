import type { Metadata } from "next";
import { requireAdminPage } from "../../../lib/adminPage";
import { contributeReturnPath, siteUrl } from "../../../lib/session";
import CwMount from "../../_cw/CwMount";
import "../../_cw/cw-portal.css";
import "../../../../public/cw/sector.css";
import "../../../../public/cw/portal.css";

export const metadata: Metadata = { title: "Sector forms | RoboValley admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
type SP = { sector?: string; tab?: string };
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Admin only. Sector Forms in one column: the sector grid, then the selected sector's fields (robot types) and the fields members
// suggested. The screen is public/cw/js/sector-forms.js (the same file the demo runs); adding and changing a field go through the
// admin routes, which check again. A sector's questions keep their page (/admin/sector-forms/<slug>).
export default async function SectorFormsPage({ searchParams }: { searchParams?: Promise<SP> } = {}) {
  const admin = await requireAdminPage();
  if (admin.mustChangePassword) return null;
  const sp = (await searchParams) ?? {};
  const sector = (sp.sector ?? "").length <= 60 && SLUG.test(sp.sector ?? "") ? sp.sector : "";
  return <CwMount screen="sectorForms" options={{ sector, tab: sp.tab ?? "", basePath: "/admin/sector-forms", questionsPath: "/admin/sector-forms", form: siteUrl().replace(/\/+$/, "") + contributeReturnPath() }} />;
}
