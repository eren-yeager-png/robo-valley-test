// Dashboard home. Real data: the signed-in user's own account (name, role, profile completeness,
// consent status, tasks). Everything else is labelled "not available yet" (no backend) or sits in a
// collapsed block clearly marked as sample data.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDashboardContext } from "../../lib/dashboardContext";
import { deriveTasks, loadAccount, profileCompleteness } from "../../lib/dashboardData";
import { ROLE_SAMPLES } from "../../lib/dashboardSamples";
import { ErrorState, SamplePreview, UnauthorizedState } from "./states";

export const metadata: Metadata = { title: "Dashboard | RoboValley" };

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default async function DashboardHome() {
  const ctx = await getDashboardContext();
  if (ctx.status === "anonymous") redirect("/login");
  if (ctx.status === "unknown-role") return <UnauthorizedState title="Your account has no dashboard yet" body="Your account's role isn't recognised." />;
  const { user, dash } = ctx;

  const res = await loadAccount(user.id);
  if (!res.ok) return <ErrorState body="We couldn't load your account details. Please try again in a moment." />;
  const a = res.account;
  const comp = profileCompleteness(a.role, a.profile);
  const tasks = deriveTasks(a);
  const sample = ROLE_SAMPLES[a.role];

  return (
    <>
      <header className="dhead">
        <span className="badge">{dash.label}</span>
        <h1>Welcome, {a.fullName.split(" ")[0]}!</h1>
        <p className="muted">{dash.tagline}</p>
      </header>

      {a.ageCategory === "minor" && a.guardian && a.guardian.consentStatus !== "granted" && (
        <div className="box warn" role="status">
          <b>Parent or guardian consent is pending.</b> Until it is confirmed you can browse projects but cannot chat, book mentors or join teams.
        </div>
      )}

      <section className="dsec" aria-labelledby="tasks-h">
        <h2 id="tasks-h">Pending tasks</h2>
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
          <div className="state"><p>You're all caught up. There is nothing waiting for you.</p></div>
        )}
      </section>

      <section className="dsec" aria-labelledby="acct-h">
        <h2 id="acct-h">Your account</h2>
        <div className="dcards">
          <div className="dcard">
            <span className="num">{comp.percent}%</span>
            <span className="cap">Profile complete ({comp.done} of {comp.total} questions)</span>
            <div className="bar" role="progressbar" aria-valuenow={comp.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completeness"><i style={{ width: `${comp.percent}%` }} /></div>
          </div>
          <div className="dcard"><span className="num">{fmtDate(a.createdAt)}</span><span className="cap">Member since</span></div>
          <div className="dcard">
            <span className="num">{a.emailVerification === "email" ? "Verified" : a.emailVerification === "mock" ? "Test mode" : "Not verified"}</span>
            <span className="cap">Email address</span>
          </div>
          {a.ageCategory === "minor" && (
            <div className="dcard">
              <span className="num">{a.guardian?.consentStatus === "granted" ? "Granted" : "Pending"}</span>
              <span className="cap">Parent or guardian consent{a.guardian ? ` (${a.guardian.relationship}: ${a.guardian.guardianName})` : ""}</span>
            </div>
          )}
        </div>
      </section>

      <section className="dsec" aria-labelledby="role-h">
        <h2 id="role-h">At a glance for {dash.label}</h2>
        <div className="dcards">
          {dash.tiles.map((t) => (
            <div className="dcard" key={t}><span className="num na" aria-label="not available yet">—</span><span className="cap">{t}</span><span className="badge mute">Not available yet</span></div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: ".88rem" }}>These areas will fill in once their data is connected. No figures are shown until then.</p>
      </section>

      <section className="dsec" aria-labelledby="qa-h">
        <h2 id="qa-h">Quick actions</h2>
        <div className="actions-row">
          {[{ label: "Complete your profile", href: "/dashboard/profile" }, ...dash.quickActions.filter((q) => q.href !== "/dashboard/profile")].map((q) => (
            <a className="btn" href={q.href} key={q.href}>{q.label}</a>
          ))}
        </div>
      </section>

      <section className="dsec" aria-labelledby="act-h">
        <h2 id="act-h">Recent activity</h2>
        <ul className="tasks"><li><div><b>Account created</b><span>{fmtDate(a.createdAt)}</span></div></li></ul>
        <p className="muted" style={{ fontSize: ".88rem" }}>A full activity feed needs an activity log, which doesn't exist yet.</p>
      </section>

      {sample && <SamplePreview sample={sample} roleLabel={dash.label} />}
    </>
  );
}
