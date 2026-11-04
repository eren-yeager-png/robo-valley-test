// Small presentational pieces shared by the admin pages (server-compatible: no state, no effects).
import Link from "next/link";

export function PageHeader({ title, lead }: { title: string; lead?: string }) {
  return (
    <div className="adm-head">
      <h1>{title}</h1>
      {lead && <p>{lead}</p>}
    </div>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: number | string | null; hint?: string }) {
  return (
    <div className="adm-card stat">
      <div className="lbl">{label}</div>
      <div className="val">{value === null ? "—" : typeof value === "number" ? value.toLocaleString("en-IN") : value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/** One notice component for every non-data state, so wording and look stay consistent. */
export function Notice({ kind, title, children }: { kind: "setup" | "empty" | "error" | "info"; title?: string; children?: React.ReactNode }) {
  return (
    <div className={"adm-note " + kind} role={kind === "error" ? "alert" : "status"}>
      {title && <strong>{title}</strong>}
      {children && <div>{children}</div>}
    </div>
  );
}

/**
 * Slim notice shown while a feature's database table has not been created yet. It names the feature and the migration;
 * the developer steps are on the Settings page (Database setup). It disappears by itself once the migration is applied.
 */
export function SetupNotice({ what, migration }: { what: string; migration: "008" | "009" }) {
  return (
    <div className="adm-note setup" role="status">
      <span className="ico" aria-hidden="true">!</span>
      <strong>{what} is not set up yet</strong>
      <span>Needs migration {migration} on this database.</span>
      <Link href="/admin/settings#database-setup">Setup steps</Link>
    </div>
  );
}

export function DataTable({ head, rows, empty, caption }: { head: string[]; rows: React.ReactNode[]; empty?: string; caption: string }) {
  if (rows.length === 0) return <Notice kind="empty">{empty ?? "Nothing to show yet."}</Notice>;
  return (
    <div className="adm-tablewrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="adm-table">
        <caption className="sr">{caption}</caption>
        <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

export function Pager({ base, page, pages, params = {} }: { base: string; page: number; pages: number; params?: Record<string, string> }) {
  if (pages <= 1) return null;
  const href = (p: number) => `${base}?${new URLSearchParams({ ...params, page: String(p) }).toString()}`;
  return (
    <nav className="adm-pager" aria-label="Pages">
      {page > 1 ? <Link href={href(page - 1)}>← Previous</Link> : <span />}
      <span>Page {page} of {pages}</span>
      {page < pages ? <Link href={href(page + 1)}>Next →</Link> : <span />}
    </nav>
  );
}

export function when(iso: string | Date | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}
