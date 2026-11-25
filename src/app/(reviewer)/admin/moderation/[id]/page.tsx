import Link from "next/link";
import { pool } from "../../../../../lib/db";
import { requireReviewerPage } from "../../../../../lib/reviewerPage";
import { getForReview, neighbours, type ReviewItem } from "../../../../../lib/contributionReview";
import { recordView } from "../../../../../lib/contributionViews";
import { STATUS_TONE } from "../../../../../lib/reviewStatus";
import DecisionForm from "../DecisionForm";
import ReplyNoteForm from "../ReplyNoteForm";
import { logDbError } from "../../../../../lib/dbError";
import { Notice } from "../../../../admin/_components/ui";

type SP = { from?: string; tab?: string; q?: string; cat?: string; sort?: string; verified?: string };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const isSlug = (s: unknown): s is string => typeof s === "string" && s.length <= 60 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);
const PILL: Record<string, string> = { amber: " warn", red: " bad", grey: " mute" };
const CALLOUT: Record<string, [string, string]> = {
  rejected: ["mod-callout mod-callout--red", "Not accepted. Reason shown to the contributor:"],
  removed: ["mod-callout mod-callout--red", "Removed (duplicate or unsuitable). Reason shown to the contributor:"],
  changes_requested: ["mod-callout mod-callout--amber", "Changes requested. Waiting for the contributor. Note shown to them:"],
  unpublished: ["mod-callout mod-callout--muted", "Unpublished. Reason:"],
};

