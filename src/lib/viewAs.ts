// Users & Roles' "View as" (administrators only): which portal someone gets, the navigation they see and their own contributions,
// read-only. It never signs in as them and acts for no one: the administrator's own session reads the same lists the person's pages
// read. No passwords, contact details or tokens are selected.
import { getRoleDashboard } from "./dashboardConfig";
import { memberNavItems } from "./memberNav";
import { reviewerOf } from "./moderators";
import { myContributions, type MineItem } from "./cw/mine";
import { ADMIN_NAV, MODERATOR_NAV } from "../app/admin/_components/nav";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
export type ViewAs = {
  id: number; name: string; roleLabel: string; minor: boolean; portal: "admin" | "moderator" | "member" | "none";
  nav: string[]; items: MineItem[]; itemsReady: boolean;
};

export async function viewAs(db: Db, id: number): Promise<ViewAs | null> {
  const u = (await db.query("SELECT id, full_name, role, age_category FROM users WHERE id = $1", [id])).rows[0];
  if (!u) return null;
  const r = await reviewerOf(db as never, Number(u.id)).catch(() => ({ ok: false as const }));
  const dash = getRoleDashboard(u.role);
  const portal = r.ok ? (r.isAdmin ? "admin" : "moderator") : dash ? "member" : "none";
  const nav = portal === "admin" ? ADMIN_NAV.map((n) => n.label) : portal === "moderator" ? MODERATOR_NAV.map((n) => n.label) : dash ? memberNavItems(dash).map((n) => n.label) : [];
  let items: MineItem[] = [], itemsReady = true;
  try { items = await myContributions(db as never, Number(u.id), { editUrl: "" }); } catch { itemsReady = false; }
  return {
    id: Number(u.id), name: String(u.full_name ?? ""), roleLabel: u.role === "admin" ? "Administrator" : dash?.label ?? String(u.role ?? ""),
    minor: u.age_category === "minor", portal, nav, items: items.map((i) => ({ ...i, editUrl: "" })), itemsReady,
  };
}
