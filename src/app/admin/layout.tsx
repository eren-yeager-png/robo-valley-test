import type { Metadata } from "next";
import { requireAdminPage } from "../../lib/adminPage";
import ChangePasswordForm from "./dashboard/ChangePasswordForm";
import AdminShell from "./_components/AdminShell";
import "../join/join.css";
import "../login/login.css";
import "../dashboard/dashboard.css";
import "./admin.css";

export const metadata: Metadata = { title: "Admin | RoboValley", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// First line of defence for everything under /admin. Every page and API ALSO checks on its own (layouts are not re-run
// when moving between pages), so removing this would not open anything up.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminPage();
  return (
    <div className="rv">
      <AdminShell email={admin.email} locked={admin.mustChangePassword}>
        {admin.mustChangePassword ? <ChangePasswordForm /> : children}
      </AdminShell>
    </div>
  );
}