/** Page 3 of Moderation: one contribution, read-only and in the member form's order, with the Review panel. Opening it records the view. */
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
      problem = logDbError("admin portal contribution", e) === "not_set_up" ? "Reviewing is not set up on this database yet (migrations 012 to 019 are needed)." : "This contribution could not be loaded. Please try again.";
    }
  }
  if (problem) return (<><p className="mod-crumb"><Link href="/admin/moderation">Moderation</Link></p><Notice kind="error" title={problem} /></>);
  if (!item) return (<><p className="mod-crumb"><Link href="/admin/moderation">Moderation</Link></p><Notice kind="info">We could not find that contribution.</Notice></>);
  const it = item;
  const sectorName = it.sectors[it.sectorSlugs.indexOf(from)] ?? "";
  const keep = new URLSearchParams({ ...(from ? { from } : {}), ...(sp.from && sp.tab ? { tab: sp.tab } : {}), ...(sp.q ? { q: sp.q } : {}), ...(sp.cat ? { cat: sp.cat } : {}), ...(sp.sort === "old" ? { sort: "old" } : {}), ...(sp.from && (sp.verified === "0" || sp.verified === "1") ? { verified: sp.verified } : {}) }).toString();
  const back = from ? `/admin/moderation/sector/${from}` + (sp.from ? "?" + new URLSearchParams({ ...(sp.tab ? { tab: sp.tab } : {}), ...(sp.q ? { q: sp.q } : {}), ...(sp.cat ? { cat: sp.cat } : {}), ...(sp.sort === "old" ? { sort: "old" } : {}), ...(sp.from && (sp.verified === "0" || sp.verified === "1") ? { verified: sp.verified } : {}) }).toString() : "") : "/admin/moderation";
  const tone = STATUS_TONE[it.display];
  const callout = CALLOUT[it.status];

  return (
    <>
      <p className="mod-crumb"><Link href="/admin/moderation">Moderation</Link>{sectorName && <> / <a href={back}>{sectorName}</a></>} / #{it.id}</p>
      <div className="adm-head">
      <h1>{it.title}</h1>
      <p>Submitted by <b>{it.contributor}</b>{it.submittedAt ? ` · ${when(it.submittedAt)}` : ""} · <span className={"adm-pill" + (PILL[tone ?? ""] ?? "")}>{it.displayLabel}</span>{it.verified ? " · Verified" : ""}</p>
      </div>
      <div className="mod-detail">
        <div>
          {it.duplicates.length > 0 && (
            <div className="mod-dup" role="note" aria-labelledby={`dup-${it.id}`}>
              <strong id={`dup-${it.id}`}>Possible duplicate{it.duplicates.length === 1 ? "" : "s"} already live in the same sector</strong>
              <ul>{it.duplicates.map((d) => (<li key={d.id}><a href={`/admin/moderation/${d.id}`}>#{d.id} {d.title}</a> <span className="mod-meta">· {d.statusLabel} · {d.exact ? "same title" : `${Math.round(d.similarity * 100)}% similar`}</span></li>))}</ul>
              <p className="mod-meta">Approving is blocked until an administrator confirms, with a reason, that this is not a duplicate. Or remove it as a duplicate.</p>
            </div>
          )}
          <section className="adm-card" aria-labelledby="d-details">
            <h3 id="d-details">Contribution details</h3>
            <dl>
              <div className="mod-field"><dt>Feature title</dt><dd>{it.title}</dd></div>
              {/* P1: the type the member chose in the form; an older form did not ask, so its stored type is not shown as a choice */}
              <div className="mod-field" data-type-chosen={it.typeChosen ? "yes" : "no"}><dt>Type</dt><dd style={it.typeChosen ? undefined : { color: "var(--muted)" }}>{it.typeLabel}</dd></div>
              <div className="mod-field"><dt>Stakeholder category (from profile)</dt><dd>{it.stakeholder || "Not set"}</dd></div>
              <div className="mod-field"><dt>Brief description</dt><dd>{it.description}</dd></div>
              {it.sections.map((s) => (<div key={s.label} className="mod-field"><dt>{s.label}</dt><dd>{s.text}</dd></div>))}
              {it.district && (<div className="mod-field"><dt>District</dt><dd>{it.district}</dd></div>)}
            </dl>
          </section>
          <section className="adm-card" aria-labelledby="d-cats">
            <h3 id="d-cats">Directory categories</h3>
            {!it.categories ? <p className="mod-callout mod-callout--muted">Sent before categories were stored separately: they are part of the description above.</p> : it.categories.map((c) => (
              <div key={c.category} className="mod-cat">
                <h4>{c.category}</h4>
                {c.links.length > 0 && (<>
                  <span className="mod-small">Links ({c.links.length})</span>
                  <ul>{c.links.map((l, i) => (<li key={i}><a href={l.url} target="_blank" rel="noopener nofollow noreferrer">{l.url}</a> <span className="mod-small">{l.type} · {l.gist}</span></li>))}</ul>
                </>)}
                {c.remarks && <div className="mod-remarks"><b>Remarks:</b> {c.remarks}</div>}
                {!c.links.length && !c.remarks && <span className="mod-small">No links or remarks added.</span>}
              </div>
            ))}
          </section>
          <section className="adm-card" aria-labelledby="d-sectors">
            <h3 id="d-sectors">Sectors</h3>
            <div className="mod-pills">{it.sectors.map((s) => <span key={s} className="adm-pill">{s}</span>)}</div>
            {it.robots && it.robots.length > 0 && ( /* P3: the robot chosen for each sector (shown to reviewers only, like the rest of this page) */
              <dl className="mod-robots">
                {it.robots.map((r) => (
                  <div key={r.sector}>
                    <dt>{r.sectorName}</dt>
                    <dd>Robot: {r.robot ? <>{r.robot.name}{r.robot.active ? "" : <span className="mod-small" style={{ display: "inline" }}> (switched off in Sector forms)</span>}</> : <span className="mod-small" style={{ display: "inline" }}>Not sure</span>}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
          <section className="adm-card" aria-labelledby="d-photos">
            <h3 id="d-photos">Photos <span className="mod-small" style={{ display: "inline" }}>{it.photoList.length} of 3</span></h3>
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
          <section className="adm-card" aria-labelledby="d-contact">
            <h3 id="d-contact">Contact details <span className="mod-small" style={{ display: "inline" }}>Private, never shown publicly</span></h3>
            {it.contact ? (
              <>
              <p className="mod-small">{it.contact.source === "profile" ? "From the contributor’s profile: they ticked “Let moderators contact me using my profile details”." : "Typed into the form by the contributor, who chose to share it with moderators."}</p>
              <dl>
                <div className="mod-field"><dt>Name</dt><dd>{it.contact.name || "—"}</dd></div>
                <div className="mod-field"><dt>Email</dt><dd>{it.contact.email ? <a href={`mailto:${it.contact.email}`}>{it.contact.email}</a> : "—"}</dd></div>
                <div className="mod-field"><dt>Mobile</dt><dd>{it.contact.phone || "—"}</dd></div>
              </dl>
              </>
            ) : <p className="mod-callout mod-callout--muted">No contact details are shown: the contributor did not tick “Let moderators contact me”.</p>}
          </section>
        </div>

        <aside className="mod-side" aria-labelledby="d-review">
          <div className="adm-card">
            <h3 id="d-review">Review</h3>
            {callout && it.reason && <p className={callout[0]}>{callout[1]} “{it.reason}”</p>}
            {it.status === "published" && <p className="mod-callout">Published. It counts in the public sector numbers.</p>}
            {it.own ? <p className="adm-note info">This is your own contribution, so another reviewer has to review it.</p> : (<>
              <DecisionForm id={it.id} actions={it.actions} isAdmin={me.isAdmin} hasDuplicates={it.duplicates.length > 0} />
              <ReplyNoteForm id={it.id} kind="reply" />
              <ReplyNoteForm id={it.id} kind="note" />
            </>)}
            <h4>History</h4>
            {it.timeline.length === 0 ? <p className="mod-meta">Nothing yet.</p> : (
              <ul className="mod-history">{it.timeline.map((h, i) => (<li key={i}>{h.text}<span>{when(h.at)}</span>{h.detail && <div>{h.detail}</div>}</li>))}</ul>
            )}
            {nav.of > 0 && (
              <nav className="adm-pager" aria-label="Previous and next in this list">
                {nav.prev ? <a className="btn" href={`/admin/moderation/${nav.prev}?${keep}`}>← Previous</a> : <span />}
                <span className="mod-small">{nav.position} of {nav.of}</span>
                {nav.next ? <a className="btn" href={`/admin/moderation/${nav.next}?${keep}`}>Next →</a> : <span />}
              </nav>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
