import type { Metadata } from "next";
import Link from "next/link";
import { pool } from "../../../lib/db";
import { requireAdminPage } from "../../../lib/adminPage";
import { sectorStatusCounts, type CountKey, type Counts, type SectorCounts } from "../../../lib/sectorCounts";
import { DataTable, Notice, PageHeader } from "../_components/ui";
import { logDbError, type DbProblem } from "../../../lib/dbError";

export const metadata: Metadata = { title: "Sector counts | RoboValley admin", robots: { index: false, follow: false } };

// Column heading, and where a number leads: that sector's list in the Admin Portal, on the matching tab (Submitted and Verified are
// pending items a reviewer has not verified yet / has verified). Drafts are private to their authors, so they have no list; "Total" is
// just the row's sum, and the rows that span sectors (sum, unique) are plain numbers because a list is always one sector's.
const COLUMNS: { key: CountKey; label: string; qs: string | null }[] = [
  { key: "draft", label: "Draft", qs: null },
  { key: "submitted", label: "Submitted", qs: "tab=all&verified=0" },
  { key: "verified", label: "Verified", qs: "tab=all&verified=1" },
  { key: "changesRequested", label: "Changes requested", qs: "tab=changes_requested" },
  { key: "published", label: "Approved / published", qs: "tab=published" },
  { key: "rejected", label: "Rejected", qs: "tab=rejected" },
  { key: "unpublished", label: "Unpublished", qs: "tab=unpublished" },
  { key: "total", label: "Total", qs: null },
];

function cells(c: Counts, slug: string | null, linked: boolean) {
  return COLUMNS.map((col) => {
    const v = c[col.key];
    return (
      <td key={col.key} className="num">
        {linked && slug && col.qs && v > 0 ? <Link href={`/moderation/sector/${slug}?${col.qs}`}>{v.toLocaleString("en-IN")}</Link> : v.toLocaleString("en-IN")}
      </td>
    );
  });
}

// What the page says when the counts cannot be read. "Not set up" is the usual one on a new database: the contribution tables come
// from migrations 012 to 019, and until they are applied every query here fails with "relation does not exist".
const PROBLEM: Record<DbProblem, [string, string]> = {
  not_set_up: ["Contributions are not set up on this database yet", "The contribution tables are missing: migrations 012 to 019 need to be applied (Settings shows which ones). Nothing was changed."],
  unreachable: ["The counts could not be loaded", "The database did not answer. Nothing was changed. Please try again in a moment."],
  error: ["The counts could not be loaded", "Something went wrong while counting. Nothing was changed. Please try again."],
};

// Admin only. Every figure is counted from the database; nothing is estimated.
export default async function SectorCountsPage() {
  const admin = await requireAdminPage();
  if (admin.mustChangePassword) return null;

  let data: SectorCounts;
  try {
    data = await sectorStatusCounts(pool as never);
  } catch (e) {
    const why: DbProblem = logDbError("admin sector counts", e); // the real cause is in the server log; the page says what it means
    const [title, body] = PROBLEM[why];
    return (<><PageHeader title="Contributions by sector" /><Notice kind="error" title={title}>{body}</Notice></>);
  }
  const nothingYet = data.sectors.length > 0 && data.unique.total === 0 && data.withoutSector === 0;

  const rows = [
    ...data.sectors.map((s) => (
      <tr key={s.slug}>
        <th scope="row">{s.name}{s.active ? "" : " (inactive)"}</th>
        {cells(s, s.slug, true)}
      </tr>
    )),
    <tr key="sum" className="adm-total"><th scope="row">Total of the sector rows</th>{cells(data.sum, null, false)}</tr>,
    <tr key="unique" className="adm-total"><th scope="row">Unique contributions</th>{cells(data.unique, null, false)}</tr>,
  ];

  return (
    <>
      <PageHeader title="Contributions by sector" lead="How many contributions each sector holds in each state. Click a number to open that sector's list in the Admin Portal." />
      {nothingYet && (
        <div style={{ marginBottom: 14 }}>
          <Notice kind="info" title="No contributions yet">The counts loaded, and every sector is at 0: nobody has contributed yet. The numbers appear here as soon as members send contributions.</Notice>
        </div>
      )}
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
        “Total of the sector rows” but only 1 to “Unique contributions”. A number in a sector&apos;s row opens that sector&apos;s list in the Admin Portal; the two total rows span sectors, so they are plain numbers.
        “Submitted” has not been verified yet; “Verified” has been checked by a reviewer and waits for an administrator to approve it.
        Drafts are private to their authors and are not listed.
        {data.withoutSector > 0 ? ` ${data.withoutSector} contribution${data.withoutSector === 1 ? " has" : "s have"} no sector yet and ${data.withoutSector === 1 ? "is" : "are"} in no row.` : ""}
        {" "}Removed and demo items are not counted.
      </Notice>
      </div>
    </>
  );
}

