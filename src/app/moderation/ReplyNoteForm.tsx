"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const TEXT = {
  reply: { label: "Reply to the contributor (they read it under My Contributions)", button: "Send reply", field: "message", min: 3, max: 2000, done: "Reply sent.", short: "Write the reply (at least 3 characters)." },
  note: { label: "Internal note (moderators only, never shown to the contributor)", button: "Save note", field: "note", min: 3, max: 1000, done: "Note saved.", short: "Write the note (at least 3 characters)." },
} as const;

/** The Reply box or the Internal note box for one item. The server checks everything again and records who and when. */
export default function ReplyNoteForm({ id, kind }: { id: number; kind: "reply" | "note" }) {
  const t = TEXT[kind];
  const router = useRouter();
  const box = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function send() {
    const text = box.current?.value.trim() ?? "";
    if (text.length < t.min) { setErr(t.short); box.current?.focus(); return; }
    setErr(""); setMsg(null); setBusy(true);
    try {
      const r = await fetch(`/api/review/${id}/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [t.field]: text }) });
      const b = await r.json().catch(() => null);
      if (r.ok && b?.success) {
        setMsg({ kind: "ok", text: t.done });
        if (box.current) box.current.value = "";
        router.refresh();
      } else if (b?.fieldErrors?.[t.field]) {
        setErr(b.fieldErrors[t.field]); box.current?.focus();
      } else {
        setMsg({ kind: "err", text: b?.message ?? "Something went wrong. Nothing was saved." });
      }
    } catch {
      setMsg({ kind: "err", text: "We could not reach the server. Nothing was saved." });
    } finally { setBusy(false); }
  }

  const fid = `${kind}-${id}`;
  return (
    <div className="mod-act">
      <label htmlFor={fid}>{t.label}</label>
      <textarea id={fid} ref={box} maxLength={t.max} aria-invalid={err ? "true" : undefined} aria-describedby={`${fid}-err`} />
      <div id={`${fid}-err`} className="mod-msg mod-msg--err" role="alert" hidden={!err}>{err}</div>
      <div className="mod-row">
        <button type="button" className={"mod-btn" + (kind === "reply" ? " mod-btn--primary" : "")} disabled={busy} onClick={send}>{t.button}</button>
      </div>
      <div className={"mod-msg " + (msg?.kind === "err" ? "mod-msg--err" : "mod-msg--ok")} role="status" aria-live="polite" hidden={!msg}>{msg?.text}</div>
    </div>
  );
}
