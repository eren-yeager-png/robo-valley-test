import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pool } from "../../../../lib/db";
import { requireAdminPage } from "../../../../lib/adminPage";
import { parseSectorSlug, sectorForm, type SectorForm } from "../../../../lib/sectorForms";
import { logDbError } from "../../../../lib/dbError";
import { Notice, PageHeader } from "../../_components/ui";
import RobotTypesEditor from "./RobotTypesEditor";

export const metadata: Metadata = { title: "Sector form | RoboValley admin", robots: { index: false, follow: false } };

// Admin only (P2). One sector's form, part 1: its robot types. Add, rename, reorder, switch off/on; never delete.
export default async function SectorFormPage({ params }: { params?: Promise<{ slug?: string }> } = {}) {
  const admin = await requireAdminPage();
  if (admin.mustChangePassword) return null;
  const slug = parseSectorSlug((await params)?.slug);
  if (!slug) notFound();

  let form: SectorForm | null;
  try {
    form = await sectorForm(pool as never, slug);
  } catch (e) {
    const why = logDbError("admin sector form", e);
    return (
      <>
        <p><Link href="/admin/sector-forms">← Sector forms</Link></p>
        <PageHeader title="Sector form" />
        {why === "not_set_up"
          ? <Notice kind="setup" title="Sectors are not set up on this database yet">The sector tables are missing (migration 012). Settings shows which migrations this database has. Nothing was changed.</Notice>
          : <Notice kind="error" title="This form could not be loaded">{why === "unreachable" ? "The database did not answer." : "Something went wrong."} Nothing was changed. Please try again.</Notice>}
      </>
    );
  }
  if (!form) notFound();
  const active = form.robots.filter((r) => r.active);

  return (
    <>
      <p><Link href="/admin/sector-forms">← Sector forms</Link></p>
      <PageHeader title={`Sector form: ${form.sector.name}`} lead="Robot types members can pick for this sector. Use the same names as the robot cards on the sector's page on techytree.in." />
      {!form.sector.active && (
        <div style={{ marginBottom: 14 }}>
          <Notice kind="info" title="This sector is not offered on the Contribute form right now">You can still prepare its robot types; they are used once the sector is offered.</Notice>
        </div>
      )}
      {!form.robotsReady ? (
        <Notice kind="setup" title="Robot types are not set up on this database yet">Migration 024 is needed before robot types can be added. Settings shows which migrations this database has.</Notice>
      ) : (
        <>
          <section aria-labelledby="robots-h">
            <h2 id="robots-h" style={{ fontSize: "1.15rem", margin: "0 0 6px" }}>Robot types</h2>
            <p className="muted" style={{ margin: "0 0 12px" }}>Robot types are never deleted. Switch one off to hide it from the form: contributions that already chose it keep showing it. The link code stays the same when you rename one.</p>
            <RobotTypesEditor sector={form.sector.slug} sectorName={form.sector.name} robots={form.robots} />
          </section>
          <section aria-labelledby="preview-h" style={{ marginTop: 22 }}>
            <h2 id="preview-h" style={{ fontSize: "1.15rem", margin: "0 0 6px" }}>What members will pick from</h2>
            <p className="muted" style={{ margin: "0 0 8px" }}>Only robot types that are on, in this order. The question is optional and starts at &quot;Not sure&quot;.</p>
            <div className="adm-filters">
              <label>Which robot is it about? (optional)
                <select disabled defaultValue="" aria-label={`Preview of the robot question for ${form.sector.name}`}>
                  <option value="">Not sure</option>
                  {active.map((r) => <option key={r.id} value={r.slug}>{r.name}</option>)}
                </select>
              </label>
            </div>
            {active.length === 0 && <p className="muted" style={{ margin: 0 }}>No robot type is on yet, so members would only see &quot;Not sure&quot;.</p>}
          </section>
        </>
      )}
    </>
  );
}
