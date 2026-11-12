import { preflight, withCors } from "../../../../lib/cors";
import { json, readJson } from "../../../../lib/http";
import { pool } from "../../../../lib/db";
import { deleteDraft, getOwn, saveOwn } from "../../../../lib/contributionApi";
import { guardContributor, guardContributorWrite, isBot, notFound, parseId, serverError } from "../../../../lib/contributorGuard";
import { answer } from "../../../../lib/contributorRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const METHODS = "GET, PATCH, DELETE, OPTIONS";
type Ctx = { params: Promise<{ id: string }> };
export const OPTIONS = (req: Request) => preflight(req, METHODS);

/** Your own contribution only (the id of somebody else's looks exactly like one that does not exist). */
export async function GET(req: Request, ctx: Ctx) {
  const g = await guardContributor(req, METHODS);
  if ("res" in g) return g.res;
  const id = parseId((await ctx.params).id);
  if (id === null) return withCors(req, notFound(), METHODS);
  try { return answer(req, METHODS, await getOwn(pool as never, g.userId, id)); }
  catch { console.error("read contribution failed: server error"); return withCors(req, serverError(), METHODS); }
}

/** Saves a change. An edited published item goes back to Pending review (and leaves the public numbers). */
export async function PATCH(req: Request, ctx: Ctx) {
  const g = await guardContributorWrite(req, METHODS);
  if ("res" in g) return g.res;
  const id = parseId((await ctx.params).id);
  if (id === null) return withCors(req, notFound(), METHODS);
  const body = await readJson(req, 16 * 1024);
  if ("error" in body) return withCors(req, body.error, METHODS);
  if (isBot(body.body)) return withCors(req, json({ success: true, id, status: "draft" }), METHODS);
  try { return answer(req, METHODS, await saveOwn(pool as never, g.userId, body.body, id)); }
  catch { console.error("save contribution failed: server error"); return withCors(req, serverError(), METHODS); }
}

/** Only your own DRAFT can be deleted. */
export async function DELETE(req: Request, ctx: Ctx) {
  const g = await guardContributorWrite(req, METHODS);
  if ("res" in g) return g.res;
  const id = parseId((await ctx.params).id);
  if (id === null) return withCors(req, notFound(), METHODS);
  try { return answer(req, METHODS, await deleteDraft(pool as never, g.userId, id)); }
  catch { console.error("delete draft failed: server error"); return withCors(req, serverError(), METHODS); }
}
