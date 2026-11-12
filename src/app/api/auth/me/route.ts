import { firstNameOf, getCurrentUser } from "../../../../lib/currentUser";
import { preflight, withCors } from "../../../../lib/cors";
import { json } from "../../../../lib/http";
import { ROLES } from "../../../../lib/roles";
import { isReviewer } from "../../../../lib/contributorGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METHODS = "GET, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);

/**
 * Tells the website only what it needs to draw the page: the role ("admin", "user" or null when not signed in), the
 * FIRST name for the header label, and the stakeholder category's label from the profile (e.g. "Student"; null for admins and
 * when not signed in; shown on the Contribute form), and whether the person reviews contributions (reviewer: the Contribute form then
 * shows a short note instead of the form, because reviewers cannot contribute). No full name, no email, no id.
 * It is a display hint only: every admin API checks the role again on the server.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  const role = !user ? null : user.role === "admin" ? "admin" : "user";
  const firstName = user ? firstNameOf(user.fullName) : null;
  const stakeholder = user && user.role !== "admin" ? (ROLES.find((r) => r[0] === user.role)?.[1] ?? null) : null;
  // an administrator reviews by role (already read from the database); anyone else only when isReviewer says so
  const reviewer = !user ? false : user.role === "admin" ? true : await isReviewer(Number(user.id));
  return withCors(req, json({ role, firstName, stakeholder, reviewer }, 200), METHODS);
}
