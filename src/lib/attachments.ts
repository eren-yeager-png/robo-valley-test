// Admin file attachments (migration 009). These are plain stored files: they have NO link to the school directory
// (service_datasets / service_dataset_rows), so storing one can never create a dataset row, go live or change the map.
// The file type is decided from the file CONTENT, never from the browser's claim; the stored name is random; the
// original name is display-only. Dataset spreadsheets keep using /api/services/upload.
import { createHash, randomBytes } from "node:crypto";

export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024; // Vercel functions reject request bodies much larger than this
export const MULTIPART_OVERHEAD = 64 * 1024;
export const UPLOADS_PER_WINDOW = 30; // per admin
export const UPLOAD_WINDOW_MINUTES = 10;

export type AttachmentType = "xlsx" | "csv" | "pdf" | "docx" | "png" | "jpg" | "txt";
const CONTENT_TYPES: Record<AttachmentType, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpg: "image/jpeg",
  txt: "text/plain",
};
const EXTENSIONS: Record<string, AttachmentType> = { xlsx: "xlsx", csv: "csv", pdf: "pdf", docx: "docx", png: "png", jpg: "jpg", jpeg: "jpg", txt: "txt" };
export const ATTACHMENT_EXTENSIONS = Object.keys(EXTENSIONS).map((e) => "." + e);

export class AttachmentError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
type Pool = Db & { connect: () => Promise<Db & { release: () => void }> };

/** The display name: no folders, no control characters, at most 255 characters. */
export function cleanFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const name = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 255);
  return name;
}

function isPlainText(buf: Buffer): boolean {
  if (buf.includes(0)) return false;
  try { new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { return false; }
  // eslint-disable-next-line no-control-regex
  return !/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(buf.toString("utf8"));
}

/** Decides what the file REALLY is and checks it agrees with its extension. Throws AttachmentError for anything else. */
export function detectAttachment(rawName: string, buf: Buffer): { filename: string; type: AttachmentType; contentType: string } {
  const filename = cleanFilename(rawName);
  if (!filename) throw new AttachmentError("BAD_FILENAME", "The file has no usable name.");
  if (buf.length === 0) throw new AttachmentError("EMPTY_FILE", "The file is empty.");
  if (buf.length > MAX_ATTACHMENT_BYTES) throw new AttachmentError("FILE_TOO_LARGE", `The file is larger than the ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB limit.`, 413);

  const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  const wanted = EXTENSIONS[ext];
  if (!wanted) throw new AttachmentError("TYPE_NOT_ALLOWED", `This file type is not allowed. Allowed: ${ATTACHMENT_EXTENSIONS.join(", ")}.`, 415);

  const head = (n: number) => buf.subarray(0, n);
  const latin = () => buf.toString("latin1");
  let ok = false;
  switch (wanted) {
    case "pdf": {
      ok = head(5).toString("latin1") === "%PDF-";
      if (ok && /\/(JavaScript|JS|Launch)\b/.test(latin())) throw new AttachmentError("ACTIVE_CONTENT", "PDFs with scripts or launch actions are not accepted.", 415);
      break;
    }
    case "png": ok = head(8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])); break;
    case "jpg": ok = head(3).equals(Buffer.from([0xff, 0xd8, 0xff])); break;
    case "xlsx":
    case "docx": {
      ok = head(4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
      if (ok) {
        const s = latin();
        if (s.includes("vbaProject.bin")) throw new AttachmentError("ACTIVE_CONTENT", "Files with macros are not accepted.", 415);
        ok = s.includes(wanted === "xlsx" ? "xl/workbook.xml" : "word/document.xml");
      }
      break;
    }
    case "csv":
    case "txt": ok = isPlainText(buf); break;
  }
  if (!ok) throw new AttachmentError("CONTENT_MISMATCH", `The contents of this file do not look like a real .${ext} file.`, 415);
  return { filename, type: wanted, contentType: CONTENT_TYPES[wanted] };
}

export type StoredAttachment = { id: string; storageKey: string; filename: string; type: AttachmentType; size: number; duplicateOf: { filename: string; uploadedAt: string } | null };

