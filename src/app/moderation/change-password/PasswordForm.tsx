"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

/** The first sign-in of a seeded moderator account: replace the temporary password, then open the Admin Portal. */
export default function PasswordForm() {
  const router = useRouter();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busyRef.current) return;
    if (!current || !next) return setError("Enter your current and new password.");
    if (next.length < 8) return setError("The new password must have at least 8 characters.");
    if (next !== confirm) return setError("The new passwords do not match.");
    busyRef.current = true; setBusy(true); setError("");
    try {
      const res = await fetch("/api/review/change-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) { router.replace("/moderation"); router.refresh(); return; } // the server renders the portal (and its links) again
      setError(data.message ?? "Something went wrong. Please try again.");
      setCurrent(""); setNext(""); setConfirm("");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    }
    busyRef.current = false; setBusy(false);
  }

  return (
    <form className="mod-card mod-act" method="post" onSubmit={onSubmit} noValidate aria-busy={busy} style={{ maxWidth: 460 }}>
      <label htmlFor="pw-current">Current (temporary) password</label>
      <input id="pw-current" className="mod-input" type="password" autoComplete="current-password" maxLength={128} value={current} onChange={(e) => { setCurrent(e.target.value); setError(""); }} />
      <label htmlFor="pw-new">New password</label>
      <input id="pw-new" className="mod-input" type="password" autoComplete="new-password" maxLength={128} aria-describedby="pw-hint" value={next} onChange={(e) => { setNext(e.target.value); setError(""); }} />
      <p id="pw-hint" className="mod-small">At least 8 characters.</p>
      <label htmlFor="pw-confirm">Confirm the new password</label>
      <input id="pw-confirm" className="mod-input" type="password" autoComplete="new-password" maxLength={128} value={confirm} onChange={(e) => { setConfirm(e.target.value); setError(""); }} />
      {error && <p role="alert" className="mod-note">{error}</p>}
      <button type="submit" className="mod-btn mod-btn--primary" disabled={busy}>{busy ? "Saving…" : "Save and open the Admin Portal"}</button>
    </form>
  );
}
