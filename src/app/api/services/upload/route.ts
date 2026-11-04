import { createHash } from "node:crypto";
import { requireAdmin } from "../../../../lib/admin";
import { preflight, withCors } from "../../../../lib/cors";
import { json } from "../../../../lib/http";
import { pool } from "../../../../lib/db";
import { stageDataset, writeAudit } from "../../../../lib/serviceDatasets";
import { categoryName, parseCategory } from "../../../../lib/serviceCategories";
import { MAX_FILE_BYTES, parseUpload, safeFilename, UploadError } from "../../../../lib/spreadsheet/parse";
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
    // The category comes from the fixed list only; a missing or unknown one is refused before the file is even parsed.
    const category = parseCategory(form.get("category"));
    if (!category) return reply({ success: false, error: "VALIDATION_FAILED", message: "Choose which category this file belongs to." }, 400);

    const bytes = Buffer.from(await file.arrayBuffer());
    // The very same file as the data that is already live for this category (and that already went through duplicate handling):
    // nothing to do, so no new dataset is created. (A dataset loaded before duplicate handling existed is not "the same": uploading
    // the file again is how it gets cleaned.)
    const same = await pool.query(
      "SELECT id FROM service_datasets WHERE status = 'active' AND category = $1 AND file_sha256 = $2 AND dedupe_version IS NOT NULL LIMIT 1",
      [category, createHash("sha256").update(bytes).digest("hex")]
    );
    if (same.rows[0]) {
      await writeAudit(pool, { userId: admin.id, action: "upload", result: "success", datasetId: String(same.rows[0].id), filename: safeFilename(file.name), detail: `${category}: identical to the live data, no changes` });
      return reply({
        success: true, unchanged: true, datasetId: String(same.rows[0].id), category: { slug: category, name: categoryName(category) }, filename: safeFilename(file.name),
        message: "This file is identical to the data that is already live for this category. No changes were made.",
      }, 200);
    }

    const parsed = await parseUpload({ filename: file.name, mime: file.type, buffer: bytes });
    const staged = await stageDataset(pool, admin.id, parsed, category);
    const d = parsed.dedupe;
    await writeAudit(pool, {
      userId: admin.id, action: "upload", result: "success", datasetId: staged.id, filename: parsed.filename,
      detail: `${category}: ${parsed.rowsRead} read, ${staged.rowCount} unique, ${staged.duplicatesSkipped} duplicates skipped, ${staged.invalidRowCount} invalid (staged)`,
    });
    return reply({
      success: true,
      unchanged: false,
      datasetId: staged.id,
      category: { slug: category, name: categoryName(category) },
      filename: parsed.filename,
      rowCount: staged.rowCount,
      invalidRowCount: staged.invalidRowCount,
      invalidRows: parsed.invalidRows.map((r) => ({ row: r.rowNumber, rowNumber: r.rowNumber, reason: r.reason, ...(r.sheet ? { sheet: r.sheet } : {}) })),
      columns: parsed.headers.map((h) => h.label),
      preview: parsed.rows.slice(0, 5).map((r) => ({ schoolName: r.schoolName, state: r.state, district: r.district, pincode: r.pincode })),
      // Every row of the file is accounted for: rowsRead = added + duplicatesSkipped + rejected.
      report: {
        rowsRead: parsed.rowsRead, added: staged.rowCount, duplicatesSkipped: staged.duplicatesSkipped, rowsFilled: staged.rowsFilled, conflictRows: d.conflictRows,
        rejected: staged.invalidRowCount, possibleDuplicates: staged.possibleDuplicates, hiddenRowsRead: parsed.hiddenRowsRead,
        repeatedHeaders: parsed.repeatedHeaderRows.length, sheets: parsed.sheetsRead,
        examples: { merged: d.merged.slice(0, 5), possible: d.possible.slice(0, 5) },
        url: `/api/admin/datasets/${staged.id}/report`,
      },
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
