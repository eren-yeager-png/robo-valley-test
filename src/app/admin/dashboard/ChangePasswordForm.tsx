"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function ChangePasswordForm() {
  const router = useRouter();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busyRef.current) return; // block double submits
    if (!current || !next) return setError("Enter your current and new password.");
    if (next.length < 8) return setError("The new password must have at least 8 characters.");
    if (next !== confirm) return setError("The new passwords do not match.");
    busyRef.current = true; setBusy(true); setError("");
    try {
      const res = await fetch("/api/admin/change-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) { router.refresh(); return; } // the server now renders the dashboard
      setError(data.message ?? "Something went wrong. Please try again.");
      setCurrent(""); setNext(""); setConfirm("");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    }
    busyRef.current = false; setBusy(false);
  }

  return (
    <div className="auth-card" style={{ margin: "0 auto" }}>
      <div>
        <h1>Choose a new password</h1>
        <p className="muted" style={{ marginTop: 6 }}>Your account was created with a temporary password. Set your own to continue.</p>
      </div>
      <form onSubmit={onSubmit} noValidate aria-busy={busy}>
        <label className="f"><span className="req">Current password</span>
          <input type="password" name="current-password" autoComplete="current-password" value={current} maxLength={128} onChange={(e) => { setCurrent(e.target.value); setError(""); }} />
        </label>
        <label className="f"><span className="req">New password</span>
          <input type="password" name="new-password" autoComplete="new-password" value={next} maxLength={128} onChange={(e) => { setNext(e.target.value); setError(""); }} />
          <small>Use at least 8 characters.</small>
        </label>
        <label className="f"><span className="req">Confirm new password</span>
          <input type="password" name="confirm-new-password" autoComplete="new-password" value={confirm} maxLength={128} onChange={(e) => { setConfirm(e.target.value); setError(""); }} />
        </label>
        {error && <p role="alert" className="fe">{error}</p>}
        <button type="submit" className="btn primary block" disabled={busy}>{busy ? "Saving…" : "Save new password"}</button>
      </form>
    </div>
  );
}
