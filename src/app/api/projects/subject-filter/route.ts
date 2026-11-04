import { preflight } from "../../../../lib/cors";
import { guardProjectsRequest, projectsReply } from "../../../../lib/projectsGate";
import { getSubjectIds } from "../../../../lib/projectsBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // never prerendered or cached

const METHODS = "GET, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);

const MAX_SLUGS = 12;
// lower-case letters and digits, single hyphens or underscores between them (what WordPress slugs look like)
const SLUG = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

/**
 * Members only: ids of the published projects that have ANY of the given subjects (?subjects=physics,chemistry).
 * Subjects are members-only data, so the public catalogue cannot filter by them; the website asks this route (signed-in
 * visitors only), then passes the ids to the public catalogue's "include" parameter to show the usual public cards.
 *
 * Returns { ids, total, limit, truncated }. When the match is larger than the bridge's cap, `truncated` is true and `total`
 * is the real number: the result is never cut silently.
 */
export async function GET(req: Request) {
  const reply = (body: unknown, status: number) => projectsReply(req, METHODS, body, status);

  // Validate the input first. Slugs are a strict whitelist of characters; WordPress then ignores slugs that are not real subjects.
  const raw = new URL(req.url).searchParams.get("subjects") ?? "";
  const slugs = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
  if (slugs.length < 1 || slugs.length > MAX_SLUGS || !slugs.every((s) => s.length <= 60 && SLUG.test(s))) {
    return reply({ success: false, error: "BAD_REQUEST" }, 400);
  }

  const guard = await guardProjectsRequest(req, METHODS);
  if (guard.response) return guard.response;

  const result = await getSubjectIds(slugs);
  if ("data" in result) return reply({ success: true, ...result.data }, 200);
  return reply({ success: false, error: "UNAVAILABLE" }, 503);
}
