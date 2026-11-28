import { redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/currentUser";
import { contributeReturnPath, siteUrl } from "../../lib/session";
import CwMount from "../_cw/CwMount";

export const dynamic = "force-dynamic";

// The screen is the plain JavaScript module public/cw/js/mine.js (the same file the standalone demo runs): the signed-in person's own
// items, filters by status and sector, View for every item and Edit only for pending items sent with the current form.
export default async function MyContributionsPage() {
  if (!(await getCurrentUser())) redirect("/login");
  return <CwMount screen="mine" options={{ contributeUrl: siteUrl().replace(/\/+$/, "") + contributeReturnPath() }} />;
}