async function audit(db: Db, e: { userId: string; result: "success" | "rejected" | "error"; filename: string | null; detail: string; size?: number | null; sha?: string | null; attachmentId?: string | null }) {
  try {
    await db.query(
      `INSERT INTO upload_audit_log (user_id, action, result, filename, detail, kind, file_size, file_sha256, attachment_id)
       VALUES ($1, 'upload', $2, $3, $4, 'attachment', $5, $6, $7)`,
      [e.userId, e.result, e.filename?.slice(0, 255) ?? null, e.detail.slice(0, 1000), e.size ?? null, e.sha ?? null, e.attachmentId ?? null]);
  } catch {
    console.error("audit: could not write the upload log");
  }
}
export const auditAttachmentRejection = (db: Db, userId: string, filename: string | null, detail: string, result: "rejected" | "error" = "rejected") =>
  audit(db, { userId, result, filename, detail });

/** True when this admin has already made too many upload attempts recently (counts rejected ones too). */
export async function uploadRateLimited(db: Db, adminId: string): Promise<boolean> {
  const { rows } = await db.query(
    "SELECT count(*)::int AS n FROM upload_audit_log WHERE user_id = $1 AND action = 'upload' AND created_at > now() - ($2 || ' minutes')::interval",
    [adminId, String(UPLOAD_WINDOW_MINUTES)]);
  return Number(rows[0].n) >= UPLOADS_PER_WINDOW;
}

/** Validates, stores the bytes and the metadata in one transaction and writes the audit row. */
export async function storeAttachment(pool: Pool, adminId: string, rawName: string, buf: Buffer): Promise<StoredAttachment> {
  const info = detectAttachment(rawName, buf);
  const sha = createHash("sha256").update(buf).digest("hex");
  const key = randomBytes(16).toString("hex");
  const client = await pool.connect();
  let id: string;
  let dup: { rows: any[] };
  try {
    await client.query("BEGIN");
    dup = await client.query("SELECT original_filename, uploaded_at FROM upload_attachments WHERE file_sha256 = $1 ORDER BY uploaded_at LIMIT 1", [sha]);
    const ins = await client.query(
      `INSERT INTO upload_attachments (storage_key, uploaded_by, original_filename, detected_type, content_type, size_bytes, file_sha256)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [key, adminId, info.filename, info.type, info.contentType, buf.length, sha]);
    id = String(ins.rows[0].id);
    await client.query("INSERT INTO upload_attachment_blobs (attachment_id, content) VALUES ($1, $2)", [id, buf]);
    await client.query("COMMIT");
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* connection already gone */ }
    throw e;
  } finally {
    client.release();
  }
  // The audit row is written after the connection is returned to the pool, so a failure to log can never undo or block the upload.
  await audit(pool, { userId: adminId, result: "success", filename: info.filename, detail: `${info.type}, ${buf.length} bytes`, size: buf.length, sha, attachmentId: id });
  return {
    id, storageKey: key, filename: info.filename, type: info.type, size: buf.length,
    duplicateOf: dup.rows[0] ? { filename: dup.rows[0].original_filename, uploadedAt: new Date(dup.rows[0].uploaded_at).toISOString() } : null,
  };
}

export type AttachmentFile = { filename: string; contentType: string; size: number; content: Buffer };

/** The stored file for a download. `key` must be exactly 32 lowercase hex characters, otherwise nothing is looked up. */
export async function getAttachment(db: Db, key: string): Promise<AttachmentFile | null> {
  if (!/^[0-9a-f]{32}$/.test(key)) return null;
  const { rows } = await db.query(
    `SELECT a.original_filename, a.content_type, a.size_bytes, b.content
       FROM upload_attachments a JOIN upload_attachment_blobs b ON b.attachment_id = a.id WHERE a.storage_key = $1`, [key]);
  const r = rows[0];
  return r ? { filename: r.original_filename, contentType: r.content_type, size: Number(r.size_bytes), content: Buffer.from(r.content) } : null;
}

/** Header-safe download name: a plain ASCII fallback plus the real name encoded for browsers that support it. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "download";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`;
}
