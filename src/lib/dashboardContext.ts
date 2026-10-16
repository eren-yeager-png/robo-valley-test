import { getCurrentUser, type CurrentUser } from "./currentUser";
import { getRoleDashboard, type RoleDashboard } from "./dashboardConfig";

export type DashboardContext =
  | { status: "anonymous" } // not signed in -> redirect to /login
  | { status: "unknown-role"; user: CurrentUser } // signed in, but the role has no dashboard
  | { status: "ok"; user: CurrentUser; dash: RoleDashboard };

/**
 * The single entry point every dashboard page AND the layout must call. The role comes from the
 * database (via getCurrentUser), never from the URL, a query string, a cookie value or localStorage.
 * Layouts are not re-run on client-side navigation, so each page must call this itself.
 */
export async function getDashboardContext(): Promise<DashboardContext> {
  const user = await getCurrentUser();
  if (!user) return { status: "anonymous" };
  const dash = getRoleDashboard(user.role);
  return dash ? { status: "ok", user, dash } : { status: "unknown-role", user };
}
