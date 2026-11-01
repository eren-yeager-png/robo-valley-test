import { requireAdmin } from "../../../../lib/admin";
import { preflight, withCors } from "../../../../lib/cors";
import { json } from "../../../../lib/http";
import { pool } from "../../../../lib/db";
import { stageDataset, writeAudit } from "../../../../lib/serviceDatasets";
import { MAX_FILE_BYTES, parseUpload, UploadError } from "../../../../lib/spreadsheet/parse";
import { readBodyLimited } from "../../../../lib/uploadBody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METHODS = "POST, OPTIONS";
const OVERHEAD = 256 * 1024; // multipart framing around the file

export const OPTIONS = (req: Request) => preflight(req, METHODS);

/** Admin only. Parses and validates the file, stages it as a new (not yet live) version and returns a preview. */
export async function POST(req: Request) {
  const reply = (body: unknown, status: number) => withCors(req, json(body, status), METHODS);

  // 1. Who is asking? Decided on the server from the signed session and the database, before the body is even read.
  const auth = await requireAdmin(req);
  if (auth.response) return withCors(req, auth.response, METHODS);
  const admin = auth.admin;

  let filename: string | null = null;
  try {
    const type = req.headers.get("content-type") ?? "";
    if (!/^multipart\/form-data\s*;/i.test(type)) return reply({ success: false, error: "BAD_REQUEST", message: "Send the file as multipart/form-data." }, 415);

    const body = await readBodyLimited(req, MAX_FILE_BYTES + OVERHEAD);
    if (!body) {
      await writeAudit(pool, { userId: admin.id, action: "upload", result: "rejected", detail: "file too large" });
      return reply({ success: false, error: "FILE_TOO_LARGE", message: `The file is larger than the ${MAX_FILE_BYTES / 1024 / 1024} MB limit.` }, 413);
    }
    let form: FormData;
    try {
      form = await new Request("http://upload.local/", { method: "POST", headers: { "content-type": type }, body: new Uint8Array(body) }).formData();
    } catch {
      return reply({ success: false, error: "BAD_REQUEST", message: "The upload could not be read." }, 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) return reply({ success: false, error: "BAD_REQUEST", message: "Choose a file to upload." }, 400);
    filename = file.name;

    const parsed = await parseUpload({ filename: file.name, mime: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
    const staged = await stageDataset(pool, admin.id, parsed);
    await writeAudit(pool, { userId: admin.id, action: "upload", result: "success", datasetId: staged.id, filename: parsed.filename, detail: `${staged.rowCount} rows, ${staged.invalidRowCount} invalid (staged)` });
    return reply({
      success: true,
      datasetId: staged.id,
      filename: parsed.filename,
      rowCount: staged.rowCount,
      invalidRowCount: staged.invalidRowCount,
      invalidRows: parsed.invalidRows,
      columns: parsed.headers.map((h) => h.label),
      preview: parsed.rows.slice(0, 5).map((r) => ({ schoolName: r.schoolName, state: r.state, district: r.district, pincode: r.pincode })),
    }, 200);
  } catch (e) {
    if (e instanceof UploadError) {
      await writeAudit(pool, { userId: admin.id, action: "upload", result: "rejected", filename, detail: `${e.code}: ${e.message}` });
      return reply({ success: false, error: e.code, message: e.message, ...(e.details ?? {}) }, e.status);
    }
    console.error("upload failed: server error");
    await writeAudit(pool, { userId: admin.id, action: "upload", result: "error", filename, detail: "server error" });
    return reply({ success: false, error: "SERVER_ERROR", message: "The upload could not be processed. Nothing was changed." }, 500);
  }
}
