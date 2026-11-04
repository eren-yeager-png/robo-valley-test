import type { Metadata } from "next";
import Link from "next/link";
import { pool } from "../../../lib/db";
import { requireAdminPage } from "../../../lib/adminPage";
import { DATASET_STATUSES, listDatasets } from "../../../lib/adminDatasets";
import { CATEGORIES, parseCategory } from "../../../lib/serviceCategories";
import ActivateButton from "../_components/ActivateButton";
import { DataTable, Notice, PageHeader, Pager, when } from "../_components/ui";

export const metadata: Metadata = { title: "Datasets | RoboValley admin", robots: { index: false, follow: false } };

type SP = { category?: string; status?: string; page?: string };
const STATUS_LABEL: Record<string, string> = { active: "Live", staged: "Awaiting confirmation", superseded: "Replaced" };

export default async function DatasetsPage({ searchParams }: { searchParams?: Promise<SP> } = {}) {
  const admin = await requireAdminPage();
  if (admin.mustChangePassword) return null;
  const sp = (await searchParams) ?? {};
  const category = parseCategory(sp.category) ?? "";
  const status = (DATASET_STATUSES as readonly string[]).includes(sp.status ?? "") && sp.status !== "discarded" ? sp.status! : "";
  const page = /^\d{1,6}$/.test(sp.page ?? "") ? Number(sp.page) : 1;

  let result;
  try {
    result = await listDatasets(pool, { category, status, page });
  } catch {
    console.error("admin datasets: could not read the data");
    return (<><PageHeader title="Manage datasets" /><Notice kind="error" title="Datasets could not be loaded">The database did not answer. Please try again.</Notice></>);
  }
  const link = (c: string) => (c ? `/admin/datasets?category=${c}${status ? `&status=${status}` : ""}` : `/admin/datasets${status ? `?status=${status}` : ""}`);
  const params: Record<string, string> = {};
  if (category) params.category = category;
  if (status) params.status = status;

  return (
    <>
      <PageHeader title="Manage datasets" lead="Every uploaded version, per category. The live one is what visitors search." />
      <div className="adm-tabs" aria-label="Category">
        <Link href={link("")} aria-current={category === "" ? "page" : undefined}>All categories</Link>
        {CATEGORIES.map((c) => <Link key={c.slug} href={link(c.slug)} aria-current={category === c.slug ? "page" : undefined}>{c.name}</Link>)}
      </div>
      <div className="adm-tabs" aria-label="Status">
        <Link href={category ? `/admin/datasets?category=${category}` : "/admin/datasets"} aria-current={status === "" ? "page" : undefined}>Any status</Link>
        {DATASET_STATUSES.filter((s) => s !== "discarded").map((s) => (
          <Link key={s} href={`/admin/datasets?${new URLSearchParams({ ...(category ? { category } : {}), status: s })}`} aria-current={status === s ? "page" : undefined}>{STATUS_LABEL[s]}</Link>
        ))}
      </div>
      <DataTable caption="Datasets" head={["Category", "File", "Rows", "Status", "Uploaded", "By", ""]} empty="No datasets here yet. Use Upload Files to add one."
        rows={result.rows.map((d) => (
          <tr key={d.id}>
            <td>{d.categoryName}</td>
            <td className="wrap">{d.filename}</td>
            <td>{d.rows.toLocaleString("en-IN")}{d.invalidRows > 0 && <div className="adm-pill warn">{d.invalidRows} skipped</div>}</td>
            <td><span className={"adm-pill" + (d.status === "active" ? "" : d.status === "staged" ? " warn" : " mute")}>{STATUS_LABEL[d.status] ?? d.status}</span></td>
            <td>{when(d.uploadedAt)}</td>
            <td className="wrap">{d.uploader ?? "—"}</td>
            <td>{d.canActivate ? <ActivateButton datasetId={d.id} label={d.filename} /> : d.status === "staged" ? <span className="adm-pill bad">Expired</span> : null}</td>
          </tr>
        ))} />
      <Pager base="/admin/datasets" page={result.page} pages={result.pages} params={params} />
    </>
  );
}
