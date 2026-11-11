// Shared front door of every contributor route (write routes use guardContributorWrite, which also refuses reviewers): the page must be allowed to call (same site or an allowed origin), the visitor
// address and the signed-in user are each rate limited, and the user must be signed in with a verified account (getCurrentUser
// re-reads the user on every call). Answers are never cached. Nothing about the data is logged.
import { json } from "./http";
import { originAllowed, withCors } from "./cors";
import { getCurrentUser, type CurrentUser } from "./currentUser";
import { hitRateLimit, rateLimitEnabled, rateLimitedResponse, type RateScope } from "./apiRateLimit";
import { clientIp } from "./projectsRateLimit";
import { pool } from "./db";
import { reviewerOf } from "./moderators";

export type Guarded = { res: Response } | { user: CurrentUser; userId: number };

export async function guardContributor(req: Request, methods: string, scope: Extract<RateScope, "contribUser" | "contribPhoto"> = "contribUser"): Promise<Guarded> {
  const out = (r: Response) => ({ res: withCors(req, r, methods) });
  if (!originAllowed(req)) return out(json({ success: false, error: "FORBIDDEN", message: "This page is not allowed to do that." }, 403));
  if (rateLimitEnabled()) {
    const ip = await hitRateLimit(clientIp(req), "contribIp");
    if (!ip.allowed) return out(rateLimitedResponse(ip.retryAfterSeconds, "sending contributions"));
  }
  const user = await getCurrentUser();
  if (!user) return out(json({ success: false, error: "SIGN_IN_REQUIRED", message: "Please sign in to contribute." }, 401));
  const userId = Number(user.id);
  if (rateLimitEnabled()) {
    const d = await hitRateLimit(`user:${userId}`, scope);
    if (!d.allowed) return out(rateLimitedResponse(d.retryAfterSeconds, "sending contributions"));
  }
  return { user, userId };
}

/** The answer an administrator or moderator gets from a contribution write route. */
export const REVIEWER_CANNOT_CONTRIBUTE = "Administrators and moderators review contributions. Please use a member account to contribute.";

/**
 * Front door of every contribution WRITE route (create, edit, delete a draft, photos, contact details, submit): the same checks as
 * guardContributor, and then administrators and flagged moderators are refused with 403. Reviewers review; members contribute.
 * Reading your own items (My Contributions, your own item) stays open to everyone signed in. reviewerOf reads the database on every
 * call; if it cannot tell (for example migration 015 is missing), only a real administrator is refused.
 */
/** Does this account review contributions (an administrator, or the moderator flag)? Read from the database on every call; fails closed. */
export async function isReviewer(userId: number): Promise<boolean> {
  return (await reviewerOf(pool as never, userId)).ok;
}

export async function guardContributorWrite(req: Request, methods: string, scope: Extract<RateScope, "contribUser" | "contribPhoto"> = "contribUser"): Promise<Guarded> {
  const g = await guardContributor(req, methods, scope);
  if ("res" in g) return g;
  if (await isReviewer(g.userId)) return { res: withCors(req, json({ success: false, error: "REVIEWER_CANNOT_CONTRIBUTE", message: REVIEWER_CANNOT_CONTRIBUTE }, 403), methods) };
  return g;
}

/** A hidden field that people never see: if a program filled it in, pretend it worked and store nothing. */
export const isBot = (body: unknown) =>
  typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).website === "string" && (body as Record<string, unknown>).website !== "";

export const parseId = (raw: string) => (/^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null);
export const notFound = () => json({ success: false, error: "NOT_FOUND", message: "We could not find that contribution." }, 404);
export const serverError = () => json({ success: false, error: "SERVER_ERROR", message: "Something went wrong. Please try again." }, 500);
