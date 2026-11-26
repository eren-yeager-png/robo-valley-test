import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDashboardContext } from "../../../lib/dashboardContext";
import { pool } from "../../../lib/db";
import { listMine, NotSetUp } from "../../../lib/cw/store";
import { mineReturnPath, siteUrl, workflowFormPath } from "../../../lib/session";
import { UnauthorizedState } from "../states";

export const metadata: Metadata = { title: "My contributions | RoboValley" };
export const dynamic = "force-dynamic";

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");

// The member's own ideas sent with the new "Share Your Idea" form, READ-ONLY (contributors never edit after submitting). Ideas sent
// with the older Contribute form are listed where they always were (the website's "Your contributions" page), linked below.
export default async function MyContributionsPage() {
  const ctx = await getDashboardContext();
  if (ctx.status === "anonymous") redirect("/login");
  if (ctx.status === "unknown-role") return <UnauthorizedState title="Your account has no dashboard yet" body="Your account's role isn't recognised." action="signout" />;

  let items: Awaited<ReturnType<typeof listMine>> | null = [];
  let setUp = true;
  try { items = await listMine(pool as never, Number(ctx.user.id)); } catch (e) {
    if (e instanceof NotSetUp) setUp = false; else { console.error("my contributions: could not be read"); items = null; }
  }
  const site = siteUrl().replace(/\/+$/, "");
  return (
    <>
      <header className="dhead"><h1>My contributions</h1><p className="muted">Ideas you shared with the &ldquo;Share Your Idea&rdquo; form, and where each one is. They are not public until an Admin publishes them.</p></header>
      <section className="dsec" aria-labelledby="mc-h">
        <h2 id="mc-h">Your ideas</h2>
        {!setUp ? <p className="muted">This list is not available yet.</p>
          : items === null ? <p className="muted">We couldn&apos;t load your ideas. Please try again in a moment.</p>
          : items.length === 0 ? <p className="muted">You have not shared an idea with the new form yet. <a href={site + workflowFormPath()}>Share your idea</a></p>
          : (
            <ul className="tasks" aria-label="Your ideas">
              {items.map((it) => (
                <li key={it.id}>
                  <strong>{it.code}</strong> · {it.title}
                  <div className="muted">{it.kind} · <span className="badge">{it.statusLabel}</span> · sent {fmt(it.submittedAt)}{it.publishedAt ? ` · published ${fmt(it.publishedAt)}` : ""}</div>
                </li>
              ))}
            </ul>
          )}
        <p className="muted" style={{ marginTop: 14 }}>Contributions sent with the earlier Contribute form are on the website&apos;s <a href={site + mineReturnPath()}>Your contributions</a> page.</p>
      </section>
    </>
  );
}
