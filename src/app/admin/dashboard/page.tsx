import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAdminContext } from "../../../lib/admin";
import LogoutButton from "../../dashboard/LogoutButton";
import ChangePasswordForm from "./ChangePasswordForm";
import "../../join/join.css";
import "../../login/login.css";
import "../../dashboard/dashboard.css";
import "../admin.css";

export const metadata: Metadata = {
  title: "Admin dashboard | RoboValley",
  robots: { index: false, follow: false },
};

// Server-side guard: anonymous -> sign in, signed-in non-admin -> their normal page. Nothing admin is rendered for them.
export default async function AdminDashboardPage() {
  const ctx = await getAdminContext();
  if (ctx.status === "anonymous") redirect("/login");
  if (ctx.status === "forbidden") redirect("/dashboard");
  const { admin } = ctx;

  return (
    <div className="rv">
      <div className="admin">
        <header className="admin-bar">
          <span className="title">RoboValley Admin</span>
          <div className="who">
            <span>Signed in as <strong>{admin.email}</strong></span>
            <LogoutButton />
          </div>
        </header>
        <main className="admin-main">
          {admin.mustChangePassword ? (
            <ChangePasswordForm />
          ) : (
            <>
              <h1>Admin dashboard</h1>
              <div className="admin-empty">Admin tools will appear here.</div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
