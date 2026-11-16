// Item 4: where a reviewer who is not an administrator lands after signing in (the Admin Portal), and the role value of a dedicated
// moderator account. Being a reviewer is still decided by reviewerOf (administrator, or the moderator flag read from the database).
import { reviewerOf } from "./moderators";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/** The Admin Portal: a moderator's dashboard. */
export const REVIEWER_HOME = "/moderation";

/**
 * users.role of an account made only for reviewing (scripts/seed-moderator.mjs). It is not one of the 12 member roles, so self-signup
 * can never create it, and it has no member dashboard. Access still comes from the moderator flag: without the flag the account can
 * do nothing (no review, no contributing).
 */
export const MODERATOR_ROLE = "moderator";

/** REVIEWER_HOME for a signed-in reviewer who is not an administrator; null for everyone else (administrators keep their own landing). */
export async function reviewerLanding(db: Db, userId: number, role: string): Promise<string | null> {
  if (role === "admin") return null;
  const r = await reviewerOf(db, userId); // never throws: any database problem means "not a reviewer"
  return r.ok && !r.isAdmin ? REVIEWER_HOME : null;
}
