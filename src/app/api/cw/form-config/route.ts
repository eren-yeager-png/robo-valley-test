// Public: what the "Share Your Idea" form needs from the app: the sectors and robot types from Sector Forms ("Not sure" is added by
// the form). Names only. Never cached.
import { preflight } from "../../../../lib/cors";
import { pool } from "../../../../lib/db";
import { loadSectors } from "../../../../lib/cw/lookups";
import { crashed, ok } from "../../../../lib/cw/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const METHODS = "GET, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);

export async function GET(req: Request) {
  try {
    return ok(req, { sectors: await loadSectors(pool as never) }, METHODS);
  } catch (e) {
    return crashed(req, e, METHODS, "form-config");
  }
}
