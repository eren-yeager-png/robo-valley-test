import { preflight, withCors } from "../../../../../lib/cors";
import { pool } from "../../../../../lib/db";
import { submitOwn } from "../../../../../lib/contributionApi";
import { guardContributorWrite, notFound, parseId, serverError } from "../../../../../lib/contributorGuard";
import { answer } from "../../../../../lib/contributorRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const METHODS = "POST, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);

/** Sends your own draft (or an item that needs changes) for review. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardContributorWrite(req, METHODS);
  if ("res" in g) return g.res;
  const id = parseId((await ctx.params).id);
  if (id === null) return withCors(req, notFound(), METHODS);
  try { return answer(req, METHODS, await submitOwn(pool as never, g.userId, id)); }
  catch { console.error("submit contribution failed: server error"); return withCors(req, serverError(), METHODS); }
}
