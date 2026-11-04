import { redirect } from "next/navigation";
import { type AdminUser, getAdminContext } from "./admin";

/**
 * Guard for every admin PAGE (Server Component). Layouts are not re-run when you move between sibling pages, so each
 * page calls this itself: anonymous -> sign in, signed-in non-admin -> their normal dashboard. Nothing admin is rendered for them.
 */
export async function requireAdminPage(): Promise<AdminUser> {
  const ctx = await getAdminContext();
  if (ctx.status === "anonymous") redirect("/login");
  if (ctx.status === "forbidden") redirect("/dashboard");
  return ctx.admin;
}
