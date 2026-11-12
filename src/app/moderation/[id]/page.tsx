import Link from "next/link";
import { pool } from "../../../lib/db";
import { requireReviewerPage } from "../../../lib/reviewerPage";
import { getForReview, neighbours, type ReviewItem } from "../../../lib/contributionReview";
import { recordView } from "../../../lib/contributionViews";
import { STATUS_TONE } from "../../../lib/reviewStatus";
import DecisionForm from "../DecisionForm";
import ReplyNoteForm from "../ReplyNoteForm";

type SP = { from?: string; tab?: string; q?: string; cat?: string; sort?: string; verified?: string };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const isSlug = (s: unknown): s is string => typeof s === "string" && s.length <= 60 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);
const CALLOUT: Record<string, [string, string]> = {
  rejected: ["mod-callout mod-callout--red", "Not accepted. Reason shown to the contributor:"],
  removed: ["mod-callout mod-callout--red", "Removed (duplicate or unsuitable). Reason shown to the contributor:"],
  changes_requested: ["mod-callout mod-callout--amber", "Changes requested. Waiting for the contributor. Note shown to them:"],
  unpublished: ["mod-callout mod-callout--muted", "Unpublished. Reason:"],
};

/** Page 3 of the Admin Portal: one contribution, read-only and in the member form's order, with the Review panel. Opening it records the view. */
export default async function ContributionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<SP> }) {
  const me = await requireReviewerPage();
  const raw = (await params).id;
  const sp = (await searchParams) ?? {};
  const id = /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null;
  let item: ReviewItem | null = null, problem = "", nav = { prev: null as number | null, next: null as number | null, position: 0, of: 0 }, from = "";
  if (id) {
    try {
      await recordView(pool as never, me.userId, id); // opening an item marks it "In review" (never on your own item)
      item = await getForReview(pool as never, me.userId, id, me.isAdmin);
      if (item) {
        from = isSlug(sp.from) && item.sectorSlugs.includes(sp.from) ? sp.from : item.sectorSlugs[0] ?? "";
        if (from) nav = await neighbours(pool as never, from, { tab: sp.from ? sp.tab : "all", q: sp.q, category: sp.cat, sort: sp.sort, verified: sp.from ? sp.verified : undefined }, id);
      }
    } catch (e) {
      problem = (e as { code?: string })?.code === "42P01" ? "Reviewing is not set up on this database yet (migrations 012 to 019 are needed)." : "This contribution could not be loaded. Please try again.";
      console.error("admin portal: could not read a contribution");
    }
  }
  if (problem) return (<><p className="mod-crumb"><Link href="/moderation">Admin Portal / Contributions</Link></p><p className="mod-note" role="alert">{problem}</p></>);
  if (!item) return (<><p className="mod-crumb"><Link href="/moderation">Admin Portal / Contributions</Link></p><p className="mod-note" role="status">We could not find that contribution.</p></>);
  const it = item;
  const sectorName = it.sectors[it.sectorSlugs.indexOf(from)] ?? "";
  const keep = new URLSearchParams({ ...(from ? { from } : {}), ...(sp.from && sp.tab ? { tab: sp.tab } : {}), ...(sp.q ? { q: sp.q } : {}), ...(sp.cat ? { cat: sp.cat } : {}), ...(sp.sort === "old" ? { sort: "old" } : {}), ...(sp.from && (sp.verified === "0" || sp.verified === "1") ? { verified: sp.verified } : {}) }).toString();
  const back = from ? `/moderation/sector/${from}` + (sp.from ? "?" + new URLSearchParams({ ...(sp.tab ? { tab: sp.tab } : {}), ...(sp.q ? { q: sp.q } : {}), ...(sp.cat ? { cat: sp.cat } : {}), ...(sp.sort === "old" ? { sort: "old" } : {}), ...(sp.from && (sp.verified === "0" || sp.verified === "1") ? { verified: sp.verified } : {}) }).toString() : "") : "/moderation";
  const tone = STATUS_TONE[it.display];
  const callout = CALLOUT[it.status];

  return (
    <>
      <p className="mod-crumb"><Link href="/moderation">Admin Portal / Contributions</Link>{sectorName && <> / <a href={back}>{sectorName}</a></>} / #{it.id}</p>
      <h1>{it.title}</h1>
      <p className="mod-sub">Submitted by <b>{it.contributor}</b>{it.submittedAt ? ` · ${when(it.submittedAt)}` : ""} · <span className={"mod-pill" + (tone ? ` mod-pill--${tone}` : "")}>{it.displayLabel}</span>{it.verified ? " · Verified" : ""}</p>
      <div className="mod-detail">
        <div>
          {it.duplicates.length > 0 && (
            <div className="mod-dup" role="note" aria-labelledby={`dup-${it.id}`}>
              <strong id={`dup-${it.id}`}>Possible duplicate{it.duplicates.length === 1 ? "" : "s"} already live in the same sector</strong>
              <ul>{it.duplicates.map((d) => (<li key={d.id}><a href={`/moderation/${d.id}`}>#{d.id} {d.title}</a> <span className="mod-meta">· {d.statusLabel} · {d.exact ? "same title" : `${Math.round(d.similarity * 100)}% similar`}</span></li>))}</ul>
              <p className="mod-meta">Approving is blocked until an administrator confirms, with a reason, that this is not a duplicate. Or remove it as a duplicate.</p>
            </div>
          )}
          <section className="mod-card" aria-labelledby="d-details">
            <h2 id="d-details">Contribution details</h2>
            <dl>
              <div className="mod-field"><dt>Feature title</dt><dd>{it.title}</dd></div>
              <div className="mod-field"><dt>Stakeholder category (from profile)</dt><dd>{it.stakeholder || "Not set"}</dd></div>
              <div className="mod-field"><dt>Brief description</dt><dd>{it.description}</dd></div>
              {it.sections.map((s) => (<div key={s.label} className="mod-field"><dt>{s.label}</dt><dd>{s.text}</dd></div>))}
              {it.district && (<div className="mod-field"><dt>District</dt><dd>{it.district}</dd></div>)}
            </dl>
          </section>
          <section className="mod-card" aria-labelledby="d-cats">
            <h2 id="d-cats">Directory categories</h2>
            {!it.categories ? <p className="mod-callout mod-callout--muted">Sent before categories were stored separately: they are part of the description above.</p> : it.categories.map((c) => (
              <div key={c.category} className="mod-cat">
                <h3>{c.category}</h3>
                {c.links.length > 0 && (<>
                  <span className="mod-small">Links ({c.links.length})</span>
                  <ul>{c.links.map((l, i) => (<li key={i}><a href={l.url} target="_blank" rel="noopener nofollow noreferrer">{l.url}</a> <span className="mod-small">{l.type} · {l.gist}</span></li>))}</ul>
                </>)}
                {c.remarks && <div className="mod-remarks"><b>Remarks:</b> {c.remarks}</div>}
                {!c.links.length && !c.remarks && <span className="mod-small">No links or remarks added.</span>}
              </div>
            ))}
          </section>
          <section className="mod-card" aria-labelledby="d-sectors">
            <h2 id="d-sectors">Sectors</h2>
            <div className="mod-pills">{it.sectors.map((s) => <span key={s} className="mod-pill">{s}</span>)}</div>
          </section>
          <section className="mod-card" aria-labelledby="d-photos">
            <h2 id="d-photos">Photos <span className="mod-small" style={{ display: "inline" }}>{it.photoList.length} of 3</span></h2>
            {it.photoList.length === 0 ? <p className="mod-callout mod-callout--muted">No photos uploaded.</p> : (
              <div className="mod-photos">
                {it.photoList.map((p) => (
                  <figure key={p.id}>
                    <a href={`/api/review/${it.id}/photos/${p.id}`} target="_blank" rel="noopener">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/review/${it.id}/photos/${p.id}`} alt={p.alt} />
                    </a>
                    <figcaption><b>Alt text:</b> {p.alt}</figcaption>
                  </figure>
                ))}
              </div>
            )}
          </section>
          <section className="mod-card" aria-labelledby="d-contact">
            <h2 id="d-contact">Contact details <span className="mod-small" style={{ display: "inline" }}>Private, never shown publicly</span></h2>
            {it.contact ? (
              <dl>
                <div className="mod-field"><dt>Name</dt><dd>{it.contact.name || "—"}</dd></div>
                <div className="mod-field"><dt>Email</dt><dd>{it.contact.email ? <a href={`mailto:${it.contact.email}`}>{it.contact.email}</a> : "—"}</dd></div>
                <div className="mod-field"><dt>Mobile</dt><dd>{it.contact.phone || "—"}</dd></div>
              </dl>
            ) : <p className="mod-callout mod-callout--muted">No contact details are shown: the contributor did not share them with moderators, or you are not a moderator.</p>}
          </section>
        </div>

        <aside className="mod-side" aria-labelledby="d-review">
          <div className="mod-card">
            <h2 id="d-review">Review</h2>
            {callout && it.reason && <p className={callout[0]}>{callout[1]} “{it.reason}”</p>}
            {it.status === "published" && <p className="mod-callout">Published. It counts in the public sector numbers.</p>}
            {it.own ? <p className="mod-note">This is your own contribution, so another reviewer has to review it.</p> : (<>
              <DecisionForm id={it.id} actions={it.actions} isAdmin={me.isAdmin} hasDuplicates={it.duplicates.length > 0} />
              <ReplyNoteForm id={it.id} kind="reply" />
              <ReplyNoteForm id={it.id} kind="note" />
            </>)}
            <h3>History</h3>
            {it.timeline.length === 0 ? <p className="mod-meta">Nothing yet.</p> : (
              <ul className="mod-history">{it.timeline.map((h, i) => (<li key={i}>{h.text}<span>{when(h.at)}</span>{h.detail && <div>{h.detail}</div>}</li>))}</ul>
            )}
            {nav.of > 0 && (
              <nav className="mod-pager" aria-label="Previous and next in this list">
                {nav.prev ? <a className="mod-btn mod-btn--small" href={`/moderation/${nav.prev}?${keep}`}>← Previous</a> : <span />}
                <span className="mod-small">{nav.position} of {nav.of}</span>
                {nav.next ? <a className="mod-btn mod-btn--small" href={`/moderation/${nav.next}?${keep}`}>Next →</a> : <span />}
              </nav>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
