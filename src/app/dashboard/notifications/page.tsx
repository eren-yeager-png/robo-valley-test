import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDashboardContext } from "../../../lib/dashboardContext";
import { deriveTasks, loadAccount } from "../../../lib/dashboardData";
import { ErrorState, UnauthorizedState } from "../states";

export const metadata: Metadata = { title: "Notifications | RoboValley" };

export default async function NotificationsPage() {
  const ctx = await getDashboardContext();
  if (ctx.status === "anonymous") redirect("/login");
  if (ctx.status === "unknown-role") return <UnauthorizedState title="Your account has no dashboard yet" body="Your account's role isn't recognised." />;

  const res = await loadAccount(ctx.user.id);
  if (!res.ok) return <ErrorState body="We couldn't load your notifications. Please try again in a moment." />;
  const tasks = deriveTasks(res.account);

  return (
    <>
      <header className="dhead"><h1>Notifications</h1><p className="muted">Notices about your own account.</p></header>
      <section className="dsec" aria-labelledby="n-h">
        <h2 id="n-h">Account notices</h2>
        {tasks.length ? (
          <ul className="tasks">
            {tasks.map((t) => (
              <li key={t.id} className={t.tone}>
                <div><b>{t.title}</b><span>{t.detail}</span></div>
                {t.href && <a className="btn" href={t.href}>Open</a>}
              </li>
            ))}
          </ul>
        ) : (
          <div className="state"><p>No notices right now.</p></div>
        )}
      </section>
      <section className="state">
        <span className="badge mute">Not available yet</span>
        <h2>Event and activity notifications</h2>
        <p className="muted">Messages about mentoring, competitions, courses and teams are not connected yet.</p>
        <p className="needs"><b>What it needs:</b> a notifications table (recipient user id, type, read state) and the features that create them.</p>
      </section>
    </>
  );
}
