import { requireAdmin } from "../../../../lib/admin";
import { json } from "../../../../lib/http";
import { pool } from "../../../../lib/db";
import { readBodyLimited } from "../../../../lib/uploadBody";
import { tableExists } from "../../../../lib/adminStats";
import { AttachmentError, auditAttachmentRejection, MAX_ATTACHMENT_BYTES, MULTIPART_OVERHEAD, storeAttachment, uploadRateLimited } from "../../../../lib/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin only. Stores one file (xlsx, csv, pdf, docx, png, jpg, txt; at most 4 MB) after checking its real content. */
export async function POST(req: Request) {
  // 1. Who is asking? Decided on the server, from the signed session and the database, before the body is read.
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  const admin = auth.admin;

  let filename: string | null = null;
  try {
    if (!(await tableExists(pool, "upload_attachments"))) {
      return json({ success: false, error: "NOT_SET_UP", message: "File storage is not set up in this database yet (migration 009)." }, 503);
    }
    if (await uploadRateLimited(pool, admin.id)) {
      return json({ success: false, error: "RATE_LIMITED", message: "Too many uploads in a short time. Please wait a few minutes." }, 429, { "Retry-After": "600" });
    }
    const type = req.headers.get("content-type") ?? "";
    if (!/^multipart\/form-data\s*;/i.test(type)) return json({ success: false, error: "BAD_REQUEST", message: "Send the file as multipart/form-data." }, 415);

    const body = await readBodyLimited(req, MAX_ATTACHMENT_BYTES + MULTIPART_OVERHEAD);
    if (!body) {
      await auditAttachmentRejection(pool, admin.id, null, "FILE_TOO_LARGE");
      return json({ success: false, error: "FILE_TOO_LARGE", message: `The file is larger than the ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB limit.` }, 413);
    }
    let form: FormData;
    try {
      form = await new Request("http://upload.local/", { method: "POST", headers: { "content-type": type }, body: new Uint8Array(body) }).formData();
    } catch {
      return json({ success: false, error: "BAD_REQUEST", message: "The upload could not be read." }, 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) return json({ success: false, error: "BAD_REQUEST", message: "Choose a file to upload." }, 400);
    filename = file.name;

    const stored = await storeAttachment(pool, admin.id, file.name, Buffer.from(await file.arrayBuffer()));
    return json({
      success: true,
      attachment: { key: stored.storageKey, filename: stored.filename, type: stored.type, size: stored.size },
      ...(stored.duplicateOf ? { warning: `A file with identical contents was already uploaded as "${stored.duplicateOf.filename}". This copy was stored as well.` } : {}),
    }, 201);
  } catch (e) {
    if (e instanceof AttachmentError) {
      await auditAttachmentRejection(pool, admin.id, filename, `${e.code}: ${e.message}`);
      return json({ success: false, error: e.code, message: e.message }, e.status);
    }
    console.error("attachment upload failed: server error");
    await auditAttachmentRejection(pool, admin.id, filename, "server error", "error");
    return json({ success: false, error: "SERVER_ERROR", message: "The upload could not be processed. Nothing was stored." }, 500);
  }
}
