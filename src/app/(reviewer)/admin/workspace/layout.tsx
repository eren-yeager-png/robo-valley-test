import type { Metadata } from "next";
import { Bricolage_Grotesque, Mulish } from "next/font/google";
import { requireReviewerPage } from "../../../../lib/reviewerPage";
import { siteUrl } from "../../../../lib/session";
import AdminShell from "../../../admin/_components/AdminShell";
import "../../../join/join.css";
import "../../../login/login.css";
import "../../../dashboard/dashboard.css";
import "../../../admin/admin.css";
import "../../../_cw/cw-portal.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--rv-display", display: "swap", fallback: ["ui-sans-serif", "system-ui", "Segoe UI", "Arial", "sans-serif"] });
const body = Mulish({ subsets: ["latin"], variable: "--rv-body", display: "swap", fallback: ["ui-sans-serif", "system-ui", "Segoe UI", "Arial", "sans-serif"] });

export const metadata: Metadata = { title: "Moderator Workspace | RoboValley admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// The Moderator Workspace of the contribution workflow, at /admin/workspace, in the same admin shell. Like Moderation it is for
// administrators AND moderators, so it lives in the "(reviewer)" route group (src/app/admin is administrators only). The page and every
// API behind it check again on their own.
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const me = await requireReviewerPage({ passwordChange: true });
  return (
    <div className={`rv ${display.variable} ${body.variable}`}>
      <AdminShell landingUrl={siteUrl()} locked={me.mustChangePassword} role={me.isAdmin ? "admin" : "moderator"}>{children}</AdminShell>
    </div>
  );
}
