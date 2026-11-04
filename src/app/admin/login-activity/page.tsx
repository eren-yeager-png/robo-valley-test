import type { Metadata } from "next";
import Link from "next/link";
import { pool } from "../../../lib/db";
import { requireAdminPage } from "../../../lib/adminPage";
import { parseRange, RANGES, tableExists } from "../../../lib/adminStats";
import { EVENT_TYPES, RETENTION_DAYS } from "../../../lib/loginEvents";
import { EVENT_LABEL, eventCounts, listActivity, REASON_LABEL } from "../../../lib/loginActivity";
import { DataTable, Notice, PageHeader, Pager, SetupNotice, StatCard, when } from "../_components/ui";

export const metadata: Metadata = { title: "Login activity | RoboValley admin", robots: { index: false, follow: false } };

type SP = { range?: string; type?: string; page?: string };
const BAD = new Set(["login_failed", "otp_failed"]);

// Shows what happened and when. It never contains passwords, OTP codes, IP addresses or typed-in email addresses.
export default async function LoginActivityPage({ searchParams }: { searchParams?: Promise<SP> } = {}) {
  const admin = await requireAdminPage();
  if (admin.mustChangePassword) return null;
  const sp = (await searchParams) ?? {};
  const days = parseRange(sp.range);
  const type = (EVENT_TYPES as readonly string[]).includes(sp.type ?? "") ? sp.type! : "";
  const page = /^\d{1,6}$/.test(sp.page ?? "") ? Number(sp.page) : 1;

  let ready, counts, list;
  try {
    ready = await tableExists(pool, "login_events");
    if (ready) [counts, list] = await Promise.all([eventCounts(pool, days), listActivity(pool, { days, type, page })]);
  } catch {
    console.error("admin login activity: could not read the data");
    return (<><PageHeader title="Login activity" /><Notice kind="error" title="Activity could not be loaded">The database did not answer. Please try again.</Notice></>);
  }
  if (!ready || !counts || !list) {
    return (<><PageHeader title="Login activity" lead="Sign-ins, one-time codes, signups and sign-outs." /><SetupNotice what="Login activity" migration="008" /></>);
  }
  const href = (r: number, t: string) => `/admin/login-activity?${new URLSearchParams({ range: String(r), ...(t ? { type: t } : {}) })}`;
  const params: Record<string, string> = { range: String(days) };
  if (type) params.type = type;

  return (
    <>
      <PageHeader title="Login activity" lead={`Last ${days} days. Events are kept for ${RETENTION_DAYS} days. No passwords, codes or IP addresses are recorded.`} />
      <div className="adm-tabs" aria-label="Period">
        {RANGES.map((r) => <Link key={r} href={href(r, type)} aria-current={r === days ? "page" : undefined}>Last {r} days</Link>)}
      </div>
      <div className="adm-grid">
        {EVENT_TYPES.map((t) => <StatCard key={t} label={EVENT_LABEL[t]} value={counts[t]} />)}
      </div>
      <div className="adm-tabs" aria-label="Event type">
        <Link href={href(days, "")} aria-current={type === "" ? "page" : undefined}>All events</Link>
        {EVENT_TYPES.map((t) => <Link key={t} href={href(days, t)} aria-current={type === t ? "page" : undefined}>{EVENT_LABEL[t]}</Link>)}
      </div>
      <DataTable caption="Login activity" head={["When", "Event", "Details", "Account", "Browser"]} empty="No activity in this period."
        rows={list.rows.map((e) => (
          <tr key={e.id}>
            <td>{when(e.at)}</td>
            <td><span className={"adm-pill" + (BAD.has(e.type) ? " bad" : "")}>{EVENT_LABEL[e.type] ?? e.type}</span></td>
            <td>{[e.reason ? REASON_LABEL[e.reason] ?? e.reason : "", e.purpose ? (e.purpose === "guardian" ? "parent/guardian" : "signup") : ""].filter(Boolean).join(" · ") || "—"}</td>
            <td className="wrap">{e.account ?? "Unknown account"}</td>
            <td>{e.browser ?? "—"}</td>
          </tr>
        ))} />
      <Pager base="/admin/login-activity" page={list.page} pages={list.pages} params={params} />
    </>
  );
}
