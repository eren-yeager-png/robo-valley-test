import type { Metadata } from "next";
import Link from "next/link";
import { pool } from "../../../lib/db";
import { requireAdminPage } from "../../../lib/adminPage";
import { listSectorForms, type SectorFormRow } from "../../../lib/sectorForms";
import { logDbError } from "../../../lib/dbError";
import { DataTable, Notice, PageHeader } from "../_components/ui";

export const metadata: Metadata = { title: "Sector forms | RoboValley admin", robots: { index: false, follow: false } };

const robotsText = (s: SectorFormRow) => (s.robots === 0 ? "None yet" : `${s.activeRobots} on${s.robots > s.activeRobots ? ` · ${s.robots - s.activeRobots} off` : ""}`);

// Admin only (P2). Every sector that can have a Contribute form, and how many robot types it has. Demo sectors are left out.
export default async function SectorFormsPage() {
  const admin = await requireAdminPage();
  if (admin.mustChangePassword) return null;

  let data: { sectors: SectorFormRow[]; robotsReady: boolean };
  try {
    data = await listSectorForms(pool as never);
  } catch (e) {
    const why = logDbError("admin sector forms", e);
    return (
      <>
        <PageHeader title="Sector forms" />
        {why === "not_set_up"
          ? <Notice kind="setup" title="Sectors are not set up on this database yet">The sector tables are missing (migration 012). Settings shows which migrations this database has. Nothing was changed.</Notice>
          : <Notice kind="error" title="Sector forms could not be loaded">{why === "unreachable" ? "The database did not answer." : "Something went wrong."} Nothing was changed. Please try again.</Notice>}
      </>
    );
  }

  return (
    <>
      <PageHeader title="Sector forms" lead="What the Contribute form asks for in each sector. Start with the robot types: use the same names as the robot cards on the sector's page." />
      {!data.robotsReady && (
        <div style={{ marginBottom: 14 }}>
          <Notice kind="setup" title="Robot types are not set up on this database yet">Migration 024 is needed before robot types can be added. Settings shows which migrations this database has. The sectors below are read-only until then.</Notice>
        </div>
      )}
      <DataTable
        caption="Sectors and their robot types"
        head={["Sector", "On the Contribute form", "Robot types", ""]}
        empty="There are no sectors yet."
        rows={data.sectors.map((s) => (
          <tr key={s.slug}>
            <th scope="row"><Link href={`/admin/sector-forms/${s.slug}`}>{s.name}</Link></th>
            <td>{s.active ? <span className="adm-pill">Offered</span> : <span className="adm-pill mute">Not offered</span>}</td>
            <td>{data.robotsReady ? robotsText(s) : "—"}</td>
            <td><Link className="btn" href={`/admin/sector-forms/${s.slug}`} aria-label={`Open the form for ${s.name}`}>Open</Link></td>
          </tr>
        ))}
      />
    </>
  );
}
