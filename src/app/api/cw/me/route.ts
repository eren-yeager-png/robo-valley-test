// Who is filling in the form: signed in or not, the name and stakeholder type from the profile (shown read-only), whether the account
// is a minor (the form then hides the Earn (18+) path; the server refuses it anyway) and whether the account reviews contributions
// (reviewers share no ideas). Credentials are sent by the website; never cached.
import { preflight, withCors } from "../../../../lib/cors";
import { enforceRateLimit } from "../../../../lib/apiRateLimit";
import { pool } from "../../../../lib/db";
import { getCurrentUser } from "../../../../lib/currentUser";
import { isReviewer } from "../../../../lib/contributorGuard";
import { contributorProfile } from "../../../../lib/cw/lookups";
import { crashed, ok } from "../../../../lib/cw/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const METHODS = "GET, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);

export async function GET(req: Request) {
  const limited = await enforceRateLimit(req, "cwPublic");
  if (limited) return withCors(req, limited, METHODS);
  try {
    const user = await getCurrentUser();
    if (!user) return ok(req, { signedIn: false }, METHODS);
    const userId = Number(user.id);
    const profile = await contributorProfile(pool as never, userId);
    if (!profile) return ok(req, { signedIn: false }, METHODS);
    return ok(req, { signedIn: true, name: profile.fullName, type: profile.typeLabel, minor: profile.minor, reviewer: await isReviewer(userId) }, METHODS);
  } catch (e) {
    return crashed(req, e, METHODS, "me");
  }
}
