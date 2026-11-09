import { preflight, withCors } from "../../../../../lib/cors";
import { json } from "../../../../../lib/http";
import { pool } from "../../../../../lib/db";
import { addOwnPhoto, removeOwnPhoto } from "../../../../../lib/contributionApi";
import { CONTRIBUTION_LIMITS } from "../../../../../lib/contributions";
import { guardContributor, notFound, parseId, serverError } from "../../../../../lib/contributorGuard";
import { answer } from "../../../../../lib/contributorRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const METHODS = "POST, DELETE, OPTIONS";
type Ctx = { params: Promise<{ id: string }> };
export const OPTIONS = (req: Request) => preflight(req, METHODS);

const BIG = "That photo is larger than 4 MB. Choose a smaller one.";
const tooBig = () => json({ success: false, error: "REQUEST_TOO_LARGE", message: BIG, fieldErrors: { photo: BIG } }, 413);

/** ONE photo per request: multipart form with "photo" (the file) and "alt" (the description, required). */
export async function POST(req: Request, ctx: Ctx) {
  const g = await guardContributor(req, METHODS, "contribPhoto");
  if ("res" in g) return g.res;
  const id = parseId((await ctx.params).id);
  if (id === null) return withCors(req, notFound(), METHODS);
  const limit = CONTRIBUTION_LIMITS.photoBytesMax + 64 * 1024; // the file plus the form's own overhead
  if (Number(req.headers.get("content-length") ?? 0) > limit) return withCors(req, tooBig(), METHODS);
  try {
    let form: FormData;
    try { form = await req.formData(); } catch { return withCors(req, json({ success: false, error: "BAD_REQUEST", message: "Could not read the photo." }, 400), METHODS); }
    const file = form.get("photo"), alt = form.get("alt");
    if (typeof file === "string" || file === null) return withCors(req, json({ success: false, error: "VALIDATION_FAILED", message: "Please fix the highlighted fields.", fieldErrors: { photo: "Choose a photo." } }, 400), METHODS);
    if (file.size > CONTRIBUTION_LIMITS.photoBytesMax) return withCors(req, tooBig(), METHODS);
    const bytes = Buffer.from(await file.arrayBuffer());
    return answer(req, METHODS, await addOwnPhoto(pool as never, g.userId, id, { bytes, alt: typeof alt === "string" ? alt : "" }), 201);
  } catch { console.error("photo upload failed: server error"); return withCors(req, serverError(), METHODS); }
}

/** Removes one of your photos: DELETE ?photoId=n */
export async function DELETE(req: Request, ctx: Ctx) {
  const g = await guardContributor(req, METHODS);
  if ("res" in g) return g.res;
  const id = parseId((await ctx.params).id), photoId = parseId(new URL(req.url).searchParams.get("photoId") ?? "");
  if (id === null || photoId === null) return withCors(req, notFound(), METHODS);
  try { return answer(req, METHODS, await removeOwnPhoto(pool as never, g.userId, id, photoId)); }
  catch { console.error("photo removal failed: server error"); return withCors(req, serverError(), METHODS); }
}
