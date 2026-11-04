import type { Metadata } from "next";
import Link from "next/link";
import { pool } from "../../../lib/db";
import { requireAdminPage } from "../../../lib/adminPage";
import { datasetsByCategory, getOverview, loginsByDay, parseRange, RANGES, registrationsByDay, uploadsByDay } from "../../../lib/adminStats";
import ChangePasswordForm from "./ChangePasswordForm";
import Chart from "../_components/ChartsLoader";
import { DataTable, Notice, PageHeader, SetupNotice, StatCard, when } from "../_components/ui";

export const metadata: Metadata = { title: "Admin overview | RoboValley", robots: { index: false, follow: false } };

const TEAL = "#17694f", AMBER = "#e8a33a", NAVY = "#2a6fb0", RED = "#b8532a"; // the landing page's brand green, blue, amber and rust
const LOGIN_LABEL: Record<string, string> = { login_success: "Signed in", login_failed: "Failed sign-in" };

// Server-side guard: anonymous -> sign in, signed-in non-admin -> their normal page. Nothing admin is rendered for them.
export default async function AdminDashboardPage({ searchParams }: { searchParams?: Promise<{ range?: string }> } = {}) {
  const admin = await requireAdminPage();
  if (admin.mustChangePassword) return <ChangePasswordForm />;

  const days = parseRange((await searchParams)?.range);
  let data;
  try {
    const [overview, perCategory, registrations, uploads] = await Promise.all([getOverview(pool), datasetsByCategory(pool), registrationsByDay(pool, days), uploadsByDay(pool, days)]);
    const logins = overview.setup.loginEvents ? await loginsByDay(pool, days) : null;
    data = { overview, perCategory, registrations, uploads, logins };
  } catch {
    console.error("admin overview: could not read the data");
    return (<><PageHeader title="Admin dashboard" /><Notice kind="error" title="The overview could not be loaded">The database did not answer. Nothing was changed. Please try again in a moment.</Notice></>);
  }
  const { overview: o, perCategory, registrations, uploads, logins } = data;

  return (
    <>
      <PageHeader title="Admin dashboard" lead="A live summary of RoboValley, counted from the database." />
      <div className="adm-grid">
        <StatCard label="Registered users" value={o.users} hint="Excludes administrators" />
        <StatCard label="Categories" value={o.categories} hint={`${o.activeCategories} with live data`} />
        <StatCard label="Datasets" value={o.datasets} hint="Live and earlier versions" />
        <StatCard label="Uploaded files" value={o.uploads} hint="Accepted uploads" />
      </div>

      <div className="adm-tabs" aria-label="Chart period">
        {RANGES.map((r) => <Link key={r} href={`/admin/dashboard?range=${r}`} aria-current={r === days ? "page" : undefined}>Last {r} days</Link>)}
      </div>

      <div className="adm-grid two">
        <section className="adm-card"><h3>New registrations</h3>
          <Chart kind="line" xKey="day" label={`New registrations per day, last ${days} days`} data={registrations} series={[{ key: "registrations", label: "Registrations", color: TEAL }]} />
        </section>
        <section className="adm-card"><h3>Sign-in activity</h3>
          {logins ? <Chart kind="line" xKey="day" label={`Sign-ins per day, last ${days} days`} data={logins} series={[{ key: "success", label: "Successful", color: TEAL }, { key: "failed", label: "Failed", color: RED }]} />
            : <SetupNotice what="Sign-in activity" migration="008" />}
        </section>
        <section className="adm-card"><h3>Uploads</h3>
          <Chart kind="bar" xKey="day" label={`Uploads per day, last ${days} days`} data={uploads} series={[{ key: "accepted", label: "Accepted", color: NAVY }, { key: "rejected", label: "Rejected", color: AMBER }]} />
        </section>
        <section className="adm-card"><h3>Datasets by category</h3>
          <Chart kind="bar" angled xKey="name" label="Number of datasets in each category" data={perCategory.map((c) => ({ name: c.name, datasets: c.datasets }))} series={[{ key: "datasets", label: "Datasets", color: TEAL }]} />
        </section>
      </div>

      <div className="adm-grid two">
        <section><h3>Recent sign-ins</h3>
          {!o.setup.loginEvents ? <SetupNotice what="Sign-in activity" migration="008" /> : (
            <DataTable caption="Recent sign-ins" head={["When", "Event"]} empty="No sign-ins recorded yet."
              rows={o.recentLogins.map((l, i) => <tr key={i}><td>{when(l.at)}</td><td><span className={"adm-pill" + (l.type === "login_failed" ? " bad" : "")}>{LOGIN_LABEL[l.type] ?? l.type}</span></td></tr>)} />
          )}
        </section>
        <section><h3>Recent uploads</h3>
          <DataTable caption="Recent uploads" head={["When", "File", "Result"]} empty="Nothing has been uploaded yet."
            rows={o.recentUploads.map((u, i) => <tr key={i}><td>{when(u.at)}</td><td className="cell-wrap">{u.filename ?? "—"}</td><td><span className={"adm-pill" + (u.result === "success" ? "" : " warn")}>{u.result === "success" ? "Accepted" : "Rejected"}</span></td></tr>)} />
        </section>
      </div>
    </>
  );
}
