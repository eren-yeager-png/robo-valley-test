"use client";

import { useState } from "react";
import Link from "next/link";
import { normalizeEmail } from "../../lib/validation";
import "../join/join.css";
import "../login/login.css";

export default function ForgotForm({ available }: { available: boolean }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!normalizeEmail(email)) { setError("Enter a valid email address."); return; }
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/auth/password/forgot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.success) setDone(body.message);
      else setError(body.message ?? "Something went wrong. Please try again.");
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rv">
      <main className="auth">
        <div className="auth-card">
          <div className="brand">RoboValley Community<small>Password reset</small></div>
          <div>
            <h1>Forgot your password?</h1>
            {available && !done && <p className="muted" style={{ marginTop: 6 }}>Enter the email address of your account. We will send you a link to choose a new password.</p>}
          </div>
          {!available && <div className="box info" role="status">Password reset is not available yet. Please contact us if you cannot sign in.</div>}
          {available && done && <div className="box ok" role="status">{done}</div>}
          {available && !done && (
            <form method="post" onSubmit={onSubmit} noValidate aria-busy={busy}>
              <label className="f" htmlFor="forgot-email"><span className="req">Email address</span>
                <input id="forgot-email" type="email" name="email" autoComplete="username" inputMode="email" value={email} maxLength={254}
                  onChange={(e) => { setEmail(e.target.value); setError(""); }} aria-invalid={error ? true : undefined} aria-describedby={error ? "forgot-err" : undefined} />
              </label>
              <p className="err" id="forgot-err" role="alert">{error}</p>
              <button type="submit" className="btn primary block" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
            </form>
          )}
          <p className="alt"><Link href="/login">Back to sign in</Link></p>
        </div>
      </main>
    </div>
  );
}
