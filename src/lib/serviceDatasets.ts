// Versioned school-directory datasets: stage -> confirm (atomic switch) -> search. Parameterised SQL only.
//
//  * stageDataset   writes an upload as status 'staged' (invisible to search) inside one transaction.
//  * confirmDataset makes a staged version 'active' and the previous one 'superseded' in ONE transaction, so searchers
//                   see either the old data or the new data, never a mixture. Any failure rolls back and the previous
//                   version stays live.
//  * searchServices reads only rows that belong to the single active version.

import type { ParsedFile } from "./spreadsheet/parse";

// pg row objects are untyped; they are only read by column name below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
type Pool = Queryable & { connect: () => Promise<Queryable & { release: () => void }> };

const INSERT_BATCH = 500;
export const STAGING_TTL_HOURS = 24;

export class DatasetError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

export type AuditAction = "upload" | "confirm";
export type AuditResult = "success" | "rejected" | "error";

/** Best-effort audit trail: who, when, what, result. A failure to log never changes the outcome of the request. */
export async function writeAudit(
  db: Queryable,
  e: { userId: string | null; action: AuditAction; result: AuditResult; datasetId?: string | null; filename?: string | null; detail?: string | null }
): Promise<void> {
  try {
    await db.query(
      "INSERT INTO upload_audit_log (user_id, action, result, dataset_id, filename, detail) VALUES ($1, $2, $3, $4, $5, $6)",
      [e.userId, e.action, e.result, e.datasetId ?? null, e.filename?.slice(0, 255) ?? null, e.detail?.slice(0, 1000) ?? null]
    );
  } catch {
    console.error("audit: could not write the upload log");
  }
}

export type StagedDataset = { id: string; rowCount: number; invalidRowCount: number };

/** Writes the parsed file as a new 'staged' version. Nothing becomes searchable here. */
export async function stageDataset(pool: Pool, adminId: string, file: ParsedFile): Promise<StagedDataset> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // A new preview replaces this admin's earlier unconfirmed previews (they were never live): drop their rows, keep the audit record.
    const old = await client.query("UPDATE service_datasets SET status = 'discarded' WHERE status = 'staged' AND uploaded_by = $1 RETURNING id", [adminId]);
    if (old.rows.length) await client.query("DELETE FROM service_dataset_rows WHERE dataset_id = ANY($1::bigint[])", [old.rows.map((r) => r.id)]);

    const ds = await client.query(
      `INSERT INTO service_datasets (uploaded_by, original_filename, file_sha256, row_count, invalid_row_count, columns, status)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'staged') RETURNING id`,
      [adminId, file.filename, file.sha256, file.rows.length, file.invalidRowCount, JSON.stringify(file.headers)]
    );
    const datasetId = String(ds.rows[0].id);

    for (let i = 0; i < file.rows.length; i += INSERT_BATCH) {
      const chunk = file.rows.slice(i, i + INSERT_BATCH);
      const params: unknown[] = [];
      const tuples = chunk.map((r, k) => {
        const b = k * 10;
        params.push(datasetId, r.rowNumber, r.schoolName, r.state || null, r.district || null, r.pincode || null, r.udiseCode || null,
          JSON.stringify(r.data), r.schoolName.toLowerCase(), r.locationText);
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}::jsonb, $${b + 9}, $${b + 10})`;
      });
      await client.query(
        `INSERT INTO service_dataset_rows (dataset_id, row_number, school_name, state, district, pincode, udise_code, data, search_name, search_loc)
         VALUES ${tuples.join(", ")}`,
        params
      );
    }
    await client.query("COMMIT");
    return { id: datasetId, rowCount: file.rows.length, invalidRowCount: file.invalidRowCount };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* connection already gone */ }
    throw e;
  } finally {
    client.release();
  }
}

export type ActivatedDataset = { id: string; rowCount: number; filename: string };

/** Atomic switch of the live dataset. Throws DatasetError (404/409) for anything that is not a fresh, complete staged version. */
export async function confirmDataset(pool: Pool, datasetId: string): Promise<ActivatedDataset> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id, status, row_count, original_filename, (uploaded_at < now() - ($2 || ' hours')::interval) AS expired
         FROM service_datasets WHERE id = $1 FOR UPDATE`,
      [datasetId, String(STAGING_TTL_HOURS)]
    );
    const d = rows[0];
    if (!d) throw new DatasetError("NOT_FOUND", "That upload was not found.", 404);
    if (d.status !== "staged") throw new DatasetError("NOT_STAGED", "That upload has already been confirmed or discarded. Upload the file again.", 409);
    if (d.expired) throw new DatasetError("STAGING_EXPIRED", "This preview is too old. Upload the file again.", 409);
    const n = await client.query("SELECT count(*)::int AS n FROM service_dataset_rows WHERE dataset_id = $1", [datasetId]);
    if (n.rows[0].n !== d.row_count) throw new DatasetError("STAGING_INCOMPLETE", "The staged data is incomplete, so nothing was changed. Upload the file again.", 409);

    await client.query("UPDATE service_datasets SET status = 'superseded' WHERE status = 'active'");
    await client.query("UPDATE service_datasets SET status = 'active', activated_at = now() WHERE id = $1", [datasetId]);
    await client.query("COMMIT");
    return { id: String(d.id), rowCount: d.row_count, filename: d.original_filename };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* connection already gone */ }
    if ((e as { code?: string }).code === "23505") throw new DatasetError("CONFLICT", "Another upload was confirmed at the same time. Please try again.", 409);
    throw e;
  } finally {
    client.release();
  }
}

