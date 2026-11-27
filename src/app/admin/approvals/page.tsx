import type { Metadata } from "next";
import { requireAdminPage } from "../../../lib/adminPage";
import CwMount from "../../_cw/CwMount";
import "../../_cw/cw-portal.css";

export const metadata: Metadata = { title: "Admin Approval Dashboard | RoboValley admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// The Admin Approval Dashboard of the contribution workflow (administrators only, like every page in src/app/admin). The screen is the
// plain JavaScript module public/cw/js/admin.js (the same file the standalone demo runs); every API behind it checks again.
export default async function ApprovalsPage() {
  const admin = await requireAdminPage();
  if (admin.mustChangePassword) return null;
  return <CwMount screen="admin" />;
}
