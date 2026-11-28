import type { Metadata } from "next";
import { requireAdminPage } from "../../../lib/adminPage";
import CwMount from "../../_cw/CwMount";
import "../../../../public/cw/contribution-workflow.css";
import "../../../../public/cw/portal.css";

export const metadata: Metadata = { title: "Community Ideas | RoboValley admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Admin only. The public Community Ideas page as visitors see it right now (the SAME screen the website runs, public/cw/js/site.js).
// Publishing, updating and unpublishing a card happen in Publish Requests.
export default async function CommunityIdeasPage() {
  const admin = await requireAdminPage();
  if (admin.mustChangePassword) return null;
  return (
    <div className="rv-pp">
      <header className="rv-pp-head">
        <div className="rv-pp-head__text"><h1 className="rv-pp-title">Community Ideas</h1>
          <p className="rv-pp-desc">What the public sees on the Community Ideas page right now. Publish, update or unpublish a card in Publish Requests.</p></div>
        <div className="rv-pp-actions"><a className="btn primary" href="/admin/approvals">Open Publish Requests</a></div>
      </header>
      <CwMount screen="site" />
    </div>
  );
}
