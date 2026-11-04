import type { Metadata } from "next";
import { Bricolage_Grotesque, Mulish } from "next/font/google";
import { requireAdminPage } from "../../lib/adminPage";
import { siteUrl } from "../../lib/session";
import ChangePasswordForm from "./dashboard/ChangePasswordForm";
import AdminShell from "./_components/AdminShell";
import "../join/join.css";
import "../login/login.css";
import "../dashboard/dashboard.css";
import "./admin.css";

// The same two typefaces as the RoboValley landing page, served from this app (no request to Google at run time).
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--rv-display", display: "swap", fallback: ["ui-sans-serif", "system-ui", "Segoe UI", "Arial", "sans-serif"] });
const body = Mulish({ subsets: ["latin"], variable: "--rv-body", display: "swap", fallback: ["ui-sans-serif", "system-ui", "Segoe UI", "Arial", "sans-serif"] });

export const metadata: Metadata = { title: "Admin | RoboValley", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// First line of defence for everything under /admin. Every page and API ALSO checks on its own (layouts are not re-run
// when moving between pages), so removing this would not open anything up.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminPage();
  return (
    <div className={`rv ${display.variable} ${body.variable}`}>
      <AdminShell email={admin.email} landingUrl={siteUrl()} locked={admin.mustChangePassword}>
        {admin.mustChangePassword ? <ChangePasswordForm /> : children}
      </AdminShell>
    </div>
  );
}
