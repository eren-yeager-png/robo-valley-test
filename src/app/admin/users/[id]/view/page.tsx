import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pool } from "../../../../../lib/db";
import { requireAdminPage } from "../../../../../lib/adminPage";
import { viewAs } from "../../../../../lib/viewAs";
import CwMount from "../../../../_cw/CwMount";
import "../../../../../../public/cw/portal.css";

export const metadata: Metadata = { title: "View as | RoboValley admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
const PORTAL = { admin: "the admin portal (administrator)", moderator: "the admin portal (moderator)", member: "their Member portal", none: "no portal (their role has no dashboard)" } as const;

// Users & Roles -> View as (administrators only): what this person sees, read-only. It does not sign in as them.
export default async function ViewAsPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminPage();
  if (admin.mustChangePassword) return null;
  const raw = (await params).id;
  if (!/^[1-9]\d{0,9}$/.test(raw)) notFound();
  const v = await viewAs(pool as never, Number(raw)).catch(() => null);
  if (!v) notFound();
  return (
    <div className="rv-pp">
      <p><Link href="/admin/users">← Users &amp; Roles</Link></p>
      <header className="rv-pp-head"><div className="rv-pp-head__text"><h1 className="rv-pp-title">Viewing as {v.name || "this member"}</h1>
        <p className="rv-pp-desc">Read-only: what {v.name || "they"} see{v.name ? "s" : ""}. Nothing here acts for them, and you stay signed in as yourself.</p></div></header>
      <section className="rv-pp-panel" aria-labelledby="va-portal">
        <h2 id="va-portal" className="rv-pp-panel__title">Their portal</h2>
        <dl className="rv-pp-dl">
          <dt>Role</dt><dd>{v.roleLabel}{v.minor ? " (under 18)" : ""}</dd>
          <dt>Portal</dt><dd>{PORTAL[v.portal]}</dd>
          <dt>Navigation</dt><dd>{v.nav.length ? v.nav.map((n) => <span key={n} className="rv-pp-tag">{n}</span>) : "—"}</dd>
          {v.portal === "moderator" && <><dt>Sectors they moderate</dt><dd>Every sector (moderators per sector come with the data update)</dd></>}
        </dl>
      </section>
      {v.itemsReady
        ? <CwMount screen="mine" options={{ data: { items: v.items }, readOnly: true, heading: `${v.name || "Their"}'s contributions`, note: "As they see it in My Contributions." }} />
        : <p className="cw-notice cw-n-info">Their contributions cannot be shown on this database yet.</p>}
    </div>
  );
}
