import { preflight } from "../../../../lib/cors";
import { guardProjectsRequest, projectsReply } from "../../../../lib/projectsGate";
import { getProject } from "../../../../lib/projectsBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // never prerendered or cached

const METHODS = "GET, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);

const MAX_ID = 2_147_483_647;

/**
 * Members only: the full details of one project (overview, subjects, skills, components, expected outcome).
 * The data lives in WordPress and is fetched server-side through the signed bridge; it is never sent to anyone who is not
 * signed in. Fails closed: if the bridge is down, slow or misconfigured the answer is 503 with no project data.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const reply = (body: unknown, status: number) => projectsReply(req, METHODS, body, status);

  // The id is checked before anything else: a positive integer, no signs, no leading zeros, nothing else.
  const { id: raw } = await ctx.params;
  const id = /^[1-9][0-9]{0,9}$/.test(raw) ? Number(raw) : 0;
  if (id < 1 || id > MAX_ID) return reply({ success: false, error: "BAD_REQUEST" }, 400);

  const guard = await guardProjectsRequest(req, METHODS);
  if (guard.response) return guard.response;

  const result = await getProject(id);
  if ("data" in result) return reply({ success: true, project: result.data }, 200);
  if (result.reason === "not_found") return reply({ success: false, error: "NOT_FOUND" }, 404);
  return reply({ success: false, error: "UNAVAILABLE" }, 503);
}
