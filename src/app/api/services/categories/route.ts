import { preflight, withCors } from "../../../../lib/cors";
import { json } from "../../../../lib/http";
import { pool } from "../../../../lib/db";
import { enforceRateLimit } from "../../../../lib/apiRateLimit";
import { SERVICE_CACHE_CONTROL } from "../../../../lib/serviceCache";
import { listCategories } from "../../../../lib/serviceDatasets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METHODS = "GET, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);

/** Public. The six categories in their fixed order, each with whether it has live data and how many rows. `defaultSlug` is the first live one. */
export async function GET(req: Request) {
  const reply = (body: unknown, status: number) => withCors(req, json(body, status), METHODS);
  const limited = await enforceRateLimit(req, "categories");
  if (limited) return withCors(req, limited, METHODS);
  try {
    const categories = await listCategories(pool);
    return withCors(req, json({ success: true, categories, defaultSlug: categories.find((c) => c.active)?.slug ?? null }, 200, { "Cache-Control": SERVICE_CACHE_CONTROL }), METHODS);
  } catch {
    console.error("categories failed: server error");
    return reply({ success: false, error: "SERVER_ERROR", message: "Categories are not available right now. Please try again." }, 500);
  }
}
