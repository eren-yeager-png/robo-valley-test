// Server-side administrator authorization. The ONLY place that decides "is this an admin".
// Deny by default: the session cookie must verify, and the user's role is read from the database
// (via getCurrentUser) on every call. Nothing from a form, URL, request body or browser storage is trusted,
// and there is no rule based on the shape of an email address.

import { getCurrentUser, type CurrentUser } from "./currentUser";
import { pool } from "./db";
import { json, sameOrigin } from "./http";

export const ADMIN_ROLE = "admin";
export const ADMIN_HOME = "/admin/dashboard";

export type AdminUser = CurrentUser & { mustChangePassword: boolean };
export type AdminContext =
  | { status: "anonymous" }
  | { status: "forbidden"; user: CurrentUser }
  | { status: "ok"; admin: AdminUser };

/** For Server Components: who is this, and are they an admin? */
export async function getAdminContext(): Promise<AdminContext> {
  const user = await getCurrentUser();
  if (!user) return { status: "anonymous" };
  if (user.role !== ADMIN_ROLE) return { status: "forbidden", user };
  let mustChangePassword = false;
  try {
    const { rows } = await pool.query("SELECT must_change_password FROM users WHERE id = $1", [user.id]);
    mustChangePassword = rows[0]?.must_change_password === true;
  } catch {
    console.error("admin: could not read must_change_password"); // fail closed is not needed (they are an admin), but never crash the page
  }
  return { status: "ok", admin: { ...user, mustChangePassword } };
}

/**
 * For route handlers: returns the admin, or the response to send (401 no/invalid session, 403 not an admin,
 * 403 for a cross-origin browser request). Use it first in every admin API:
 *   const auth = await requireAdmin(req); if (auth.response) return auth.response; // auth.admin is set from here on
 */
export async function requireAdmin(req?: Request): Promise<{ admin: AdminUser; response?: undefined } | { admin?: undefined; response: Response }> {
  if (req && !sameOrigin(req)) return { response: json({ success: false, error: "FORBIDDEN", message: "Request blocked." }, 403) };
  const ctx = await getAdminContext();
  if (ctx.status === "anonymous") return { response: json({ success: false, error: "UNAUTHENTICATED", message: "Please sign in." }, 401) };
  if (ctx.status === "forbidden") return { response: json({ success: false, error: "FORBIDDEN", message: "You do not have access to this." }, 403) };
  return { admin: ctx.admin };
}
