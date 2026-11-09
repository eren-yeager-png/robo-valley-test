import { preflight, withCors } from "../../../../lib/cors";
import { json } from "../../../../lib/http";
import { pool } from "../../../../lib/db";
import { listMine } from "../../../../lib/contributionMine";
import { guardContributor, serverError } from "../../../../lib/contributorGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const METHODS = "GET, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);

/** Signed-in only: your own contributions by status, with the reviewers' notes, and whether you are a Contributor. Never cached. */
export async function GET(req: Request) {
  const g = await guardContributor(req, METHODS);
  if ("res" in g) return g.res;
  try {
    return withCors(req, json({ success: true, ...(await listMine(pool as never, g.userId)) }), METHODS);
  } catch (e) {
    if ((e as { code?: string })?.code === "42P01") return withCors(req, json({ success: false, error: "NOT_SET_UP", message: "Contributions are not set up yet." }, 503), METHODS);
    console.error("list own contributions failed: server error");
    return withCors(req, serverError(), METHODS);
  }
}
