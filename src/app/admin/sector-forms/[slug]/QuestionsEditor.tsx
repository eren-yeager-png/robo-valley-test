"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Question } from "../../../../lib/sectorQuestions";

type Change = { label: string } | { options: string[] } | { required: boolean } | { active: boolean } | { move: "up" | "down" };
const ON_MAX = 5, REQUIRED_MAX = 2;
const lines = (t: string) => t.split(/\r?\n/);

/** One sector's questions: add, correct, require, move, switch off/on. Calls the admin-only routes; the server decides everything. */
export default function QuestionsEditor({ sector, sectorName, questions }: { sector: string; sectorName: string; questions: Question[] }) {
  const router = useRouter();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"text" | "choice">("text");
  const [choices, setChoices] = useState("");
  const [required, setRequired] = useState(false);
  const [editing, setEditing] = useState<{ id: number; what: "label" | "options"; text: string } | null>(null);
  const on = questions.filter((q) => q.active).length, req = questions.filter((q) => q.active && q.required).length;

  async function send(url: string, method: "POST" | "PATCH", body: unknown, done: string): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); setError(""); setSaved("");
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (data.success) { setSaved(done); router.refresh(); return true; }
      setError(typeof data.message === "string" && data.message ? data.message : "We could not save the change. Please try again.");
      return false;
    } catch {
      setError("We could not reach the server. Please try again.");
      return false;
    } finally {
      busyRef.current = false; setBusy(false);
    }
  }
  const base = `/api/admin/sector-forms/${encodeURIComponent(sector)}/questions`;
  const change = (q: Question, c: Change, done: string) => send(`${base}/${q.id}`, "PATCH", c, done);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const body = { label, kind, required, ...(kind === "choice" ? { options: lines(choices) } : {}) };
    if (await send(base, "POST", body, "Question added.")) { setLabel(""); setChoices(""); setRequired(false); setKind("text"); }
  }
  async function saveEdit(q: Question) {
    if (!editing) return;
    const ok = editing.what === "label" ? await change(q, { label: editing.text }, "Wording saved.") : await change(q, { options: lines(editing.text) }, "Choices saved.");
    if (ok) setEditing(null);
  }

  return (
    <div className="adm-robots adm-questions">
      <p className="muted" style={{ margin: "0 0 10px" }}>{on} of {ON_MAX} questions on · {req} of {REQUIRED_MAX} required</p>
      <div className="adm-tablewrap" tabIndex={0} role="region" aria-label={`Questions of ${sectorName}`}>
        <table className="adm-table">
          <caption className="sr">Questions of {sectorName}</caption>
          <thead><tr><th scope="col">Order</th><th scope="col">Question</th><th scope="col">Answer</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
          <tbody>
            {questions.length === 0 && <tr><td colSpan={5} className="muted">No questions yet. Add the first one below.</td></tr>}
            {questions.map((q, i) => (
              <tr key={q.id}>
                <td className="c-order"><div className="row-actions">
                  <button type="button" className="btn" onClick={() => change(q, { move: "up" }, "Order saved.")} disabled={busy || i === 0} aria-label={`Move "${q.label}" up`}>↑</button>
                  <button type="button" className="btn" onClick={() => change(q, { move: "down" }, "Order saved.")} disabled={busy || i === questions.length - 1} aria-label={`Move "${q.label}" down`}>↓</button>
                </div></td>
                <th scope="row" className="c-name">
                  {editing?.id === q.id && editing.what === "label" ? (
                    <input type="text" value={editing.text} maxLength={200} aria-label={`New wording for "${q.label}"`} autoFocus
                      onChange={(e) => { setEditing({ ...editing, text: e.target.value }); setError(""); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveEdit(q); } if (e.key === "Escape") setEditing(null); }} />
                  ) : q.label}
                </th>
                <td className="c-code">
                  {q.kind === "text" ? "Short text (up to 500 characters)" : editing?.id === q.id && editing.what === "options" ? (
                    <textarea rows={4} value={editing.text} aria-label={`Choices for "${q.label}", one per line`} onChange={(e) => { setEditing({ ...editing, text: e.target.value }); setError(""); }} />
                  ) : <>Pick one: {q.options?.join(" · ")}</>}
                </td>
                <td className="c-status">
                  {q.active ? <span className="adm-pill">On</span> : <span className="adm-pill mute">Off</span>}{" "}
                  {q.active && (q.required ? <span className="adm-pill warn">Required</span> : <span className="adm-pill mute">Optional</span>)}
                </td>
                <td className="c-actions"><div className="row-actions">
                  {editing?.id === q.id ? (
                    <>
                      <button type="button" className="btn primary" onClick={() => saveEdit(q)} disabled={busy}>Save</button>
                      <button type="button" className="btn" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn" onClick={() => { setEditing({ id: q.id, what: "label", text: q.label }); setError(""); setSaved(""); }} disabled={busy} aria-label={`Edit the wording of "${q.label}"`}>Edit wording</button>
                      {q.kind === "choice" && <button type="button" className="btn" onClick={() => { setEditing({ id: q.id, what: "options", text: (q.options ?? []).join("\n") }); setError(""); setSaved(""); }} disabled={busy} aria-label={`Edit the choices of "${q.label}"`}>Edit choices</button>}
                      {q.active && <button type="button" className="btn" onClick={() => change(q, { required: !q.required }, q.required ? "Now optional." : "Now required.")} disabled={busy} aria-label={(q.required ? "Make optional: " : "Make required: ") + q.label}>{q.required ? "Make optional" : "Make required"}</button>}
                      <button type="button" className="btn" onClick={() => change(q, { active: !q.active }, q.active ? "Switched off." : "Switched on.")} disabled={busy} aria-label={(q.active ? "Switch off: " : "Switch on: ") + q.label}>{q.active ? "Switch off" : "Switch on"}</button>
                    </>
                  )}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form method="post" className="adm-qform" onSubmit={add} style={{ marginTop: 14 }}>
        <label>New question
          <input type="text" name="question-label" value={label} maxLength={200} placeholder="e.g. How many animals does the farm have?" onChange={(e) => { setLabel(e.target.value); setError(""); }} />
        </label>
        <fieldset>
          <legend>Answer</legend>
          <label className="inline"><input type="radio" name="question-kind" value="text" checked={kind === "text"} onChange={() => setKind("text")} /> Short text</label>
          <label className="inline"><input type="radio" name="question-kind" value="choice" checked={kind === "choice"} onChange={() => setKind("choice")} /> Pick one from a list</label>
        </fieldset>
        {kind === "choice" && (
          <label>Choices, one per line (2 to 10)
            <textarea name="question-choices" rows={4} value={choices} onChange={(e) => { setChoices(e.target.value); setError(""); }} />
          </label>
        )}
        <label className="inline"><input type="checkbox" name="question-required" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required (at most {REQUIRED_MAX} per sector)</label>
        <button type="submit" className="btn primary" disabled={busy || !label.trim() || on >= ON_MAX}>{busy ? "Saving..." : "Add question"}</button>
        {on >= ON_MAX && <p className="adm-msg">{ON_MAX} questions are on. Switch one off to add another.</p>}
      </form>
      <p className="adm-msg err" role="alert">{error}</p>
      <p className="adm-msg" aria-live="polite">{saved}</p>
    </div>
  );
}
