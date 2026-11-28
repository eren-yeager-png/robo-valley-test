"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Sector = { slug: string; name: string };

/**
 * Users & Roles (Contribution Portal, migration 030): the sectors a moderator reviews. "Every sector" (no limit) or a list; "Edit sectors"
 * opens the checkboxes. Calls the admin-only route; the server decides and writes the Audit Log. Administrators always review every sector.
 */
export default function ModeratorSectors({ userId, name, sectors, current }: { userId: string; name: string; sectors: Sector[]; current: Sector[] }) {
  const router = useRouter();
  const busyRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>(current.map((s) => s.slug));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const listId = `rv-ms-${userId}`;

  async function save() {
    if (busyRef.current) return; // no double submits
    busyRef.current = true; setBusy(true); setError("");
    try {
      const res = await fetch("/api/admin/moderators/sectors", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, sectors: picked }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) { setOpen(false); router.refresh(); return; }
      setError(typeof data.message === "string" && data.message ? data.message : "We could not save the change. Please try again.");
    } catch {
      setError("We could not reach the server. Please try again.");
    } finally {
      busyRef.current = false; setBusy(false);
    }
  }
  const toggle = (slug: string) => setPicked((p) => (p.includes(slug) ? p.filter((x) => x !== slug) : [...p, slug]));

  return (
    <div className="rv-ms">
      <p className="adm-sub">Reviews: {current.length ? current.map((s) => s.name).join(", ") : "every sector"}</p>
      <button type="button" className="btn" aria-expanded={open} aria-controls={listId} onClick={() => { setOpen(!open); setPicked(current.map((s) => s.slug)); setError(""); }}
        aria-label={`Edit the sectors ${name} reviews`}>
        {open ? "Close" : "Edit sectors"}
      </button>
      {open && (
        <fieldset id={listId} className="rv-ms-list">
          <legend>Sectors {name} reviews (none ticked = every sector)</legend>
          {sectors.map((s) => (
            <label key={s.slug} className="rv-ms-item"><input type="checkbox" checked={picked.includes(s.slug)} onChange={() => toggle(s.slug)} /> {s.name}</label>
          ))}
          <div className="rv-ms-actions">
            <button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving..." : "Save"}</button>
            <button type="button" className="btn" onClick={() => setPicked([])} disabled={busy}>Every sector</button>
          </div>
        </fieldset>
      )}
      {error && <p className="adm-sub" role="alert">{error}</p>}
    </div>
  );
}
