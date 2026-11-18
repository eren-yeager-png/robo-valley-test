"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RobotType } from "../../../../lib/sectorForms";

type Change = { name: string } | { active: boolean } | { move: "up" | "down" };

/** The robot types of one sector: add, rename, move, switch off/on. Calls the admin-only routes; the server decides everything. */
export default function RobotTypesEditor({ sector, sectorName, robots }: { sector: string; sectorName: string; robots: RobotType[] }) {
  const router = useRouter();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  async function send(url: string, method: "POST" | "PATCH", body: unknown, done: string): Promise<boolean> {
    if (busyRef.current) return false; // no double submits
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
  const base = `/api/admin/sector-forms/${encodeURIComponent(sector)}/robots`;
  const change = (r: RobotType, c: Change, done: string) => send(`${base}/${r.id}`, "PATCH", c, done);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (await send(base, "POST", { name: newName }, `Added "${newName.replace(/\s+/g, " ").trim()}".`)) setNewName("");
  }
  async function rename(r: RobotType) {
    if (await change(r, { name: editName }, "Name saved.")) setEditing(null);
  }

  return (
    <div className="adm-robots">
      <div className="adm-tablewrap" tabIndex={0} role="region" aria-label={`Robot types of ${sectorName}`}>
        <table className="adm-table">
          <caption className="sr">Robot types of {sectorName}</caption>
          <thead><tr><th scope="col">Order</th><th scope="col">Robot type</th><th scope="col">Link code</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
          <tbody>
            {robots.length === 0 && <tr><td colSpan={5} className="muted">No robot types yet. Add the first one below.</td></tr>}
            {robots.map((r, i) => (
              <tr key={r.id}>
                <td className="c-order"><div className="row-actions">
                  <button type="button" className="btn" onClick={() => change(r, { move: "up" }, "Order saved.")} disabled={busy || i === 0} aria-label={`Move ${r.name} up`}>↑</button>
                  <button type="button" className="btn" onClick={() => change(r, { move: "down" }, "Order saved.")} disabled={busy || i === robots.length - 1} aria-label={`Move ${r.name} down`}>↓</button>
                </div></td>
                <th scope="row" className="c-name">
                  {editing === r.id ? (
                    <input type="text" value={editName} maxLength={80} onChange={(e) => { setEditName(e.target.value); setError(""); }} aria-label={`New name for ${r.name}`}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); rename(r); } if (e.key === "Escape") setEditing(null); }} autoFocus />
                  ) : r.name}
                </th>
                <td className="c-code"><code>{r.slug}</code></td>
                <td className="c-status">{r.active ? <span className="adm-pill">On</span> : <span className="adm-pill mute">Off</span>}</td>
                <td className="c-actions"><div className="row-actions">
                  {editing === r.id ? (
                    <>
                      <button type="button" className="btn primary" onClick={() => rename(r)} disabled={busy}>Save</button>
                      <button type="button" className="btn" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn" onClick={() => { setEditing(r.id); setEditName(r.name); setError(""); setSaved(""); }} disabled={busy} aria-label={`Rename ${r.name}`}>Rename</button>
                      <button type="button" className="btn" onClick={() => change(r, { active: !r.active }, r.active ? `${r.name} is off.` : `${r.name} is on.`)} disabled={busy}
                        aria-label={(r.active ? "Switch off " : "Switch on ") + r.name}>{r.active ? "Switch off" : "Switch on"}</button>
                    </>
                  )}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form method="post" className="adm-filters" onSubmit={add} style={{ marginTop: 14 }}>
        <label>New robot type (as on the robot card)
          <input type="text" name="robot-name" value={newName} maxLength={80} placeholder="e.g. Drone sprayers" onChange={(e) => { setNewName(e.target.value); setError(""); }} />
        </label>
        <button type="submit" className="btn primary" disabled={busy || !newName.trim()}>{busy ? "Saving..." : "Add robot type"}</button>
      </form>
      <p className="adm-msg err" role="alert">{error}</p>
      <p className="adm-msg" aria-live="polite">{saved}</p>
    </div>
  );
}
