import { preflight } from "../../../../lib/cors";
import { guardProjectsRequest, projectsReply } from "../../../../lib/projectsGate";
import { getSubjects } from "../../../../lib/projectsBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // never prerendered or cached

const METHODS = "GET, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);

/**
 * Members only: the list of subjects (slug + name) the members' Subject filter offers. Subjects are members-only data, so the
 * public pages never contain this list; it is fetched through the signed bridge for a signed-in member.
 */
export async function GET(req: Request) {
  const guard = await guardProjectsRequest(req, METHODS);
  if (guard.response) return guard.response;
  const result = await getSubjects();
  if ("data" in result) return projectsReply(req, METHODS, { success: true, subjects: result.data }, 200);
  return projectsReply(req, METHODS, { success: false, error: "UNAVAILABLE" }, 503);
}
