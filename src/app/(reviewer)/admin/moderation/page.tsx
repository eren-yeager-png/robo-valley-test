import { redirect } from "next/navigation";
import { pool } from "../../../../lib/db";
import { requireReviewerPage } from "../../../../lib/reviewerPage";
import { sectorOverview, type PortalTotals, type SectorCard } from "../../../../lib/contributionReview";
import { logDbError } from "../../../../lib/dbError";
import { Notice, PageHeader, StatCard } from "../../../admin/_components/ui";

type SP = { q?: string; sort?: string; item?: string };
const SORTS = [["pending", "Most pending first"], ["name", "A–Z"], ["total", "Most contributions"]] as const;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Page 1 of Moderation: every sector with its numbers, and a way into each sector's list. */
export default async function ModerationPage({ searchParams }: { searchParams?: Promise<SP> } = {}) {
  await requireReviewerPage();
  const sp = (await searchParams) ?? {};
  if (/^[1-9]\d{0,9}$/.test(sp.item ?? "")) redirect(`/admin/moderation/${sp.item}`); // older links (/admin/moderation?item=12) open the new detail page
  const q = (sp.q ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const sort = SORTS.some(([k]) => k === sp.sort) ? (sp.sort as string) : "pending";

  let totals: PortalTotals = { all: 0, pending: 0, published: 0, rejected: 0 }, sectors: SectorCard[] = [], problem = "";
  try {
    ({ totals, sectors } = await sectorOverview(pool as never));
  } catch (e) {
    problem = logDbError("admin portal sectors", e) === "not_set_up" ? "Reviewing is not set up on this database yet (migrations 012 to 019 are needed)." : "The numbers could not be loaded. Please try again.";
  }
  const shown = sectors
    .filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : sort === "total" ? b.contributions - a.contributions || a.name.localeCompare(b.name) : b.pending - a.pending || a.name.localeCompare(b.name)));

  return (
    <>
      <PageHeader title="Contributions by Sector" lead="Open a sector to see every contributor and the forms they filled in. A contribution in several sectors appears under each one." />
      {problem ? <Notice kind="error" title={problem} /> : (
        <>
          <div className="adm-grid">
            <StatCard label="All contributions" value={totals.all} />
            <StatCard label="Pending review" value={totals.pending} />
            <StatCard label="Published" value={totals.published} />
            <StatCard label="Not accepted" value={totals.rejected} />
          </div>
          <form className="adm-filters" method="get" action="/admin/moderation" role="search">
            <label>Find a sector<input type="search" id="sec-q" name="q" defaultValue={q} placeholder="Find a sector…" maxLength={60} /></label>
            <label>Sort
              <select id="sec-sort" name="sort" defaultValue={sort}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </label>
            <button type="submit" className="btn primary">Apply</button>
          </form>
          {totals.all === 0 && sectors.length > 0 && <Notice kind="info" title="No contributions yet.">The numbers loaded, and every sector is at 0.</Notice>}
          {shown.length === 0 ? <Notice kind="empty">{q ? `No sector matches “${q}”.` : "No sectors yet."}</Notice> : (
            <div className="adm-grid mod-sectors">
              {shown.map((s) => (
                <section key={s.slug} className="adm-card mod-sector" aria-labelledby={`sec-${s.slug}`}>
                  <h3 id={`sec-${s.slug}`}>{s.name}</h3>
                  <span className="mod-meta">{plural(s.contributions, "contribution")} · {plural(s.contributors, "contributor")}</span>
                  <div className="mod-pills">
                    <span className="adm-pill warn">{s.pending} pending</span>
                    <span className="adm-pill">{s.published} published</span>
                    <span className="adm-pill bad">{s.rejected} not accepted</span>
                  </div>
                  <a className="btn primary" href={`/admin/moderation/sector/${s.slug}`}>Contributors for {s.name} →</a>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
