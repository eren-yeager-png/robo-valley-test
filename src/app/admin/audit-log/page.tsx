import type { Metadata } from "next";
import { requireAdminPage } from "../../../lib/adminPage";
import CwMount from "../../_cw/CwMount";
import "../../../../public/cw/portal.css";

export const metadata: Metadata = { title: "Audit Log | RoboValley admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Admin only. Who approved, edited, published, rejected or changed a role, and when. The screen is public/cw/js/audit.js.
export default async function AuditLogPage() {
  const admin = await requireAdminPage();
  if (admin.mustChangePassword) return null;
  return <CwMount screen="audit" />;
}
