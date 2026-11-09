import { preflight, withCors } from "../../../../../lib/cors";
import { readJson } from "../../../../../lib/http";
import { pool } from "../../../../../lib/db";
import { removeOwnContact, saveOwnContact } from "../../../../../lib/contributionApi";
import { guardContributor, notFound, parseId, serverError } from "../../../../../lib/contributorGuard";
import { answer } from "../../../../../lib/contributorRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const METHODS = "PUT, DELETE, OPTIONS";
type Ctx = { params: Promise<{ id: string }> };
export const OPTIONS = (req: Request) => preflight(req, METHODS);

/** Your private contact details for this contribution. Only you can read them back; the reviewers only when you allow it. */
export async function PUT(req: Request, ctx: Ctx) {
  const g = await guardContributor(req, METHODS);
  if ("res" in g) return g.res;
  const id = parseId((await ctx.params).id);
  if (id === null) return withCors(req, notFound(), METHODS);
  const body = await readJson(req, 4 * 1024);
  if ("error" in body) return withCors(req, body.error, METHODS);
  try { return answer(req, METHODS, await saveOwnContact(pool as never, g.userId, id, body.body)); }
  catch { console.error("save contact failed: server error"); return withCors(req, serverError(), METHODS); }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const g = await guardContributor(req, METHODS);
  if ("res" in g) return g.res;
  const id = parseId((await ctx.params).id);
  if (id === null) return withCors(req, notFound(), METHODS);
  try { return answer(req, METHODS, await removeOwnContact(pool as never, g.userId, id)); }
  catch { console.error("remove contact failed: server error"); return withCors(req, serverError(), METHODS); }
}
