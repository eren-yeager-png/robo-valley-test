import type { Metadata } from "next";
import { requireAdminPage } from "../../../lib/adminPage";
import CwMount from "../../_cw/CwMount";
import "../../_cw/cw-portal.css";
import "../../../../public/cw/portal.css";

export const metadata: Metadata = { title: "Publish Requests | RoboValley admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
type SP = { sector?: string; tab?: string };
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Publish Requests (administrators only, like every page in src/app/admin): the Admin Approval Dashboard merged into one queue with a
// sector filter, the publish preview and the full review in a drawer. The screen is the plain JavaScript module public/cw/js/requests.js
// (the same file the standalone demo runs); every API behind it checks again.
export default async function ApprovalsPage({ searchParams }: { searchParams?: Promise<SP> } = {}) {
  const admin = await requireAdminPage();
  if (admin.mustChangePassword) return null;
  const sp = (await searchParams) ?? {};
  const sector = (sp.sector ?? "").length <= 60 && SLUG.test(sp.sector ?? "") ? sp.sector : "";
  return <CwMount screen="requests" options={{ sector, tab: sp.tab ?? "", basePath: "/admin/approvals" }} />;
}
