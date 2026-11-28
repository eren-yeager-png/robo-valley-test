// The admin portal's sidebar. The Contribution Portal's pages first, in the agreed order (Overview, Publish Requests, Moderation,
// Sector Forms, Sectors, Users & Roles, Community Ideas, Audit Log), then the site's data pages and Settings. One item per page, no
// duplicates. "Admin Approval Dashboard" is now Publish Requests; the Moderator Workspace is merged into Moderation; an administrator
// has no "My Contributions" item (they use "View as" in Users & Roles; the page itself still opens).
export const ADMIN_NAV = [
  { href: "/admin/dashboard", label: "Overview", icon: "▦" },
  { href: "/admin/approvals", label: "Publish Requests", icon: "★" },
  { href: "/admin/moderation", label: "Moderation", icon: "✓" },
  { href: "/admin/sector-forms", label: "Sector Forms", icon: "✎" },
  { href: "/admin/sectors", label: "Sectors", icon: "▥" },
  { href: "/admin/users", label: "Users & Roles", icon: "☺" },
  { href: "/admin/community-ideas", label: "Community Ideas", icon: "✦" },
  { href: "/admin/audit-log", label: "Audit Log", icon: "≣" },
  { href: "/admin/categories", label: "Manage Categories", icon: "☰" },
  { href: "/admin/datasets", label: "Manage Datasets", icon: "▤" },
  { href: "/admin/upload", label: "Upload Files", icon: "⇪" },
  { href: "/admin/upload-history", label: "Upload History", icon: "↺" },
  { href: "/admin/login-activity", label: "Login Activity", icon: "⎆" },
  { href: "/admin/reports", label: "Reports & Analytics", icon: "◔" },
  { href: "/admin/settings", label: "Settings", icon: "⚙" },
] as const;

/** A moderator who is not an administrator: Moderation (the Moderator Workspace is merged into it) and My Contributions. */
export const MODERATOR_NAV = [
  { href: "/admin/moderation", label: "Moderation", icon: "✓" },
  { href: "/my-contributions", label: "My Contributions", icon: "✉" }, // in every portal's navigation (shared page)
] as const;

/** Title shown in the top bar for a path (the longest matching nav entry). */
export function titleFor(pathname: string | null): string {
  const hit = [...ADMIN_NAV, ...MODERATOR_NAV].filter((n) => pathname === n.href || pathname?.startsWith(n.href + "/")).sort((a, b) => b.href.length - a.href.length)[0];
  return hit?.label ?? "Admin";
}
