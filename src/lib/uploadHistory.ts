// Read-only upload history for the admin pages (dataset uploads, dataset confirmations and stored files), newest first.
import type { Db } from "./adminStats";

export const HISTORY_PAGE_SIZE = 20;
export const HISTORY_KINDS = ["dataset", "attachment"] as const;
export const HISTORY_RESULTS = ["success", "rejected", "error"] as const;

export type HistoryRow = {
  id: string; at: string; action: "upload" | "confirm"; kind: "dataset" | "attachment"; filename: string | null;
  size: number | null; result: string; by: string | null; detail: string | null; downloadKey: string | null;
};

export async function listHistory(db: Db, opts: { page: number; kind?: string; result?: string; hasAttachments: boolean }): Promise<{ rows: HistoryRow[]; total: number; page: number; pages: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  // Without migration 009 there is no kind column: everything in the log is a dataset action.
  const kindExpr = opts.hasAttachments ? "a.kind" : "'dataset'";
  if (opts.kind && (HISTORY_KINDS as readonly string[]).includes(opts.kind)) { params.push(opts.kind); where.push(`${kindExpr} = $${params.length}`); }
  if (opts.result && (HISTORY_RESULTS as readonly string[]).includes(opts.result)) { params.push(opts.result); where.push(`a.result = $${params.length}`); }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const total = Number((await db.query(`SELECT count(*)::int AS n FROM upload_audit_log a ${w}`, params)).rows[0].n);
  const pages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(opts.page) || 1), pages);
  const extra = opts.hasAttachments ? "a.file_size, att.storage_key" : "NULL::int AS file_size, NULL::text AS storage_key";
  const join = opts.hasAttachments ? "LEFT JOIN upload_attachments att ON att.id = a.attachment_id" : "";
  const r = await db.query(
    `SELECT a.id, a.created_at, a.action, ${kindExpr} AS kind, a.filename, a.result, a.detail, u.email AS who, ${extra}
       FROM upload_audit_log a LEFT JOIN users u ON u.id = a.user_id ${join} ${w}
      ORDER BY a.created_at DESC, a.id DESC LIMIT ${HISTORY_PAGE_SIZE} OFFSET ${(page - 1) * HISTORY_PAGE_SIZE}`, params);
  return {
    total, page, pages,
    rows: r.rows.map((x) => ({
      id: String(x.id), at: new Date(x.created_at).toISOString(), action: x.action, kind: x.kind, filename: x.filename,
      size: x.file_size === null || x.file_size === undefined ? null : Number(x.file_size), result: x.result, by: x.who, detail: x.detail,
      downloadKey: x.storage_key ?? null,
    })),
  };
}

export function formatSize(n: number | null): string {
  if (n === null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
