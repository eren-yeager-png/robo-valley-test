import { preflight, withCors } from "../../../lib/cors";
import { json, readJson } from "../../../lib/http";
import { pool } from "../../../lib/db";
import { saveOwn } from "../../../lib/contributionApi";
import { guardContributor, isBot, serverError } from "../../../lib/contributorGuard";
import { answer } from "../../../lib/contributorRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const METHODS = "POST, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);

/** Signed-in contributors only. Creates a DRAFT (nothing is public, nothing is reviewed until it is submitted). */
export async function POST(req: Request) {
  const g = await guardContributor(req, METHODS);
  if ("res" in g) return g.res;
  const body = await readJson(req, 16 * 1024);
  if ("error" in body) return withCors(req, body.error, METHODS);
  if (isBot(body.body)) return withCors(req, json({ success: true, id: 0, status: "draft" }, 201), METHODS); // honeypot: looks like success, stores nothing
  try {
    return answer(req, METHODS, await saveOwn(pool as never, g.userId, body.body), 201);
  } catch { console.error("create contribution failed: server error"); return withCors(req, serverError(), METHODS); }
}
