// Small presentational pieces shared by dashboard pages. Synchronous and free of hooks, so they
// work in Server Components.
import type { Section } from "../../lib/dashboardConfig";
import type { RoleSample } from "../../lib/dashboardSamples";

/** A section with no backend yet. Says plainly that nothing is live and what is missing. */
export function EmptyState({ section }: { section: Section }) {
  return (
    <section className="state" aria-labelledby="empty-title">
      <span className="badge mute">Not available yet</span>
      <h2 id="empty-title">Nothing to show here yet</h2>
      <p className="muted">{section.description} This area is not connected to live data, so no numbers or records are shown.</p>
      <p className="needs"><b>What it needs before it can show real data:</b> {section.needs}.</p>
    </section>
  );
}

/** The signed-in user is not allowed to see this page. Contains no data from the page. */
export function UnauthorizedState({ title = "You don't have access to this page", body = "This page belongs to a different role. Your dashboard only shows what your role can use." }: { title?: string; body?: string }) {
  return (
    <section className="state block" role="alert">
      <span className="badge warn">Access denied</span>
      <h2>{title}</h2>
      <p>{body}</p>
      <a className="btn primary" href="/dashboard">Back to my dashboard</a>
    </section>
  );
}

export function ErrorState({ title = "We couldn't load this page", body = "Something went wrong on our side. Please try again." }: { title?: string; body?: string }) {
  return (
    <section className="state block" role="alert">
      <span className="badge warn">Error</span>
      <h2>{title}</h2>
      <p>{body}</p>
      <a className="btn" href="">Try again</a>
    </section>
  );
}

/** Example data from the prototype, always labelled and collapsed by default. */
export function SamplePreview({ sample, roleLabel }: { sample: RoleSample; roleLabel: string }) {
  return (
    <details className="sample">
      <summary>See an example of what this dashboard will show (sample data)</summary>
      <p className="badge warn" style={{ marginBottom: 12 }}>Sample data, not your data</p>
      <p className="muted" style={{ marginBottom: 12 }}>
        These figures are made-up examples from the RoboValley prototype for the {roleLabel} role. They are not live and do not come from the database.
      </p>
      <div className="dcards" style={{ marginBottom: 12 }}>
        {sample.kpis.map(([n, label]) => (
          <div className="dcard" key={label}><span className="num">{n}</span><span className="cap">{label} <em>(example)</em></span></div>
        ))}
      </div>
      <div className="sample-cards">
        {sample.cards.map((c) => (
          <section className="dcard" key={c.title}>
            <h3>{c.title}</h3>
            <ul>{c.items.map((i) => <li key={i.title}>{i.title}<small>{i.detail}</small></li>)}</ul>
          </section>
        ))}
      </div>
    </details>
  );
}
