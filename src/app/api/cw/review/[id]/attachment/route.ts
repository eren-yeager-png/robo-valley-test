// The attachment of a contribution, for reviewers only (it is private: never public, never in the preview). Sent as a download with
// its real type (read from the file when it was uploaded), never cached, never sniffed by the browser.
import { pool } from "../../../../../../lib/db";
import { guardReviewer } from "../../../../../../lib/reviewerGuard";
import { parseId } from "../../../../../../lib/contributorGuard";
import { getAttachment } from "../../../../../../lib/cw/store";
import { crashed, failed } from "../../../../../../lib/cw/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const METHODS = "GET";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guardReviewer(req, METHODS);
  if ("res" in g) return g.res;
  const id = parseId((await ctx.params).id);
  const missing = { ok: false as const, status: 404, error: "NOT_FOUND", message: "There is no attachment." };
  if (id === null) return failed(req, missing, METHODS);
  try {
    const a = await getAttachment(pool as never, id);
    if (!a) return failed(req, missing, METHODS);
    const name = a.name.replace(/[^\w.\- ]/g, "_");
    return new Response(a.data as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": a.mime, "Content-Length": String(a.size), "Content-Disposition": `attachment; filename="${name}"`,
        "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store, private",
      },
    });
  } catch (e) {
    return crashed(req, e, METHODS, "attachment");
  }
}
