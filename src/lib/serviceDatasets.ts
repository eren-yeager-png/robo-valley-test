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

export const MAX_RADIUS_KM = 50;
export const DEFAULT_RADIUS_KM = 25;
export const NEAR_LIMIT = 50;
const PIN_RE = /^[1-9][0-9]{5}$/;
const COORD_RE = /^-?\d{1,3}(\.\d{1,8})?$/;
const INDIA = { latMin: 6, latMax: 38, lngMin: 67, lngMax: 98 };

/** "Schools near a pin code": `pincode` and/or an explicit centre (`lat`/`lng`, used when the pin code has no stored position). */
export type NearParams = { pincode: string | null; lat: number | null; lng: number | null; radiusKm: number };
export type SearchParams = { terms: string[]; locationTerms: string[]; page: number; pageSize: number; near?: NearParams };

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
  const near = parseNear(sp);
  if (near && "error" in near) return { error: near.error };
  const nearValue = near && "value" in near ? near.value : undefined;
  return { value: { terms: q.terms, locationTerms: l.terms, page, pageSize, ...(nearValue ? { near: nearValue } : {}) } };
}

function parseNear(sp: URLSearchParams): { value: NearParams } | { error: string } | null {
  const pin = sp.get("pincode"), latRaw = sp.get("lat"), lngRaw = sp.get("lng"), radiusRaw = sp.get("radius");
  const given = (v: string | null) => v !== null && v !== "";
  if (!given(pin) && !given(latRaw) && !given(lngRaw)) {
    return given(radiusRaw) ? { error: "radius needs a pincode (or lat and lng)." } : null;
  }
  if (given(pin) && !PIN_RE.test(pin!)) return { error: "pincode must be exactly 6 digits." };
  if (given(latRaw) !== given(lngRaw)) return { error: "lat and lng must be given together." };
  let lat: number | null = null, lng: number | null = null;
  if (given(latRaw)) {
    if (!COORD_RE.test(latRaw!) || !COORD_RE.test(lngRaw!)) return { error: "lat and lng must be numbers." };
    lat = Number(latRaw); lng = Number(lngRaw);
    if (!(lat > INDIA.latMin && lat < INDIA.latMax && lng > INDIA.lngMin && lng < INDIA.lngMax)) return { error: "lat and lng must be inside India." };
  }
  let radiusKm = DEFAULT_RADIUS_KM;
  if (given(radiusRaw)) {
    if (!/^\d{1,3}$/.test(radiusRaw!)) return { error: `radius must be a whole number of km between 1 and ${MAX_RADIUS_KM}.` };
    radiusKm = Number(radiusRaw);
    if (radiusKm < 1 || radiusKm > MAX_RADIUS_KM) return { error: `radius must be a whole number of km between 1 and ${MAX_RADIUS_KM}.` };
  }
  return { value: { pincode: given(pin) ? pin : null, lat, lng, radiusKm } };
}

const likeOf = (term: string) => "%" + term.replace(/[\\%_]/g, (c) => "\\" + c) + "%";

export type ServiceHit = {
  id: string; schoolName: string; state: string | null; district: string | null; pincode: string | null; udiseCode: string | null;
  details: Record<string, string>;
  /** Only in a "near a pin code" search: km from the searched position (0 for the same pin code); lat/lng = centre of the school's pin code. */
  distanceKm?: number; lat?: number | null; lng?: number | null;
};
export type SearchResult = {
  dataset: { id: string; uploadedAt: string; rowCount: number } | null;
  total: number; page: number; pageSize: number; results: ServiceHit[];
  /** Only in a "near" search. center is null when the pin code has no stored position (the caller may look it up and ask again with lat/lng). */
  near?: { center: { lat: number; lng: number } | null; pincodeKnown: boolean; radiusKm: number; limit: number };
};

export async function searchServices(db: Queryable, p: SearchParams): Promise<SearchResult> {
  const active = await db.query("SELECT id, uploaded_at, row_count FROM service_datasets WHERE status = 'active'");
  const a = active.rows[0];
  if (!a) return { dataset: null, total: 0, page: p.page, pageSize: p.pageSize, results: [] };

  if (p.near) return searchNear(db, a, p.near);

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

const KM_PER_DEG = 111.195;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function searchNear(db: Queryable, a: any, n: NearParams): Promise<SearchResult> {
  let centre: { lat: number; lng: number } | null = null;
  let pincodeKnown = false;
  if (n.pincode) {
    const loc = await db.query("SELECT lat, lng FROM pincode_locations WHERE pincode = $1", [n.pincode]);
    pincodeKnown = loc.rows.length > 0;
    if (loc.rows[0]?.lat != null) centre = { lat: Number(loc.rows[0].lat), lng: Number(loc.rows[0].lng) };
  }
  if (!centre && n.lat !== null && n.lng !== null) centre = { lat: n.lat, lng: n.lng };

  // $1 dataset, $2 pin code (or NULL), $3 radius; with a centre: $4 lat, $5 lng, $6/$7 latitude/longitude half-spans of the bounding box.
  const params: unknown[] = [a.id, n.pincode, n.radiusKm];
  let dist = "0::float8", within = "FALSE";
  if (centre) {
    const dLat = n.radiusKm / KM_PER_DEG;
    const dLng = n.radiusKm / (KM_PER_DEG * Math.max(0.01, Math.cos((centre.lat * Math.PI) / 180)));
    params.push(centre.lat, centre.lng, dLat, dLng);
    dist = `2 * 6371.0088 * asin(least(1, sqrt(power(sin(radians(pl.lat - $4::float8) / 2), 2)
              + cos(radians($4::float8)) * cos(radians(pl.lat)) * power(sin(radians(pl.lng - $5::float8) / 2), 2))))`;
    within = "(pl.lat BETWEEN $4::float8 - $6::float8 AND $4::float8 + $6::float8 AND pl.lng BETWEEN $5::float8 - $7::float8 AND $5::float8 + $7::float8)";
  }
  const base = `
    SELECT r.id, r.school_name, r.state, r.district, r.pincode, r.udise_code, r.data, pl.lat, pl.lng,
           CASE WHEN r.pincode = $2::text THEN 0::float8 WHEN ${within} AND pl.lat IS NOT NULL THEN ${dist} ELSE NULL END AS d
      FROM service_dataset_rows r LEFT JOIN pincode_locations pl ON pl.pincode = r.pincode
     WHERE r.dataset_id = $1`;
  const sel = `WITH c AS (${base}) SELECT * FROM c WHERE d IS NOT NULL AND d <= $3::float8`;

  const count = await db.query(`WITH c AS (${base}) SELECT count(*)::int AS n FROM c WHERE d IS NOT NULL AND d <= $3::float8`, params);
  const rows = await db.query(`${sel} ORDER BY d, school_name, id LIMIT ${NEAR_LIMIT}`, params);
  return {
    dataset: { id: String(a.id), uploadedAt: new Date(a.uploaded_at).toISOString(), rowCount: a.row_count },
    total: count.rows[0].n, page: 1, pageSize: NEAR_LIMIT,
    near: { center: centre, pincodeKnown, radiusKm: n.radiusKm, limit: NEAR_LIMIT },
    results: rows.rows.map((r) => ({
      id: String(r.id), schoolName: r.school_name, state: r.state, district: r.district, pincode: r.pincode, udiseCode: r.udise_code,
      details: r.data as Record<string, string>,
      distanceKm: Math.round(Number(r.d) * 10) / 10, lat: r.lat == null ? null : Number(r.lat), lng: r.lng == null ? null : Number(r.lng),
    })),
  };
}
