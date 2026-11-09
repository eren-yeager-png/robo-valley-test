import type { Metadata } from "next";
import { Bricolage_Grotesque, Mulish } from "next/font/google";
import { requireReviewerPage } from "../../lib/reviewerPage";
import { siteUrl } from "../../lib/session";
import "./moderation.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--rv-display", display: "swap", fallback: ["ui-sans-serif", "system-ui", "Segoe UI", "Arial", "sans-serif"] });
const body = Mulish({ subsets: ["latin"], variable: "--rv-body", display: "swap", fallback: ["ui-sans-serif", "system-ui", "Segoe UI", "Arial", "sans-serif"] });

export const metadata: Metadata = { title: "Moderation | RoboValley", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Administrators and moderators only. The page and every API behind it check again on their own.
export default async function ModerationLayout({ children }: { children: React.ReactNode }) {
  const me = await requireReviewerPage();
  return (
    <div className={`mod ${display.variable} ${body.variable}`}>
      <header className="mod-top">
        <span className="mod-logo">RoboValley Moderation</span>
        {me.isAdmin && <a href="/admin/dashboard">Admin</a>}
        <a href={siteUrl()}>Back to the site</a>
      </header>
      {children}
    </div>
  );
}
