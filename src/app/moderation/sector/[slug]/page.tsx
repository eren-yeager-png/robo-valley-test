import Link from "next/link";
import { pool } from "../../../../lib/db";
import { requireReviewerPage } from "../../../../lib/reviewerPage";
import { PORTAL_TAB_LIST, sectorList, type PortalTab, type SectorList } from "../../../../lib/contributionReview";
import { DISPLAY_LABELS, STATUS_TONE, type DisplayStatus } from "../../../../lib/reviewStatus";
import { DIRECTORY_CATEGORIES } from "../../../../lib/directoryCategories";
import { logDbError } from "../../../../lib/dbError";

type SP = { tab?: string; q?: string; cat?: string; sort?: string; page?: string; verified?: string };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const pillClass = (d: DisplayStatus) => "mod-pill" + (STATUS_TONE[d] ? ` mod-pill--${STATUS_TONE[d]}` : "");
const tabLabel = (t: PortalTab) => (t === "all" ? "All" : DISPLAY_LABELS[t]);
const verifiedParam = (v: boolean | null) => (v === null ? undefined : v ? "1" : "0");
/** A link to this list with some options changed (the others kept). */
function href(slug: string, l: Pick<SectorList, "tab" | "q" | "category" | "sort" | "verified">, change: Record<string, string | number | undefined>) {
  const p = new URLSearchParams();
  const v = { tab: l.tab, q: l.q, cat: l.category, sort: l.sort, verified: verifiedParam(l.verified), ...change } as Record<string, string | number | undefined>;
  for (const [k, x] of Object.entries(v)) if (x !== undefined && x !== "" && !(k === "sort" && x === "new") && !(k === "page" && x === 1)) p.set(k, String(x));
  const s = p.toString();
  return `/moderation/sector/${slug}${s ? "?" + s : ""}`;
}

