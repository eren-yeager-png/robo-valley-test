// Read-only views of the category-specific datasets for the admin pages. There is ONE live dataset PER category
// (enforced by a unique index in the database); nothing here changes that or writes anything.
import { CATEGORIES } from "./serviceCategories";
import { STAGING_TTL_HOURS } from "./serviceDatasets";
import type { Db } from "./adminStats";

export const DATASET_STATUSES = ["active", "staged", "superseded", "discarded"] as const;
export const DATASETS_PAGE_SIZE = 20;

export type CategoryRow = {
  slug: string; name: string;
  datasets: number; staged: number;
  active: { id: string; filename: string; rows: number; invalidRows: number; uploadedAt: string; activatedAt: string | null } | null;
};

/** All six categories in their fixed order, each with its currently live dataset (if any). */
export async function categoryRows(db: Db): Promise<CategoryRow[]> {
  const { rows } = await db.query(
    `SELECT category, id, original_filename, row_count, invalid_row_count, uploaded_at, activated_at, status
       FROM service_datasets WHERE status IN ('active', 'staged', 'superseded')`);
  return CATEGORIES.map((c) => {
    const mine = rows.filter((r) => r.category === c.slug);
    const live = mine.find((r) => r.status === "active");
    return {
      slug: c.slug, name: c.name,
      datasets: mine.filter((r) => r.status !== "staged").length,
      staged: mine.filter((r) => r.status === "staged").length,
      active: live ? {
        id: String(live.id), filename: live.original_filename, rows: Number(live.row_count), invalidRows: Number(live.invalid_row_count),
        uploadedAt: new Date(live.uploaded_at).toISOString(), activatedAt: live.activated_at ? new Date(live.activated_at).toISOString() : null,
      } : null,
    };
  });
}

export type DatasetRow = {
  id: string; category: string; categoryName: string; filename: string; rows: number; invalidRows: number;
  status: string; uploadedAt: string; activatedAt: string | null; uploader: string | null; canActivate: boolean;
};

export async function listDatasets(db: Db, opts: { category?: string; status?: string; page: number }): Promise<{ rows: DatasetRow[]; total: number; page: number; pages: number }> {
  const where: string[] = ["d.status <> 'discarded'"];
  const params: unknown[] = [];
  if (opts.category) { params.push(opts.category); where.push(`d.category = $${params.length}`); }
  if (opts.status) { params.push(opts.status); where.push(`d.status = $${params.length}`); }
  const w = "WHERE " + where.join(" AND ");
  const total = Number((await db.query(`SELECT count(*)::int AS n FROM service_datasets d ${w}`, params)).rows[0].n);
  const pages = Math.max(1, Math.ceil(total / DATASETS_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(opts.page) || 1), pages);
  params.push(String(STAGING_TTL_HOURS));
  const r = await db.query(
    `SELECT d.id, d.category, d.original_filename, d.row_count, d.invalid_row_count, d.status, d.uploaded_at, d.activated_at, u.email AS uploader,
            (d.status = 'staged' AND d.uploaded_at >= now() - ($${params.length} || ' hours')::interval) AS can_activate
       FROM service_datasets d LEFT JOIN users u ON u.id = d.uploaded_by ${w}
      ORDER BY d.uploaded_at DESC, d.id DESC LIMIT ${DATASETS_PAGE_SIZE} OFFSET ${(page - 1) * DATASETS_PAGE_SIZE}`, params);
  const name = new Map<string, string>(CATEGORIES.map((c) => [c.slug, c.name]));
  return {
    total, page, pages,
    rows: r.rows.map((x) => ({
      id: String(x.id), category: x.category, categoryName: name.get(x.category) ?? x.category, filename: x.original_filename,
      rows: Number(x.row_count), invalidRows: Number(x.invalid_row_count), status: x.status,
      uploadedAt: new Date(x.uploaded_at).toISOString(), activatedAt: x.activated_at ? new Date(x.activated_at).toISOString() : null,
      uploader: x.uploader, canActivate: x.can_activate === true,
    })),
  };
}
