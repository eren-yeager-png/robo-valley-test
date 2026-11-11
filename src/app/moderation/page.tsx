import { pool } from "../../lib/db";
import { requireReviewerPage } from "../../lib/reviewerPage";
import { QUEUE_STATUSES, getForReview, listQueue, type QueueItem, type ReviewItem } from "../../lib/contributionReview";
import { STATUS_LABELS, type ContributionStatus } from "../../lib/contributions";
import DecisionForm from "./DecisionForm";
import ReplyNoteForm from "./ReplyNoteForm";
import { recordView } from "../../lib/contributionViews";

type SP = { status?: string; item?: string };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const ACTION_WORDS: Record<string, string> = { verify: "Verified", approve: "Approved", request_changes: "Changes requested", reject: "Rejected", remove: "Removed", unpublish: "Unpublished", republish: "Published again" };

export default async function ModerationPage({ searchParams }: { searchParams?: Promise<SP> } = {}) {
  const me = await requireReviewerPage();
  const sp = (await searchParams) ?? {};
  const status = (QUEUE_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as string) : "pending_review";
  const itemId = /^[1-9]\d{0,9}$/.test(sp.item ?? "") ? Number(sp.item) : null;

  let queue: QueueItem[] = [], item: ReviewItem | null = null, problem = "";
  try {
    queue = await listQueue(pool as never, status);
    if (itemId) {
      await recordView(pool as never, me.userId, itemId); // opening an item marks it "In review" (never on your own item)
      item = await getForReview(pool as never, me.userId, itemId, me.isAdmin);
    }
  } catch (e) {
    problem = (e as { code?: string })?.code === "42P01" ? "Reviewing is not set up on this database yet (migrations 012 to 014 and 017 are needed)." : "The list could not be loaded. Please try again.";
    console.error("moderation page: could not read the data");
  }

  return (
    <main className="mod-main">
      <section aria-labelledby="mod-queue-h">
        <h1 id="mod-queue-h">Moderation queue</h1>
        <p className="mod-lead">Contributions waiting for a decision, oldest first. Drafts are never shown.</p>
        <ul className="mod-tabs" aria-label="Show">
          {QUEUE_STATUSES.map((s) => (
            <li key={s}><a href={`/moderation?status=${s}`} aria-current={s === status ? "page" : undefined}>{STATUS_LABELS[s as ContributionStatus]}</a></li>
          ))}
        </ul>
        {problem && <p className="mod-note" role="alert">{problem}</p>}
        {!problem && queue.length === 0 && <p className="mod-note" role="status">Nothing here right now.</p>}
        <ul className="mod-list">
          {queue.map((q) => (
            <li key={q.id}>
              <a href={`/moderation?status=${status}&item=${q.id}`} aria-current={q.id === itemId ? "true" : undefined}>
                <strong>{q.title}</strong>
                <span className="mod-meta">{[q.status === "pending_review" ? q.displayLabel : "", q.typeLabel, q.sectors.join(", "), q.photos ? `${q.photos} photo${q.photos === 1 ? "" : "s"}` : "", when(q.submittedAt)].filter(Boolean).join(" · ")}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="mod-item-h">
        {!item && <p className="mod-note" role="status">{itemId && !problem ? "We could not find that contribution." : "Choose a contribution on the left to read it."}</p>}
        {item && (
          <article className="mod-card">
            <h2 id="mod-item-h">{item.title}</h2>
            <p className="mod-meta">{item.displayLabel}{item.verified ? " · Verified" : ""} · {item.typeLabel} · {item.sectors.join(", ")} · {item.authorLabel} · sent {when(item.submittedAt)}</p>
            {item.duplicates.length > 0 && (
              <div className="mod-dup" role="note" aria-labelledby={`dup-${item.id}`}>
                <strong id={`dup-${item.id}`}>Possible duplicate{item.duplicates.length === 1 ? "" : "s"} already live in the same sector</strong>
                <ul>
                  {item.duplicates.map((d) => (
                    <li key={d.id}><a href={`/moderation?status=${d.status}&item=${d.id}`}>#{d.id} {d.title}</a> <span className="mod-meta">· {d.statusLabel} · {d.exact ? "same title" : `${Math.round(d.similarity * 100)}% similar`}</span></li>
                  ))}
                </ul>
                <p className="mod-meta">Approving is blocked until an administrator confirms, with a reason, that this is not a duplicate. Or remove it as a duplicate.</p>
              </div>
            )}
            <dl className="mod-dl">
              <dt>Details</dt><dd>{item.description}</dd>
              {item.sections.map((s) => (<div key={s.label}><dt>{s.label}</dt><dd>{s.text}</dd></div>))}
              {item.role && (<><dt>Role</dt><dd>{item.role}</dd></>)}
              {item.district && (<><dt>District</dt><dd>{item.district}</dd></>)}
            </dl>
            {item.photoList.length > 0 && (
              <div className="mod-photos">
                {item.photoList.map((p) => (
                  <figure key={p.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/review/${item!.id}/photos/${p.id}`} alt={p.alt} />
                    <figcaption>{p.alt}</figcaption>
                  </figure>
                ))}
              </div>
            )}
            {item.contact ? (
              <div className="mod-contact">
                <strong>Contact details (shared with moderators by the author)</strong>
                <div>{item.contact.name}</div>
                {item.contact.email && <div>{item.contact.email}</div>}
                {item.contact.phone && <div>{item.contact.phone}</div>}
              </div>
            ) : (
              <p className="mod-contact mod-contact--none">No contact details are available to you for this contribution.</p>
            )}
            <h3>Decisions so far</h3>
            {item.history.length === 0 ? <p className="mod-meta">None yet.</p> : (
              <ul className="mod-history">
                {item.history.map((h, i) => (<li key={i}><strong>{ACTION_WORDS[h.action] ?? h.action}</strong> · {h.by} · {when(h.at)}{h.note ? <div>{h.note}</div> : null}</li>))}
              </ul>
            )}
            <h3>Replies to the contributor</h3>
            {item.replies.length === 0 ? <p className="mod-meta">None yet.</p> : (
              <ul className="mod-history">
                {item.replies.map((r, i) => (<li key={i}><strong>Reply</strong> · {r.by} · {when(r.at)}<div>{r.text}</div></li>))}
              </ul>
            )}
            <h3>Internal notes (moderators only)</h3>
            {item.notes.length === 0 ? <p className="mod-meta">None yet.</p> : (
              <ul className="mod-history">
                {item.notes.map((n, i) => (<li key={i}><strong>Note</strong> · {n.by} · {when(n.at)}<div>{n.text}</div></li>))}
              </ul>
            )}
            {item.own
              ? <p className="mod-note">This is your own contribution, so another reviewer has to decide on it.</p>
              : (<>
                  <DecisionForm id={item.id} actions={item.actions} isAdmin={me.isAdmin} hasDuplicates={item.duplicates.length > 0} />
                  <ReplyNoteForm id={item.id} kind="reply" />
                  <ReplyNoteForm id={item.id} kind="note" />
                </>)}
          </article>
        )}
      </section>
    </main>
  );
}
