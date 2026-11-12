import type { Metadata } from "next";
import { Bricolage_Grotesque, Mulish } from "next/font/google";
import { requireReviewerPage } from "../../lib/reviewerPage";
import { siteUrl } from "../../lib/session";
import "./moderation.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--rv-display", display: "swap", fallback: ["ui-sans-serif", "system-ui", "Segoe UI", "Arial", "sans-serif"] });
const body = Mulish({ subsets: ["latin"], variable: "--rv-body", display: "swap", fallback: ["ui-sans-serif", "system-ui", "Segoe UI", "Arial", "sans-serif"] });

export const metadata: Metadata = { title: "Admin Portal | RoboValley", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Administrators and moderators only. The page and every API behind it check again on their own. No Sign Out here (agreed): signing out
// stays in the site's own account menu.
export default async function ModerationLayout({ children }: { children: React.ReactNode }) {
  const me = await requireReviewerPage();
  return (
    <div className={`mod ${display.variable} ${body.variable}`}>
      <header className="mod-bar">
        <div className="mod-wrap">
          <span className="mod-logo">RoboValley · Admin Portal</span>
          <nav aria-label="Admin Portal">
            <span>Signed in as {me.isAdmin ? "an administrator" : "a moderator"}</span>
            <a href="/moderation">Contributions</a>
            {me.isAdmin && <a href="/admin/dashboard">Admin</a>}
            <a href={siteUrl()}>Back to the site</a>
          </nav>
        </div>
      </header>
      <main className="mod-main mod-wrap" id="main">{children}</main>
    </div>
  );
}
