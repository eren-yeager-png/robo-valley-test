"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const LABEL: Record<string, string> = { approve: "Approve and publish", request_changes: "Request changes", reject: "Reject", unpublish: "Unpublish", republish: "Publish again" };
const NEEDS_NOTE = new Set(["request_changes", "reject", "unpublish"]);

/** The decision buttons for one item. A note is required for the three decisions the author reads about. The server checks everything again. */
export default function DecisionForm({ id, actions }: { id: number; actions: string[] }) {
  const router = useRouter();
  const note = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [noteErr, setNoteErr] = useState("");

  async function go(action: string) {
    const text = note.current?.value.trim() ?? "";
    if (NEEDS_NOTE.has(action) && text.length < 3) {
      setNoteErr("Write a short note for the author (at least 3 characters).");
      note.current?.focus();
      return;
    }
    setNoteErr(""); setMsg(null); setBusy(true);
    try {
      const r = await fetch(`/api/review/${id}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, note: text }) });
      const b = await r.json().catch(() => null);
      if (r.ok && b?.success) {
        setMsg({ kind: "ok", text: "Done. The decision is saved." });
        if (note.current) note.current.value = "";
        router.refresh();
      } else if (b?.fieldErrors?.note) {
        setNoteErr(b.fieldErrors.note); note.current?.focus();
      } else {
        setMsg({ kind: "err", text: b?.message ?? "Something went wrong. Nothing was changed." });
      }
    } catch {
      setMsg({ kind: "err", text: "We could not reach the server. Nothing was changed." });
    } finally { setBusy(false); }
  }

  if (actions.length === 0) return <p className="mod-note">No decision can be made on this contribution in its current state.</p>;
  return (
    <div className="mod-act">
      <label htmlFor={`note-${id}`}>Note for the author (required to request changes, reject or unpublish)</label>
      <textarea id={`note-${id}`} ref={note} maxLength={1000} aria-invalid={noteErr ? "true" : undefined} aria-describedby={`note-${id}-err`} />
      <div id={`note-${id}-err`} className="mod-msg mod-msg--err" role="alert" hidden={!noteErr}>{noteErr}</div>
      <div className="mod-row">
        {actions.map((a) => (
          <button key={a} type="button" disabled={busy} className={"mod-btn" + (a === "approve" || a === "republish" ? " mod-btn--primary" : a === "reject" || a === "unpublish" ? " mod-btn--danger" : "")} onClick={() => go(a)}>{LABEL[a] ?? a}</button>
        ))}
      </div>
      <div className={"mod-msg " + (msg?.kind === "err" ? "mod-msg--err" : "mod-msg--ok")} role="status" aria-live="polite" hidden={!msg}>{msg?.text}</div>
    </div>
  );
}
