import { redirect } from "next/navigation";
import { getCurrentUser } from "./currentUser";
import { pool } from "./db";
import { reviewerOf } from "./moderators";

/** Guard for the reviewing PAGE: anonymous -> sign in; signed in but not an administrator or a flagged moderator -> their normal dashboard. */
export async function requireReviewerPage(): Promise<{ userId: number; email: string; isAdmin: boolean }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const r = await reviewerOf(pool as never, Number(user.id));
  if (!r.ok) redirect("/dashboard");
  return { userId: r.userId, email: user.email, isAdmin: r.isAdmin };
}
