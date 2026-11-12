// Front door of every reviewing route and page: an allowed origin, a visitor-address limit, a signed-in user who is an administrator or a
// flagged moderator (read from the database on every call, fail closed), and a per-reviewer limit. Answers are never cached.
import { json } from "./http";
import { originAllowed, withCors } from "./cors";
import { getCurrentUser } from "./currentUser";
import { pool } from "./db";
import { reviewerOf } from "./moderators";
import { hitRateLimit, rateLimitEnabled, rateLimitedResponse, type RateScope } from "./apiRateLimit";
import { clientIp } from "./projectsRateLimit";

export type ReviewerGuarded = { res: Response } | { userId: number; isAdmin: boolean };

export async function guardReviewer(req: Request, methods: string, scope: Extract<RateScope, "modUser" | "modDecision"> = "modUser", opts: { passwordChange?: boolean } = {}): Promise<ReviewerGuarded> {
  const out = (r: Response) => ({ res: withCors(req, r, methods) });
  if (!originAllowed(req)) return out(json({ success: false, error: "FORBIDDEN", message: "Request blocked." }, 403));
  if (rateLimitEnabled()) {
    const ip = await hitRateLimit(clientIp(req), "modIp");
    if (!ip.allowed) return out(rateLimitedResponse(ip.retryAfterSeconds, "using this page"));
  }
  const user = await getCurrentUser();
  if (!user) return out(json({ success: false, error: "UNAUTHENTICATED", message: "Please sign in." }, 401));
  const r = await reviewerOf(pool as never, Number(user.id));
  if (!r.ok) return out(json({ success: false, error: "FORBIDDEN", message: "You do not have access to this." }, 403));
  if (r.mustChangePassword && !opts.passwordChange) return out(json({ success: false, error: "PASSWORD_CHANGE_REQUIRED", message: "Please choose your own password first (Admin Portal)." }, 403));
  if (rateLimitEnabled()) {
    const d = await hitRateLimit(`rev:${r.userId}`, scope);
    if (!d.allowed) return out(rateLimitedResponse(d.retryAfterSeconds, "using this page"));
  }
  return { userId: r.userId, isAdmin: r.isAdmin };
}
