import { firstNameOf, type CurrentUser } from "./currentUser";
import { reviewerOf } from "./moderators";
import { ROLES } from "./roles";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };

/**
 * What the shared header account menu (public/rv-header-menu.js) draws for the signed-in person: the menu role, the first name and
 * its initial, the stakeholder label (members only) and the one count that role's menu shows. No email, no id, no full name.
 * Display only: every admin and moderation page and API checks the role again on the server.
 */
export type MenuRole = "member" | "moderator" | "admin";
export type MenuCounts = { myContributions: number } | { reviewQueue: number };
export type MenuAnswer =
  | { authenticated: false }
  | { authenticated: true; role: MenuRole; firstName: string; initial: string; stakeholder: string | null; counts: MenuCounts | null };

/** The number next to "My contributions" (the rows My Contributions lists) or "Review queue" (the "Pending review" tile on /moderation). */
async function countsFor(db: Db, role: MenuRole, userId: number): Promise<MenuCounts | null> {
  try {
    if (role === "member") {
      const r = await db.query("SELECT count(*)::int AS n FROM contributions WHERE user_id = $1", [userId]);
      return { myContributions: Number(r.rows[0]?.n ?? 0) };
    }
    const r = await db.query("SELECT count(*)::int AS n FROM contributions WHERE status = 'pending_review' AND NOT is_demo");
    return { reviewQueue: Number(r.rows[0]?.n ?? 0) };
  } catch {
    console.error("header menu: the count could not be read"); // the menu is then shown without its badge
    return null;
  }
}

/** `user` comes from getCurrentUser() (signed cookie verified, account re-read). The role is read from the database here too. */
export async function headerMenuFor(db: Db, user: CurrentUser | null): Promise<MenuAnswer> {
  if (!user) return { authenticated: false };
  const id = Number(user.id);
  const role: MenuRole = user.role === "admin" ? "admin" : (await reviewerOf(db as never, id)).ok ? "moderator" : "member";
  const firstName = firstNameOf(user.fullName) ?? "";
  const initial = (Array.from(firstName)[0] ?? "?").toLocaleUpperCase("en-IN");
  const stakeholder = role === "member" ? (ROLES.find((r) => r[0] === user.role)?.[1] ?? null) : null;
  return { authenticated: true, role, firstName, initial, stakeholder, counts: await countsFor(db, role, id) };
}
