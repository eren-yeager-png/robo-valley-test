import type { Metadata } from "next";
import Link from "next/link";
import { pool } from "../../../lib/db";
import { requireAdminPage } from "../../../lib/adminPage";
import { parseRange, RANGES, tableExists } from "../../../lib/adminStats";
import { EVENT_TYPES, RETENTION_DAYS } from "../../../lib/loginEvents";
import { EVENT_LABEL, eventCounts, listActivity, REASON_LABEL } from "../../../lib/loginActivity";
import { DataTable, Notice, PageHeader, Pager, SetupNotice, when } from "../_components/ui";
import { activityHref } from "./activityHref";
import EventCards from "./EventCards";

export const metadata: Metadata = { title: "Login activity | RoboValley admin", robots: { index: false, follow: false } };

type SP = { range?: string; event?: string; type?: string; page?: string };
const TABLE = "login-activity-table";
const BAD = new Set(["login_failed", "otp_failed"]);

// Shows what happened and when. It never contains passwords, OTP codes, IP addresses or typed-in email addresses.
export default async function LoginActivityPage({ searchParams }: { searchParams?: Promise<SP> } = {}) {
  const admin = await requireAdminPage();
  if (admin.mustChangePassword) return null;
  const sp = (await searchParams) ?? {};
  const days = parseRange(sp.range);
  const wanted = sp.event ?? sp.type ?? ""; // ?event= since the cards filter too; ?type= is how older links wrote it
  const type = (EVENT_TYPES as readonly string[]).includes(wanted) ? wanted : "";
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
  const params: Record<string, string> = { ...(type ? { event: type } : {}), range: String(days) };

  return (
    <>
      <PageHeader title="Login activity" lead={`Last ${days} days. Events are kept for ${RETENTION_DAYS} days. No passwords, codes or IP addresses are recorded.`} />
      <div className="adm-tabs" aria-label="Period">
        {RANGES.map((r) => <Link key={r} href={activityHref(r, type)} aria-current={r === days ? "page" : undefined}>Last {r} days</Link>)}
      </div>
      <EventCards cards={EVENT_TYPES.map((t) => ({ type: t, label: EVENT_LABEL[t], value: counts[t] }))} active={type} days={days} tableId={TABLE} />
      <div className="adm-tabs" aria-label="Event type">
        <Link href={activityHref(days, "")} scroll={false} aria-current={type === "" ? "page" : undefined}>All events</Link>
        {EVENT_TYPES.map((t) => <Link key={t} href={activityHref(days, t)} scroll={false} aria-current={type === t ? "page" : undefined}>{EVENT_LABEL[t]}</Link>)}
      </div>
      <div id={TABLE} className="adm-anchor">
      <p className="sr" role="status">{`${type ? EVENT_LABEL[type] : "All events"}, last ${days} days: ${list.total} ${list.total === 1 ? "event" : "events"}`}</p>
      <DataTable caption="Login activity" head={["When", "Event", "Details", "Account", "Browser"]} empty={type ? `No ${EVENT_LABEL[type]} events in this period.` : "No activity in this period."}
        rows={list.rows.map((e) => (
          <tr key={e.id}>
            <td>{when(e.at)}</td>
            <td><span className={"adm-pill" + (BAD.has(e.type) ? " bad" : "")}>{EVENT_LABEL[e.type] ?? e.type}</span></td>
            <td>{[e.reason ? REASON_LABEL[e.reason] ?? e.reason : "", e.purpose ? (e.purpose === "guardian" ? "parent/guardian" : "signup") : ""].filter(Boolean).join(" · ") || "—"}</td>
            <td className="cell-wrap">{e.account ?? "Unknown account"}</td>
            <td>{e.browser ?? "—"}</td>
          </tr>
        ))} />
      </div>
      <Pager base="/admin/login-activity" page={list.page} pages={list.pages} params={params} />
    </>
  );
}
