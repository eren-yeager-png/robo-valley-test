// The Member portals' navigation (Student, Teacher, Parent and every other role): ONE list, used by the dashboard layout and by the
// shared "My Contributions" page, so every portal shows the same items in the same order and the current one is highlighted.
import type { RoleDashboard } from "./dashboardConfig";

export type NavItem = { href: string; label: string };
export const MY_CONTRIBUTIONS: NavItem = { href: "/my-contributions", label: "My Contributions" };

/** Home, the role's own sections, Sectors, My Contributions, Notifications, Profile & settings. */
export function memberNavItems(dash: Pick<RoleDashboard, "sections">): NavItem[] {
  return [
    { href: "/dashboard", label: "Home" },
    ...dash.sections.map((s) => ({ href: `/dashboard/${s.slug}`, label: s.label })),
    { href: "/dashboard/sectors", label: "Sectors" },
    MY_CONTRIBUTIONS,
    { href: "/dashboard/notifications", label: "Notifications" },
    { href: "/dashboard/profile", label: "Profile & settings" },
  ];
}
