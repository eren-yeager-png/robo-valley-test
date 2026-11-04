// The checks every members-only Projects route runs, in this order, before it touches the WordPress bridge:
//   1. browser origin allowed?   (this app itself, or one of ALLOWED_ORIGINS)       otherwise 403
//   2. per-IP rate limit                                                           otherwise 429
//   3. signed-in member?         (getCurrentUser: verifies the rv_session cookie AND re-reads the user from the database)  otherwise 401
//   4. per-member rate limit                                                       otherwise 429
// Every response (success or error) is Cache-Control: no-store and carries CORS headers only for an allowed origin.
// Bodies are generic: they never say why a check failed beyond the status.

import { getCurrentUser, type CurrentUser } from "./currentUser";
import { originAllowed, withCors } from "./cors";
import { json } from "./http";
import { clientIp, rateLimit } from "./rateLimit";

export const IP_LIMIT = { limit: 120, windowMs: 60_000 };
export const USER_LIMIT = { limit: 60, windowMs: 60_000 };

/** A JSON reply that is never cached and gets CORS headers only for an allowed origin. */
export const projectsReply = (req: Request, methods: string, body: unknown, status: number, headers?: Record<string, string>) =>
  withCors(req, json(body, status, headers), methods);

export async function guardProjectsRequest(req: Request, methods: string): Promise<{ user: CurrentUser; response?: undefined } | { user?: undefined; response: Response }> {
  const reply = (body: unknown, status: number, headers?: Record<string, string>) => projectsReply(req, methods, body, status, headers);

  if (!originAllowed(req)) return { response: reply({ success: false, error: "FORBIDDEN" }, 403) };

  const byIp = rateLimit(`projects:ip:${clientIp(req)}`, IP_LIMIT.limit, IP_LIMIT.windowMs);
  if (!byIp.allowed) return { response: reply({ success: false, error: "TOO_MANY_REQUESTS" }, 429, { "Retry-After": String(byIp.retryAfterSeconds) }) };

  const user = await getCurrentUser();
  if (!user) return { response: reply({ success: false, error: "UNAUTHENTICATED" }, 401) };

  const byUser = rateLimit(`projects:user:${user.id}`, USER_LIMIT.limit, USER_LIMIT.windowMs);
  if (!byUser.allowed) return { response: reply({ success: false, error: "TOO_MANY_REQUESTS" }, 429, { "Retry-After": String(byUser.retryAfterSeconds) }) };

  return { user };
}
