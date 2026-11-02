import { firstNameOf, getCurrentUser } from "../../../../lib/currentUser";
import { preflight, withCors } from "../../../../lib/cors";
import { json } from "../../../../lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METHODS = "GET, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);

/**
 * Tells the website only what it needs to draw the page: the role ("admin", "user" or null when not signed in) and the
 * FIRST name for the header label (null when not signed in). No full name, no email, no id.
 * It is a display hint only: every admin API checks the role again on the server.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  const role = !user ? null : user.role === "admin" ? "admin" : "user";
  const firstName = user ? firstNameOf(user.fullName) : null;
  return withCors(req, json({ role, firstName }, 200), METHODS);
}
