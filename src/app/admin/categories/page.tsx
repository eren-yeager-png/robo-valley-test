import type { Metadata } from "next";
import Link from "next/link";
import { pool } from "../../../lib/db";
import { requireAdminPage } from "../../../lib/adminPage";
import { categoryRows } from "../../../lib/adminDatasets";
import { DataTable, Notice, PageHeader, when } from "../_components/ui";

export const metadata: Metadata = { title: "Categories | RoboValley admin", robots: { index: false, follow: false } };

// The six Find a Service categories are fixed in code and in the database; this page shows them, it cannot add or rename any.
export default async function CategoriesPage() {
  const admin = await requireAdminPage();
  if (admin.mustChangePassword) return null;
  let rows;
  try {
    rows = await categoryRows(pool);
  } catch {
    console.error("admin categories: could not read the data");
    return (<><PageHeader title="Manage categories" /><Notice kind="error" title="Categories could not be loaded">The database did not answer. Please try again.</Notice></>);
  }
  return (
    <>
      <PageHeader title="Manage categories" lead="Each category has its own data. Exactly one dataset is live per category." />
      <DataTable caption="Categories and their live datasets" head={["Category", "Live dataset", "Rows", "Live since", "Datasets", "Actions"]}
        rows={rows.map((c) => (
          <tr key={c.slug}>
            <td><strong>{c.name}</strong></td>
            <td className="wrap">{c.active ? <><span className="adm-pill">Live</span> {c.active.filename}</> : <span className="adm-pill mute">No live data</span>}</td>
            <td>{c.active ? c.active.rows.toLocaleString("en-IN") : "—"}</td>
            <td>{when(c.active?.activatedAt ?? null)}</td>
            <td>{c.datasets}{c.staged > 0 && <span className="adm-pill warn"> {c.staged} awaiting confirmation</span>}</td>
            <td><Link href={`/admin/datasets?category=${c.slug}`}>View datasets</Link> · <Link href={`/admin/upload?category=${c.slug}`}>Upload</Link></td>
          </tr>
        ))} />
    </>
  );
}
