import { redirect } from "next/navigation";
import { getDashboardContext } from "../../lib/dashboardContext";
import DashboardShell from "./DashboardShell";
import { UnauthorizedState } from "./states";
import "../join/join.css";
import "../login/login.css";
import "./dashboard.css";

// Layouts are not re-rendered on client-side navigation, so this is a convenience only:
// every page below calls getDashboardContext() again and enforces access itself.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getDashboardContext();
  if (ctx.status === "anonymous") redirect("/login");

  if (ctx.status === "unknown-role") {
    // Signed in, but the stored role has no dashboard. Show nothing from the app, only a way out.
    return (
      <div className="rv">
        <main className="auth"><div className="auth-card">
          <UnauthorizedState title="Your account has no dashboard yet" body="Your account's role isn't recognised, so we can't show a dashboard. Please sign out and contact support." />
        </div></main>
      </div>
    );
  }

  const { user, dash } = ctx;
  const items = [
    { href: "/dashboard", label: "Home" },
    ...dash.sections.map((s) => ({ href: `/dashboard/${s.slug}`, label: s.label })),
    { href: "/dashboard/notifications", label: "Notifications" },
    { href: "/dashboard/profile", label: "Profile & settings" },
  ];
  return <DashboardShell userName={user.fullName} roleLabel={dash.label} items={items}>{children}</DashboardShell>;
}
