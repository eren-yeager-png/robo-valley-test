"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const LABEL: Record<string, string> = { verify: "Mark as verified", approve: "Approve and publish", request_changes: "Request changes", reject: "Reject", remove: "Remove (duplicate or unsuitable)", unpublish: "Unpublish", republish: "Publish again" };
const NEEDS_NOTE = new Set(["request_changes", "reject", "unpublish", "remove"]);
type Dup = { id: number; title: string; status: string; statusLabel: string };

/** The decision buttons for one item. A note is required for the decisions the author reads about, and for removing. The server checks everything again. */
export default function DecisionForm({ id, actions, isAdmin = false, hasDuplicates = false }: { id: number; actions: string[]; isAdmin?: boolean; hasDuplicates?: boolean }) {
  const router = useRouter();
  const note = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [noteErr, setNoteErr] = useState("");
  const [dups, setDups] = useState<Dup[]>([]);
  const [confirmDup, setConfirmDup] = useState(false);

  async function go(action: string) {
    const text = note.current?.value.trim() ?? "";
    const overriding = action === "approve" && confirmDup;
    if ((NEEDS_NOTE.has(action) || overriding) && text.length < 3) {
      setNoteErr(overriding ? "Write the reason it is not a duplicate (at least 3 characters)." : "Write a short note for the author (at least 3 characters).");
      note.current?.focus();
      return;
    }
    setNoteErr(""); setMsg(null); setBusy(true);
    try {
      const r = await fetch(`/api/review/${id}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, note: text, ...(overriding ? { confirmDuplicate: true } : {}) }) });
      const b = await r.json().catch(() => null);
      if (r.ok && b?.success) {
        setMsg({ kind: "ok", text: "Done. The decision is saved." });
        if (note.current) note.current.value = "";
        router.refresh();
      } else if (b?.error === "DUPLICATE_WARNING") {
        setDups(Array.isArray(b.duplicates) ? b.duplicates : []);
        setMsg({ kind: "err", text: b.message });
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
      {!isAdmin && <p className="mod-meta">Only an administrator can approve, publish, unpublish or remove. You can verify, ask for changes or reject.</p>}
      {isAdmin && (hasDuplicates || dups.length > 0) && actions.includes("approve") && (
        <label className="mod-check">
          <input type="checkbox" checked={confirmDup} onChange={(e) => setConfirmDup(e.target.checked)} />{" "}
          I checked the possible duplicate{dups.length > 1 ? "s" : ""}{dups.length ? ` (${dups.map((d) => "#" + d.id).join(", ")})` : ""} and this is different. The note above is my reason.
        </label>
      )}
      <div className="mod-row">
        {actions.map((a) => (
          <button key={a} type="button" disabled={busy} className={"mod-btn" + (a === "approve" || a === "republish" ? " mod-btn--primary" : a === "reject" || a === "unpublish" ? " mod-btn--danger" : "")} onClick={() => go(a)}>{LABEL[a] ?? a}</button>
        ))}
      </div>
      <div className={"mod-msg " + (msg?.kind === "err" ? "mod-msg--err" : "mod-msg--ok")} role="status" aria-live="polite" hidden={!msg}>{msg?.text}</div>
    </div>
  );
}
