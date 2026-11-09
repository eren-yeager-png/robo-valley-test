import { NextResponse } from "next/server";
import { preflight, withCors } from "../../../../../../lib/cors";
import { json } from "../../../../../../lib/http";
import { pool } from "../../../../../../lib/db";
import { guardReviewer } from "../../../../../../lib/reviewerGuard";
import { parseId } from "../../../../../../lib/contributorGuard";
import { getPhotoBytes } from "../../../../../../lib/contributionPhotos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const METHODS = "GET, OPTIONS";
export const OPTIONS = (req: Request) => preflight(req, METHODS);

/** A photo of a SUBMITTED item (never a draft's) for a reviewer. Served as an image only, never cached, never interpreted by the browser. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; photoId: string }> }) {
  const g = await guardReviewer(req, METHODS);
  if ("res" in g) return g.res;
  const p = await ctx.params;
  const id = parseId(p.id), photoId = parseId(p.photoId);
  const missing = () => withCors(req, json({ success: false, error: "NOT_FOUND", message: "We could not find that photo." }, 404), METHODS);
  if (id === null || photoId === null) return missing();
  try {
    const ok = await pool.query("SELECT 1 FROM contribution_photos p JOIN contributions c ON c.id = p.contribution_id WHERE p.id = $1 AND c.id = $2 AND c.status <> 'draft'", [photoId, id]);
    if (ok.rows.length === 0) return missing();
    const photo = await getPhotoBytes(pool as never, photoId);
    if (!photo) return missing();
    return withCors(req, new NextResponse(new Uint8Array(photo.bytes), { status: 200, headers: {
      "Content-Type": photo.mime, "Content-Length": String(photo.bytes.length), "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Disposition": "inline",
    } }), METHODS);
  } catch (e) {
    if ((e as { code?: string })?.code === "42P01") return withCors(req, json({ success: false, error: "NOT_SET_UP", message: "Reviewing is not set up yet." }, 503), METHODS);
    console.error("review photo failed: server error");
    return withCors(req, json({ success: false, error: "SERVER_ERROR", message: "Something went wrong." }, 500), METHODS);
  }
}
