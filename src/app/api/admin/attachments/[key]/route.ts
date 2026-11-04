import { requireAdmin } from "../../../../../lib/admin";
import { json } from "../../../../../lib/http";
import { pool } from "../../../../../lib/db";
import { contentDisposition, getAttachment } from "../../../../../lib/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin only download. The file is always sent as an attachment (never shown inline) with a type the SERVER chose. */
export async function GET(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  const { key } = await ctx.params;
  try {
    const file = await getAttachment(pool, key);
    if (!file) return json({ success: false, error: "NOT_FOUND", message: "That file was not found." }, 404);
    return new Response(new Uint8Array(file.content), {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(file.content.length),
        "Content-Disposition": contentDisposition(file.filename),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    console.error("attachment download failed: server error");
    return json({ success: false, error: "SERVER_ERROR", message: "The file could not be read." }, 500);
  }
}
