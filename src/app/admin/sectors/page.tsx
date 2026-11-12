import type { Metadata } from "next";
import Link from "next/link";
import { pool } from "../../../lib/db";
import { requireAdminPage } from "../../../lib/adminPage";
import { sectorStatusCounts, type CountKey, type Counts, type SectorCounts } from "../../../lib/sectorCounts";
import { DataTable, Notice, PageHeader } from "../_components/ui";

export const metadata: Metadata = { title: "Sector counts | RoboValley admin", robots: { index: false, follow: false } };

// Column heading, and where a number leads: the moderation list for that status (and sector). Drafts are private to their authors, so
// they have no list; "Total" is just the row's sum.
const COLUMNS: { key: CountKey; label: string; qs: string | null }[] = [
  { key: "draft", label: "Draft", qs: null },
  { key: "submitted", label: "Submitted", qs: "status=pending_review&verified=0" },
  { key: "verified", label: "Verified", qs: "status=pending_review&verified=1" },
  { key: "changesRequested", label: "Changes requested", qs: "status=changes_requested" },
  { key: "published", label: "Approved / published", qs: "status=published" },
  { key: "rejected", label: "Rejected", qs: "status=rejected" },
  { key: "unpublished", label: "Unpublished", qs: "status=unpublished" },
  { key: "total", label: "Total", qs: null },
];

function cells(c: Counts, slug: string | null, linked: boolean) {
  return COLUMNS.map((col) => {
    const v = c[col.key];
    return (
      <td key={col.key} className="num">
        {linked && col.qs && v > 0 ? <Link href={`/moderation?${col.qs}${slug ? `&sector=${slug}` : ""}`}>{v.toLocaleString("en-IN")}</Link> : v.toLocaleString("en-IN")}
      </td>
    );
  });
}

// Admin only. Every figure is counted from the database; nothing is estimated.
export default async function SectorCountsPage() {
  const admin = await requireAdminPage();
  if (admin.mustChangePassword) return null;

  let data: SectorCounts;
  try {
    data = await sectorStatusCounts(pool as never);
  } catch {
    console.error("admin sector counts: could not read the data");
    return (<><PageHeader title="Contributions by sector" /><Notice kind="error" title="The counts could not be loaded">The database did not answer. Please try again.</Notice></>);
  }

  const rows = [
    ...data.sectors.map((s) => (
      <tr key={s.slug}>
        <th scope="row">{s.name}{s.active ? "" : " (inactive)"}</th>
        {cells(s, s.slug, true)}
      </tr>
    )),
    <tr key="sum" className="adm-total"><th scope="row">Total of the sector rows</th>{cells(data.sum, null, false)}</tr>,
    <tr key="unique" className="adm-total"><th scope="row">Unique contributions</th>{cells(data.unique, null, true)}</tr>,
  ];

  return (
    <>
      <PageHeader title="Contributions by sector" lead="How many contributions each sector holds in each state. Click a number to open that list in Moderation." />
      <div className="adm-counts">
      <DataTable
        caption="Contributions per sector by status"
        head={["Sector", ...COLUMNS.map((c) => c.label)]}
        rows={rows}
        empty="There are no sectors yet."
      />
      </div>
      <div style={{ marginTop: 14 }}>
      <Notice kind="info" title="How to read the totals">
        A contribution can belong to several sectors, and it is counted once in each of them. So a contribution in two sectors adds 2 to
        “Total of the sector rows” but only 1 to “Unique contributions”. The numbers in the Unique row open the same lists as the Moderation page&apos;s own tabs.
        “Submitted” has not been verified yet; “Verified” has been checked by a reviewer and waits for an administrator to approve it.
        Drafts are private to their authors and are not listed.
        {data.withoutSector > 0 ? ` ${data.withoutSector} contribution${data.withoutSector === 1 ? " has" : "s have"} no sector yet and ${data.withoutSector === 1 ? "is" : "are"} in no row.` : ""}
        {" "}Removed and demo items are not counted.
      </Notice>
      </div>
    </>
  );
}

