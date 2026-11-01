import { getCurrentUser } from "../../../../lib/currentUser";
import { preflight, withCors } from "../../../../lib/cors";
import { json } from "../../../../lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METHODS = "GET, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);

/**
 * Tells the website only what it needs to draw the page: "admin", "user" or null (not signed in). No name, no email, no id.
 * It is a display hint only: every admin API checks the role again on the server.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  const role = !user ? null : user.role === "admin" ? "admin" : "user";
  return withCors(req, json({ role }, 200), METHODS);
}
