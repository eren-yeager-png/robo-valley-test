"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { normalizeEmail } from "../../lib/validation";
import "../join/join.css";
import "./login.css";

type Errors = Record<string, string>;

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  const clear = (k: string) => { setFormError(""); setErrors((p) => { if (!p[k]) return p; const n = { ...p }; delete n[k]; return n; }); };
  const ea = (k: string) => ({ "aria-invalid": errors[k] ? true : undefined, "aria-describedby": errors[k] ? `e-${k}` : undefined } as const);
  const Err = (k: string) => (errors[k] ? <span className="fe" id={`e-${k}`}>{errors[k]}</span> : null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busyRef.current) return; // block accidental double submits
    const v: Errors = {};
    if (!email.trim()) v.email = "Enter your email address.";
    else if (!normalizeEmail(email)) v.email = "Enter a valid email address.";
    if (!password) v.password = "Enter your password.";
    if (Object.keys(v).length) { setErrors(v); (v.email ? emailRef : pwRef).current?.focus(); return; } // inline errors only; focus the first invalid field

    busyRef.current = true; setBusy(true); setFormError(""); setErrors({});
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, remember }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        const to = typeof data.redirectTo === "string" && data.redirectTo.startsWith("/") && !data.redirectTo.startsWith("//") ? data.redirectTo : "/dashboard";
        router.replace(to);
        router.refresh();
        return; // keep the button disabled while navigating
      }
      if (data.fieldErrors) setErrors(data.fieldErrors);
      setFormError(data.message ?? "Something went wrong. Please try again.");
      setPassword(""); // keep the email, clear the password after a failed attempt
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
    }
    busyRef.current = false; setBusy(false);
  }

  return (
    <div className="rv">
      <main className="auth">
        <div className="auth-card">
          <div className="brand">RoboValley Community<small>Sign in</small></div>
          <div>
            <h1>Welcome back</h1>
            <p className="muted" style={{ marginTop: 6 }}>Sign in to your RoboValley account to continue.</p>
          </div>

          <form onSubmit={onSubmit} noValidate aria-busy={busy}>
            <label className="f"><span className="req">Email address</span>
              <input ref={emailRef} type="email" name="email" autoComplete="email" inputMode="email" value={email} maxLength={254}
                onChange={(e) => { setEmail(e.target.value); clear("email"); }} {...ea("email")} />
              {Err("email")}
            </label>

            <label className="f"><span className="req">Password</span>
              <span className="pw">
                <input ref={pwRef} id="login-password" type={show ? "text" : "password"} name="password" autoComplete="current-password" value={password} maxLength={128}
                  onChange={(e) => { setPassword(e.target.value); clear("password"); }} {...ea("password")} />
                <button type="button" className="toggle" onClick={() => setShow((s) => !s)} aria-pressed={show} aria-controls="login-password">
                  {show ? "Hide" : "Show"}<span className="sr"> password</span>
                </button>
              </span>
              {Err("password")}
            </label>

            <div className="row">
              <label className="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember me on this device</label>
              <span className="soon" aria-disabled="true">Forgot password?<small>Coming soon</small></span>
            </div>

            <p className="err" role="alert">{formError}</p>
            <button type="submit" className="btn primary block" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          </form>

          <p className="alt">Don't have an account? <Link href="/join">Sign up</Link></p>
        </div>
      </main>
    </div>
  );
}
