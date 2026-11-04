import type { Metadata } from "next";
import Link from "next/link";
import { pool } from "../../../lib/db";
import { requireAdminPage } from "../../../lib/adminPage";
import { datasetsByCategory, loginsByDay, otpByDay, parseRange, RANGES, registrationsByDay, sumOf, tableExists, uploadsByDay, usersByRole } from "../../../lib/adminStats";
import Chart from "../_components/ChartsLoader";
import { DataTable, Notice, PageHeader, SetupNotice, StatCard } from "../_components/ui";

export const metadata: Metadata = { title: "Reports | RoboValley admin", robots: { index: false, follow: false } };

const TEAL = "#17694f", AMBER = "#e8a33a", NAVY = "#2a6fb0", RED = "#b8532a"; // the landing page's brand green, blue, amber and rust

// Every figure is counted from the database for the chosen period. Nothing is estimated or filled in.
export default async function ReportsPage({ searchParams }: { searchParams?: Promise<{ range?: string }> } = {}) {
  const admin = await requireAdminPage();
  if (admin.mustChangePassword) return null;
  const days = parseRange((await searchParams)?.range);

  let d;
  try {
    const hasEvents = await tableExists(pool, "login_events");
    const [registrations, uploads, perCategory, roles] = await Promise.all([registrationsByDay(pool, days), uploadsByDay(pool, days), datasetsByCategory(pool), usersByRole(pool)]);
    const [logins, otp] = hasEvents ? await Promise.all([loginsByDay(pool, days), otpByDay(pool, days)]) : [null, null];
    d = { registrations, uploads, perCategory, roles, logins, otp };
  } catch {
    console.error("admin reports: could not read the data");
    return (<><PageHeader title="Reports & analytics" /><Notice kind="error" title="Reports could not be loaded">The database did not answer. Please try again.</Notice></>);
  }
  const { registrations, uploads, perCategory, roles, logins, otp } = d;

  return (
    <>
      <PageHeader title="Reports & analytics" lead={`Figures for the last ${days} days, counted from the database.`} />
      <div className="adm-tabs" aria-label="Report period">
        {RANGES.map((r) => <Link key={r} href={`/admin/reports?range=${r}`} aria-current={r === days ? "page" : undefined}>Last {r} days</Link>)}
      </div>

      <div className="adm-grid">
        <StatCard label="New registrations" value={sumOf(registrations, "registrations")} />
        <StatCard label="Successful logins" value={logins ? sumOf(logins, "success") : null} hint={logins ? undefined : "Needs migration 008"} />
        <StatCard label="Failed logins" value={logins ? sumOf(logins, "failed") : null} hint={logins ? undefined : "Needs migration 008"} />
        <StatCard label="Uploads accepted" value={sumOf(uploads, "accepted")} hint={`${sumOf(uploads, "rejected")} rejected`} />
      </div>

      <div className="adm-grid two">
        <section className="adm-card"><h3>User registrations</h3>
          <Chart kind="line" xKey="day" label={`New registrations per day, last ${days} days`} data={registrations} series={[{ key: "registrations", label: "Registrations", color: TEAL }]} />
        </section>
        <section className="adm-card"><h3>Login activity</h3>
          {logins ? <Chart kind="line" xKey="day" label={`Logins per day, last ${days} days`} data={logins} series={[{ key: "success", label: "Successful", color: TEAL }, { key: "failed", label: "Failed", color: RED }]} /> : <SetupNotice what="Login reports" migration="008" />}
        </section>
        <section className="adm-card"><h3>One-time codes</h3>
          {otp ? <Chart kind="bar" xKey="day" label={`One-time codes per day, last ${days} days`} data={otp} series={[{ key: "sent", label: "Sent", color: NAVY }, { key: "verified", label: "Verified", color: TEAL }, { key: "failed", label: "Failed", color: RED }]} /> : <SetupNotice what="One-time code reports" migration="008" />}
        </section>
        <section className="adm-card"><h3>Upload activity</h3>
          <Chart kind="bar" xKey="day" label={`Uploads per day, last ${days} days`} data={uploads} series={[{ key: "accepted", label: "Accepted", color: NAVY }, { key: "rejected", label: "Rejected", color: AMBER }]} />
        </section>
        <section className="adm-card"><h3>Accounts by role (all time)</h3>
          <Chart kind="bar" angled xKey="label" label="Number of accounts for each role" data={roles.map((r) => ({ label: r.label, accounts: r.count }))} series={[{ key: "accounts", label: "Accounts", color: TEAL }]} />
        </section>
        <section className="adm-card"><h3>Datasets by category</h3>
          <Chart kind="bar" angled xKey="name" label="Number of datasets in each category" data={perCategory.map((c) => ({ name: c.name, datasets: c.datasets }))} series={[{ key: "datasets", label: "Datasets", color: TEAL }]} />
        </section>
      </div>

      <h3>Live data by category</h3>
      <DataTable caption="Live data by category" head={["Category", "Datasets kept", "Live rows", "Status"]}
        rows={perCategory.map((c) => <tr key={c.slug}><td>{c.name}</td><td>{c.datasets}</td><td>{c.rows.toLocaleString("en-IN")}</td><td><span className={"adm-pill" + (c.active ? "" : " mute")}>{c.active ? "Live" : "No live data"}</span></td></tr>)} />
    </>
  );
}
