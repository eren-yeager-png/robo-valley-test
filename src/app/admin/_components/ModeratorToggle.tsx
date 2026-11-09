"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** One button on the Users page: make this person a moderator, or remove the flag. Calls the admin-only route; the server decides. */
export default function ModeratorToggle({ userId, name, moderator, self }: { userId: string; name: string; moderator: boolean; self: boolean }) {
  const router = useRouter();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onClick() {
    if (busyRef.current || self) return; // no double submits, and never your own flag
    busyRef.current = true; setBusy(true); setError("");
    try {
      const res = await fetch("/api/admin/moderators", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, moderator: !moderator }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) { router.refresh(); return; }
      setError(typeof data.message === "string" && data.message ? data.message : "We could not save the change. Please try again.");
    } catch {
      setError("We could not reach the server. Please try again.");
    } finally {
      busyRef.current = false; setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" className={"btn" + (moderator ? "" : " primary")} onClick={onClick} disabled={busy || self}
        title={self ? "You cannot change your own moderator flag" : undefined}
        aria-label={(moderator ? "Remove moderator flag from " : "Make a moderator: ") + name}>
        {busy ? "Saving..." : moderator ? "Remove moderator" : "Make moderator"}
      </button>
      {self && <p className="adm-sub">Your own flag cannot be changed.</p>}
      {error && <p className="adm-sub" role="alert">{error}</p>}
    </div>
  );
}
