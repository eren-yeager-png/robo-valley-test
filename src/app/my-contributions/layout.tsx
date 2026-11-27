import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Bricolage_Grotesque, Mulish } from "next/font/google";
import { getCurrentUser } from "../../lib/currentUser";
import { getDashboardContext } from "../../lib/dashboardContext";
import { memberNavItems } from "../../lib/memberNav";
import { reviewerOf } from "../../lib/moderators";
import { pool } from "../../lib/db";
import { siteUrl } from "../../lib/session";
import AdminShell from "../admin/_components/AdminShell";
import DashboardShell from "../dashboard/DashboardShell";
import { UnauthorizedState } from "../dashboard/states";
import "../join/join.css";
import "../login/login.css";
import "../dashboard/dashboard.css";
import "../admin/admin.css";
import "../_cw/cw-portal.css";
import "../../../public/cw/portal.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--rv-display", display: "swap", fallback: ["ui-sans-serif", "system-ui", "Segoe UI", "Arial", "sans-serif"] });
const body = Mulish({ subsets: ["latin"], variable: "--rv-body", display: "swap", fallback: ["ui-sans-serif", "system-ui", "Segoe UI", "Arial", "sans-serif"] });

export const metadata: Metadata = { title: "My Contributions | RoboValley", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// "My Contributions" is ONE page for every portal: an administrator or a moderator sees it inside the admin portal (their navigation,
// "My Contributions" highlighted), every other member inside their Member portal. The page and its API check the sign-in again.
export default async function MyContributionsLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const reviewer = await reviewerOf(pool as never, Number(user.id));
  if (reviewer.ok) {
    return (
      <div className={`rv ${display.variable} ${body.variable}`}>
        <AdminShell landingUrl={siteUrl()} locked={reviewer.mustChangePassword} role={reviewer.isAdmin ? "admin" : "moderator"}>{children}</AdminShell>
      </div>
    );
  }
  const ctx = await getDashboardContext();
  if (ctx.status !== "ok") {
    return (
      <div className="rv"><main className="auth"><div className="auth-card">
        <UnauthorizedState title="Your account has no portal yet" body="Your account's role isn't recognised, so we can't show your contributions. Please sign out and contact support." action="signout" />
      </div></main></div>
    );
  }
  return <DashboardShell userName={ctx.user.fullName} roleLabel={ctx.dash.label} items={memberNavItems(ctx.dash)} site={siteUrl()}>{children}</DashboardShell>;
}
