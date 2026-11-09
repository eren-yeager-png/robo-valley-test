import { pool } from "../../lib/db";
import { requireReviewerPage } from "../../lib/reviewerPage";
import { QUEUE_STATUSES, getForReview, listQueue, type QueueItem, type ReviewItem } from "../../lib/contributionReview";
import { STATUS_LABELS, type ContributionStatus } from "../../lib/contributions";
import DecisionForm from "./DecisionForm";

type SP = { status?: string; item?: string };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const ACTION_WORDS: Record<string, string> = { approve: "Approved", request_changes: "Changes requested", reject: "Rejected", unpublish: "Unpublished", republish: "Published again" };

export default async function ModerationPage({ searchParams }: { searchParams?: Promise<SP> } = {}) {
  const me = await requireReviewerPage();
  const sp = (await searchParams) ?? {};
  const status = (QUEUE_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as string) : "pending_review";
  const itemId = /^[1-9]\d{0,9}$/.test(sp.item ?? "") ? Number(sp.item) : null;

  let queue: QueueItem[] = [], item: ReviewItem | null = null, problem = "";
  try {
    queue = await listQueue(pool as never, status);
    if (itemId) item = await getForReview(pool as never, me.userId, itemId, me.isAdmin);
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
                <span className="mod-meta">{[q.typeLabel, q.sectors.join(", "), q.photos ? `${q.photos} photo${q.photos === 1 ? "" : "s"}` : "", when(q.submittedAt)].filter(Boolean).join(" · ")}</span>
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
            <p className="mod-meta">{item.statusLabel} · {item.typeLabel} · {item.sectors.join(", ")} · {item.authorLabel} · sent {when(item.submittedAt)}</p>
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
            {item.own
              ? <p className="mod-note">This is your own contribution, so another reviewer has to decide on it.</p>
              : <DecisionForm id={item.id} actions={item.actions} />}
          </article>
        )}
      </section>
    </main>
  );
}
