import { redirect } from "next/navigation";
import { ADMIN_HOME, ADMIN_ROLE } from "./admin";
import { getCurrentUser, type CurrentUser } from "./currentUser";
import { getRoleDashboard, type RoleDashboard } from "./dashboardConfig";
import { pool } from "./db";
import { MODERATOR_ROLE, reviewerLanding } from "./reviewerHome";

export type DashboardContext =
  | { status: "anonymous" } // not signed in -> redirect to /login
  | { status: "unknown-role"; user: CurrentUser } // signed in, but the role has no dashboard
  | { status: "ok"; user: CurrentUser; dash: RoleDashboard };

/**
 * The single entry point every dashboard page AND the layout must call. The role comes from the
 * database (via getCurrentUser), never from the URL, a query string, a cookie value or localStorage.
 * Layouts are not re-run on client-side navigation, so each page must call this itself.
 *
 * An administrator (database role "admin", the same rule requireAdmin uses) has no role dashboard here: they are
 * sent to their own admin dashboard. Because every dashboard page and the layout go through this function, that one
 * redirect covers them all. Only the exact stored value "admin" counts; nothing from the browser is trusted.
 */
export async function getDashboardContext(): Promise<DashboardContext> {
  const user = await getCurrentUser();
  if (!user) return { status: "anonymous" };
  if (user.role === ADMIN_ROLE) redirect(ADMIN_HOME);
  if (user.role === MODERATOR_ROLE) { // a dedicated moderator account: its dashboard is the Admin Portal (only while it is a reviewer)
    const landing = await reviewerLanding(pool as never, Number(user.id), user.role);
    if (landing) redirect(landing);
  }
  const dash = getRoleDashboard(user.role);
  return dash ? { status: "ok", user, dash } : { status: "unknown-role", user };
}
