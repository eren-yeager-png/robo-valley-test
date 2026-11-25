import type { Metadata } from "next";
import { Bricolage_Grotesque, Mulish } from "next/font/google";
import { requireReviewerPage } from "../../../../lib/reviewerPage";
import { siteUrl } from "../../../../lib/session";
import AdminShell from "../../../admin/_components/AdminShell";
import "../../../join/join.css";
import "../../../login/login.css";
import "../../../dashboard/dashboard.css";
import "../../../admin/admin.css";
import "./moderation.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--rv-display", display: "swap", fallback: ["ui-sans-serif", "system-ui", "Segoe UI", "Arial", "sans-serif"] });
const body = Mulish({ subsets: ["latin"], variable: "--rv-body", display: "swap", fallback: ["ui-sans-serif", "system-ui", "Segoe UI", "Arial", "sans-serif"] });

export const metadata: Metadata = { title: "Moderation | RoboValley admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Moderation looks like every other admin page (the same shell), at /admin/moderation. It is NOT inside src/app/admin, because that
// folder's layout lets administrators in only, and Moderation is for administrators AND moderators: the route group "(reviewer)" gives
// it the same address space with its own guard. The guard is unchanged. A moderator's sidebar holds Moderation only: the other pages
// are for administrators and refuse them anyway. Each page, and every API behind it, checks again on its own.
export default async function ModerationLayout({ children }: { children: React.ReactNode }) {
  const me = await requireReviewerPage({ passwordChange: true }); // each page runs the full guard itself (pages are not re-run with the layout)
  return (
    <div className={`rv ${display.variable} ${body.variable}`}>
      <AdminShell landingUrl={siteUrl()} locked={me.mustChangePassword} role={me.isAdmin ? "admin" : "moderator"}>{children}</AdminShell>
    </div>
  );
}