/** Page 2 of the Admin Portal: one sector's contributions, by status, with search, a category filter, sort, pages of 20 and a CSV. */
export default async function SectorPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<SP> }) {
  await requireReviewerPage();
  const { slug } = await params;
  const sp = (await searchParams) ?? {};
  let list: SectorList | null = null, problem = "";
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && slug.length <= 60) {
    try {
      list = await sectorList(pool as never, slug, { tab: sp.tab, q: sp.q, category: sp.cat, sort: sp.sort, page: /^[1-9]\d{0,4}$/.test(sp.page ?? "") ? Number(sp.page) : 1, verified: sp.verified });
    } catch (e) {
      problem = logDbError("admin portal sector list", e) === "not_set_up" ? "Reviewing is not set up on this database yet (migrations 012 to 019 are needed)." : "The list could not be loaded. Please try again.";
    }
  }
  if (problem) return (<><p className="mod-crumb"><Link href="/moderation">Admin Portal / Contributions</Link></p><p className="mod-note" role="alert">{problem}</p></>);
  if (!list) return (<><p className="mod-crumb"><Link href="/moderation">Admin Portal / Contributions</Link></p><p className="mod-note" role="status">We could not find that sector.</p></>);
  const l = list;
  const only = l.verified === null ? {} : { verified: l.verified ? "1" : "0" };
  const exportHref = "/api/review/export?" + new URLSearchParams({ sector: slug, tab: l.tab, ...(l.q ? { q: l.q } : {}), ...(l.category ? { cat: l.category } : {}), sort: l.sort, ...only }).toString();
  const detailQuery = new URLSearchParams({ from: slug, tab: l.tab, ...(l.q ? { q: l.q } : {}), ...(l.category ? { cat: l.category } : {}), ...(l.sort === "old" ? { sort: "old" } : {}), ...only }).toString();

  return (
    <>
      <p className="mod-crumb"><Link href="/moderation">Admin Portal / Contributions</Link> / {l.sector.name}</p>
      <h1>Contributors for {l.sector.name}</h1>
      <p className="mod-sub">{l.contributions} contribution{l.contributions === 1 ? "" : "s"} from {l.contributors} contributor{l.contributors === 1 ? "" : "s"}. Open one to read the full form and review it.</p>
      <div className="mod-card">
        <div className="mod-tabs" role="tablist" aria-label="Status">
          {PORTAL_TAB_LIST.map((t) => (
            <a key={t} role="tab" aria-selected={t === l.tab ? "true" : "false"} aria-controls="mod-list" href={href(slug, l, { tab: t, page: undefined })}>{tabLabel(t)} ({l.counts[t]})</a>
          ))}
        </div>
        <form className="mod-toolbar" method="get" action={`/moderation/sector/${slug}`} role="search">
          <input type="hidden" name="tab" value={l.tab} />
          {l.verified !== null && <input type="hidden" name="verified" value={l.verified ? "1" : "0"} />}
          <label className="mod-sr" htmlFor="c-q">Search title or contributor</label>
          <input type="search" id="c-q" name="q" defaultValue={l.q} placeholder="Search title or contributor…" maxLength={100} />
          <label className="mod-sr" htmlFor="c-cat">Directory category</label>
          <select id="c-cat" name="cat" defaultValue={l.category}>
            <option value="">All directory categories</option>
            {DIRECTORY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="mod-sr" htmlFor="c-sort">Sort</label>
          <select id="c-sort" name="sort" defaultValue={l.sort}><option value="new">Newest first</option><option value="old">Oldest first</option></select>
          <button type="submit" className="mod-btn mod-btn--small">Apply</button>
          <a className="mod-btn mod-btn--small mod-end" href={exportHref} download>Export CSV</a>
        </form>
        {l.verified !== null && <p className="mod-note" role="status">Showing only pending contributions {l.verified ? "a reviewer has verified" : "that nobody has verified yet"}. <a href={href(slug, l, { verified: undefined, page: undefined })}>Show everything</a></p>}
        <div id="mod-list" role="tabpanel" aria-label={`${tabLabel(l.tab)} contributions`}>
          <table className="mod-table">
            <thead><tr><th scope="col">Contribution</th><th scope="col">Contributor</th><th scope="col">Directory categories</th><th scope="col">Submitted</th><th scope="col">Status</th><th scope="col"><span className="mod-sr">Action</span></th></tr></thead>
            <tbody>
              {l.rows.length === 0 ? (<tr><td colSpan={6} className="mod-empty">Nothing here yet.</td></tr>) : l.rows.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.title}</strong>{r.alsoIn.length > 0 && <span className="mod-small">Also in: {r.alsoIn.join(", ")}</span>}</td>
                  <td>{r.contributor}{r.stakeholder && <span className="mod-small">{r.stakeholder}</span>}</td>
                  <td>{r.categories.length ? <span className="mod-pills">{r.categories.map((c) => <span key={c} className="mod-pill mod-pill--grey">{c}</span>)}</span> : <span className="mod-small">Not recorded</span>}</td>
                  <td className="mod-small">{when(r.submittedAt)}</td>
                  <td><span className={pillClass(r.display)}>{r.displayLabel}</span></td>
                  <td><a className="mod-btn mod-btn--small" href={`/moderation/${r.id}?${detailQuery}`} aria-label={`View form: ${r.title}`}>View form</a></td>
                </tr>
              ))}
            </tbody>
          </table>
          {l.pages > 1 && (
            <nav className="mod-pager" aria-label="Pages">
              {l.page > 1 ? <a className="mod-btn mod-btn--small" href={href(slug, l, { page: l.page - 1 })}>← Previous page</a> : <span />}
              <span className="mod-small">Page {l.page} of {l.pages} · {l.matching} contributions</span>
              {l.page < l.pages ? <a className="mod-btn mod-btn--small" href={href(slug, l, { page: l.page + 1 })}>Next page →</a> : <span />}
            </nav>
          )}
        </div>
      </div>
    </>
  );
}
