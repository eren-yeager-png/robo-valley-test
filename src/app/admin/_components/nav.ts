export const ADMIN_NAV = [
  { href: "/admin/dashboard", label: "Overview", icon: "▦" },
  { href: "/admin/categories", label: "Manage Categories", icon: "☰" },
  { href: "/admin/datasets", label: "Manage Datasets", icon: "▤" },
  { href: "/admin/upload", label: "Upload Files", icon: "⇪" },
  { href: "/admin/upload-history", label: "Upload History", icon: "↺" },
  { href: "/admin/login-activity", label: "Login Activity", icon: "⎆" },
  { href: "/admin/reports", label: "Reports & Analytics", icon: "◔" },
  { href: "/admin/users", label: "User Management", icon: "☺" },
  { href: "/admin/sectors", label: "Sector Counts", icon: "▥" },
  { href: "/admin/sector-forms", label: "Sector Forms", icon: "✎" },
  { href: "/admin/moderation", label: "Moderation", icon: "✓" },
  { href: "/admin/workspace", label: "Moderator Workspace", icon: "✍" },
  { href: "/admin/settings", label: "Settings", icon: "⚙" },
] as const;

/** A moderator who is not an administrator reviews contributions and nothing else: Moderation (older contributions) and the workspace. */
export const MODERATOR_NAV = ADMIN_NAV.filter((n) => n.href === "/admin/moderation" || n.href === "/admin/workspace");

/** Title shown in the top bar for a path (the longest matching nav entry). */
export function titleFor(pathname: string | null): string {
  const hit = ADMIN_NAV.filter((n) => pathname === n.href || pathname?.startsWith(n.href + "/")).sort((a, b) => b.href.length - a.href.length)[0];
  return hit?.label ?? "Admin";
}
