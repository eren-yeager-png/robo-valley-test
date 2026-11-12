"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import "../join/join.css";
import "../login/login.css";

type Errors = { password?: string; confirmPassword?: string };

/** The token from a "#token=..." fragment, or null. */
export function tokenFromHash(hash: string): string | null {
  const m = /(?:^#|&)token=([A-Za-z0-9_-]{1,100})(?:&|$)/.exec(hash);
  return m ? m[1] : null;
}

export default function ResetForm() {
  const [token, setToken] = useState<string | null | undefined>(undefined); // undefined = not read yet, null = missing
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);

  // Read the token from the fragment once, keep it in memory only, and remove it from the address bar and history straight away.
  useEffect(() => {
    const t = tokenFromHash(window.location.hash);
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the fragment can only be read in the browser, after the first render
    setToken(t);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !token) return;
    setBusy(true); setErrors({}); setFormError("");
    try {
      const res = await fetch("/api/auth/password/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password, confirmPassword: confirm }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.success) { setDone(body.message); setToken(null); setPassword(""); setConfirm(""); return; }
      if (body.error === "INVALID_TOKEN") { setInvalid(true); return; }
      if (body.fieldErrors) setErrors(body.fieldErrors);
      setFormError(body.message ?? "Something went wrong. Please try again.");
    } catch {
      setFormError("We could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const err = (k: keyof Errors) => (errors[k] ? <span className="fe" id={`reset-${k}-err`} role="alert">{errors[k]}</span> : null);

  return (
    <div className="rv">
      <main className="auth">
        <div className="auth-card">
          <div className="brand">RoboValley Community<small>Password reset</small></div>
          <h1>Choose a new password</h1>
          {done && <><div className="box ok" role="status">{done}</div><Link className="btn primary block" href="/login">Sign in</Link></>}
          {!done && invalid && <div className="box warn" role="alert">This reset link is not valid any more. <Link href="/forgot-password">Ask for a new one</Link>.</div>}
          {!done && !invalid && token === null && <div className="box warn" role="alert">This reset link is incomplete. Open the link from the email again, or <Link href="/forgot-password">ask for a new one</Link>.</div>}
          {!done && !invalid && token && (
            <form method="post" onSubmit={onSubmit} noValidate aria-busy={busy}>
              <label className="f"><span className="req" id="reset-password-label">New password</span>
                <span className="pw">
                  <input id="reset-password" type={show ? "text" : "password"} name="new-password" autoComplete="new-password" value={password} maxLength={128}
                    onChange={(e) => setPassword(e.target.value)} aria-labelledby="reset-password-label" aria-invalid={errors.password ? true : undefined}
                    aria-describedby={errors.password ? "reset-password-err reset-rule" : "reset-rule"} />
                  <button type="button" className="toggle" onClick={() => setShow((s) => !s)} aria-pressed={show} aria-controls="reset-password">{show ? "Hide" : "Show"}<span className="sr"> password</span></button>
                </span>
                <small id="reset-rule">At least 8 characters.</small>
                {err("password")}
              </label>
              <label className="f" htmlFor="reset-confirm"><span className="req" id="reset-confirm-label">Confirm new password</span>
                <input id="reset-confirm" type={show ? "text" : "password"} name="confirm-password" autoComplete="new-password" value={confirm} maxLength={128}
                  onChange={(e) => setConfirm(e.target.value)} aria-labelledby="reset-confirm-label" aria-invalid={errors.confirmPassword ? true : undefined} aria-describedby={errors.confirmPassword ? "reset-confirmPassword-err" : undefined} />
                {err("confirmPassword")}
              </label>
              <p className="err" role="alert">{formError}</p>
              <button type="submit" className="btn primary block" disabled={busy}>{busy ? "Saving…" : "Save new password"}</button>
              <p className="muted" style={{ fontSize: ".85rem" }}>Saving signs you out on every device. Then sign in with the new password.</p>
            </form>
          )}
          <p className="alt"><Link href="/login">Back to sign in</Link></p>
        </div>
      </main>
    </div>
  );
}
