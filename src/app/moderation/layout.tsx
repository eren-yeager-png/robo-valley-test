import Link from "next/link";
import type { Metadata } from "next";
import { Bricolage_Grotesque, Mulish } from "next/font/google";
import { requireReviewerPage } from "../../lib/reviewerPage";
import { siteUrl } from "../../lib/session";
import HeaderMenuSlot from "../_components/HeaderMenuSlot";
import "./moderation.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--rv-display", display: "swap", fallback: ["ui-sans-serif", "system-ui", "Segoe UI", "Arial", "sans-serif"] });
const body = Mulish({ subsets: ["latin"], variable: "--rv-body", display: "swap", fallback: ["ui-sans-serif", "system-ui", "Segoe UI", "Arial", "sans-serif"] });

export const metadata: Metadata = { title: "Admin Portal | RoboValley", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Administrators and moderators only. The page and every API behind it check again on their own. Sign Out is in the shared header
// account menu (HeaderMenuSlot: the same menu as on techytree.in).
export default async function ModerationLayout({ children }: { children: React.ReactNode }) {
  const me = await requireReviewerPage();
  return (
    <div className={`mod ${display.variable} ${body.variable}`}>
      <header className="mod-bar">
        <div className="mod-wrap">
          <span className="mod-logo">RoboValley · Admin Portal</span>
          <nav aria-label="Admin Portal">
            <span>Signed in as {me.isAdmin ? "an administrator" : "a moderator"}</span>
            <Link href="/moderation">Contributions</Link>
            {me.isAdmin && <a href="/admin/dashboard">Admin</a>}
            <a href={siteUrl()}>Back to the site</a>
            <HeaderMenuSlot site={siteUrl()} />
          </nav>
        </div>
      </header>
      <main className="mod-main mod-wrap" id="main">{children}</main>
    </div>
  );
}
