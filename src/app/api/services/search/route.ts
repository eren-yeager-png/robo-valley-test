import { preflight, withCors } from "../../../../lib/cors";
import { json } from "../../../../lib/http";
import { pool } from "../../../../lib/db";
import { enforceRateLimit } from "../../../../lib/apiRateLimit";
import { SERVICE_CACHE_CONTROL } from "../../../../lib/serviceCache";
import { parseSearchParams, searchServices } from "../../../../lib/serviceDatasets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // never prerendered at build time; the CDN may keep a successful answer for 60 s (lib/serviceCache.ts)

const METHODS = "GET, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);

/** Public (admins and everyone else see the same rows). Case-insensitive partial match on school name and location. */
export async function GET(req: Request) {
  const reply = (body: unknown, status: number) => withCors(req, json(body, status), METHODS);
  const limited = await enforceRateLimit(req, "search");
  if (limited) return withCors(req, limited, METHODS);
  const parsed = parseSearchParams(new URL(req.url).searchParams);
  if ("error" in parsed) return reply({ success: false, error: "VALIDATION_FAILED", message: parsed.error }, 400);
  try {
    return withCors(req, json({ success: true, ...(await searchServices(pool, parsed.value)) }, 200, { "Cache-Control": SERVICE_CACHE_CONTROL }), METHODS);
  } catch {
    console.error("search failed: server error");
    return reply({ success: false, error: "SERVER_ERROR", message: "Search is not available right now. Please try again." }, 500);
  }
}
