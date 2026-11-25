"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { activityHref } from "./activityHref";

export type EventCard = { type: string; label: string; value: number };

/**
 * The stat cards of the Login activity page, as buttons: a click shows the events behind that number in the table below, and a click on
 * the selected card shows all events again. The selected type lives only in the address (?event=otp_failed&range=30), like the chips',
 * so cards, chips, a shared link and a refresh always agree. The period is kept.
 */
export default function EventCards({ cards, active, days, tableId }: { cards: EventCard[]; active: string; days: number; tableId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const scrollNext = useRef(false); // set by a click on a card; a chip, a link or Back must not move the page

  // After the table has been filtered (the new type has arrived from the server), bring it into view.
  useEffect(() => {
    if (!scrollNext.current) return;
    scrollNext.current = false;
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(tableId)?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
  }, [active, tableId]);

  function choose(type: string) {
    scrollNext.current = true;
    startTransition(() => router.push(activityHref(days, type === active ? "" : type), { scroll: false }));
  }

  return (
    <div className="adm-grid" role="group" aria-label="Events by type: choose one to filter the table" aria-busy={pending}>
      {cards.map((c) => (
        <button key={c.type} type="button" className="adm-card stat" aria-pressed={c.type === active} aria-controls={tableId} onClick={() => choose(c.type)}>
          <span className="lbl">{c.label}</span>
          <span className="val">{c.value.toLocaleString("en-IN")}</span>
        </button>
      ))}
    </div>
  );
}
