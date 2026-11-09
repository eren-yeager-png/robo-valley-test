// Shared front door of every contributor route: the page must be allowed to call (same site or an allowed origin), the visitor
// address and the signed-in user are each rate limited, and the user must be signed in with a verified account (getCurrentUser
// re-reads the user on every call). Answers are never cached. Nothing about the data is logged.
import { json } from "./http";
import { originAllowed, withCors } from "./cors";
import { getCurrentUser, type CurrentUser } from "./currentUser";
import { hitRateLimit, rateLimitEnabled, rateLimitedResponse, type RateScope } from "./apiRateLimit";
import { clientIp } from "./projectsRateLimit";

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

/** A hidden field that people never see: if a program filled it in, pretend it worked and store nothing. */
export const isBot = (body: unknown) =>
  typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).website === "string" && (body as Record<string, unknown>).website !== "";

export const parseId = (raw: string) => (/^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null);
export const notFound = () => json({ success: false, error: "NOT_FOUND", message: "We could not find that contribution." }, 404);
export const serverError = () => json({ success: false, error: "SERVER_ERROR", message: "Something went wrong. Please try again." }, 500);