// ---- search -------------------------------------------------------------------------------------------------------
export const MAX_QUERY_CHARS = 100;
export const MAX_TERMS = 6;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

export type SearchParams = { terms: string[]; locationTerms: string[]; page: number; pageSize: number };

function termsOf(raw: string | null): { terms: string[] } | { error: string } {
  const s = (raw ?? "").normalize("NFC").replace(/[\u0000-\u001F\u007F-\u009F]/g, " ").trim();
  if (s.length > MAX_QUERY_CHARS) return { error: `Search text can be at most ${MAX_QUERY_CHARS} characters.` };
  const terms = s.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length > MAX_TERMS) return { error: `Please use at most ${MAX_TERMS} words per search box.` };
  return { terms };
}

/** Validates the query string. Returns a friendly message for anything out of range instead of guessing. */
export function parseSearchParams(sp: URLSearchParams): { value: SearchParams } | { error: string } {
  const q = termsOf(sp.get("q"));
  if ("error" in q) return q;
  const l = termsOf(sp.get("location"));
  if ("error" in l) return l;
  const intOf = (name: string, dflt: number) => {
    const raw = sp.get(name);
    if (raw === null || raw === "") return dflt;
    return /^\d{1,6}$/.test(raw) ? Number(raw) : NaN;
  };
  const page = intOf("page", 1);
  const pageSize = intOf("pageSize", DEFAULT_PAGE_SIZE);
  if (!Number.isInteger(page) || page < 1 || page > 100000) return { error: "page must be a whole number of 1 or more." };
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) return { error: `pageSize must be between 1 and ${MAX_PAGE_SIZE}.` };
  return { value: { terms: q.terms, locationTerms: l.terms, page, pageSize } };
}

const likeOf = (term: string) => "%" + term.replace(/[\\%_]/g, (c) => "\\" + c) + "%";

export type ServiceHit = {
  id: string; schoolName: string; state: string | null; district: string | null; pincode: string | null; udiseCode: string | null;
  details: Record<string, string>;
};
export type SearchResult = {
  dataset: { id: string; uploadedAt: string; rowCount: number } | null;
  total: number; page: number; pageSize: number; results: ServiceHit[];
};

export async function searchServices(db: Queryable, p: SearchParams): Promise<SearchResult> {
  const active = await db.query("SELECT id, uploaded_at, row_count FROM service_datasets WHERE status = 'active'");
  const a = active.rows[0];
  if (!a) return { dataset: null, total: 0, page: p.page, pageSize: p.pageSize, results: [] };

  const params: unknown[] = [a.id];
  const where = ["dataset_id = $1"];
  for (const t of p.terms) { params.push(likeOf(t)); where.push(`search_name LIKE $${params.length} ESCAPE '\\'`); }
  for (const t of p.locationTerms) { params.push(likeOf(t)); where.push(`search_loc LIKE $${params.length} ESCAPE '\\'`); }
  const cond = where.join(" AND ");

  const count = await db.query(`SELECT count(*)::int AS n FROM service_dataset_rows WHERE ${cond}`, params);
  const total: number = count.rows[0].n;
  const rows = await db.query(
    `SELECT id, school_name, state, district, pincode, udise_code, data FROM service_dataset_rows WHERE ${cond}
      ORDER BY search_name, id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, p.pageSize, (p.page - 1) * p.pageSize]
  );
  return {
    dataset: { id: String(a.id), uploadedAt: new Date(a.uploaded_at).toISOString(), rowCount: a.row_count },
    total, page: p.page, pageSize: p.pageSize,
    results: rows.rows.map((r) => ({
      id: String(r.id), schoolName: r.school_name, state: r.state, district: r.district, pincode: r.pincode, udiseCode: r.udise_code,
      details: r.data as Record<string, string>,
    })),
  };
}
