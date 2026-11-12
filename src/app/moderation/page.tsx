import { redirect } from "next/navigation";
import { pool } from "../../lib/db";
import { requireReviewerPage } from "../../lib/reviewerPage";
import { sectorOverview, type PortalTotals, type SectorCard } from "../../lib/contributionReview";
import { logDbError } from "../../lib/dbError";

type SP = { q?: string; sort?: string; item?: string };
const SORTS = [["pending", "Most pending first"], ["name", "A–Z"], ["total", "Most contributions"]] as const;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Page 1 of the Admin Portal: every sector with its numbers, and a way into each sector's list. */
export default async function ModerationPage({ searchParams }: { searchParams?: Promise<SP> } = {}) {
  await requireReviewerPage();
  const sp = (await searchParams) ?? {};
  if (/^[1-9]\d{0,9}$/.test(sp.item ?? "")) redirect(`/moderation/${sp.item}`); // older links (/moderation?item=12) open the new detail page
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
      <p className="mod-crumb">Admin Portal / Contributions</p>
      <h1>Contributions by Sector</h1>
      <p className="mod-sub">Open a sector to see every contributor and the forms they filled in. A contribution in several sectors appears under each one.</p>
      {problem ? <p className="mod-note" role="alert">{problem}</p> : (
        <>
          <div className="mod-stats">
            <div className="mod-stat"><b>{totals.all}</b><span>All contributions</span></div>
            <div className="mod-stat mod-stat--amber"><b>{totals.pending}</b><span>Pending review</span></div>
            <div className="mod-stat"><b>{totals.published}</b><span>Published</span></div>
            <div className="mod-stat mod-stat--red"><b>{totals.rejected}</b><span>Not accepted</span></div>
          </div>
          <form className="mod-toolbar" method="get" action="/moderation" role="search">
            <label className="mod-sr" htmlFor="sec-q">Find a sector</label>
            <input type="search" id="sec-q" name="q" defaultValue={q} placeholder="Find a sector…" maxLength={60} />
            <label className="mod-sr" htmlFor="sec-sort">Sort</label>
            <select id="sec-sort" name="sort" defaultValue={sort}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <button type="submit" className="mod-btn mod-btn--small">Apply</button>
          </form>
          {totals.all === 0 && sectors.length > 0 && <p className="mod-note" role="status">No contributions yet. The numbers loaded, and every sector is at 0.</p>}
          {shown.length === 0 ? <p className="mod-empty" role="status">{q ? `No sector matches “${q}”.` : "No sectors yet."}</p> : (
            <div className="mod-grid">
              {shown.map((s) => (
                <section key={s.slug} className="mod-sector" aria-labelledby={`sec-${s.slug}`}>
                  <h2 id={`sec-${s.slug}`}>{s.name}</h2>
                  <span className="mod-meta">{plural(s.contributions, "contribution")} · {plural(s.contributors, "contributor")}</span>
                  <div className="mod-pills">
                    <span className="mod-pill mod-pill--amber">{s.pending} pending</span>
                    <span className="mod-pill">{s.published} published</span>
                    <span className="mod-pill mod-pill--red">{s.rejected} not accepted</span>
                  </div>
                  <a className="mod-btn mod-btn--primary" href={`/moderation/sector/${s.slug}`}>Contributors for {s.name} →</a>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
