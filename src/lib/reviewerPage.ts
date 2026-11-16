import { redirect } from "next/navigation";
import { getCurrentUser } from "./currentUser";
import { pool } from "./db";
import { reviewerOf } from "./moderators";

export const PASSWORD_PAGE = "/moderation/change-password";

/**
 * Guard for the reviewing PAGES: anonymous -> sign in; signed in but not an administrator or a flagged moderator -> their normal
 * dashboard; a reviewer whose account still has its temporary password (made by a seed script) -> the change-password page, before
 * anything is shown or recorded. Only that page and the layout pass { passwordChange: true }.
 */
export async function requireReviewerPage(opts: { passwordChange?: boolean } = {}): Promise<{ userId: number; email: string; isAdmin: boolean; mustChangePassword: boolean }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const r = await reviewerOf(pool as never, Number(user.id));
  if (!r.ok) redirect("/dashboard");
  if (r.mustChangePassword && !opts.passwordChange) redirect(PASSWORD_PAGE);
  return { userId: r.userId, email: user.email, isAdmin: r.isAdmin, mustChangePassword: r.mustChangePassword };
}
