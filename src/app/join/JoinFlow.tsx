"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GROUPS, GUARDIAN_RELATIONSHIPS, LANGUAGES, MINOR_ALLOWED_ROLES, ROLE_FIELDS, ROLES } from "../../lib/roles";
import { VALUE } from "../../lib/roleValue";
import { normalizeEmail, normalizeMobile } from "../../lib/validation";
import "./join.css";

type Purpose = "signup" | "guardian";
type Form = {
  role: string; fullName: string; mobile: string; email: string; password: string; confirmPassword: string;
  district: string; language: string; ageCategory: "" | "adult" | "minor";
  gName: string; gRel: string; gMobile: string; gEmail: string; gAgreed: boolean;
  consent: { privacy: boolean; terms: boolean; whatsapp: boolean; email: boolean; photo: boolean };
  profile: Record<string, string | string[]>;
};
type Errors = Record<string, string>;
// devOtp exists only when the server runs the development mock provider; with Resend it is never sent.
type OtpInfo = { devOtp?: string; cooldownUntil: number; emailSent?: boolean };
type Tokens = Partial<Record<Purpose, { token: string; email: string }>>;

const EMPTY: Form = {
  role: "", fullName: "", mobile: "", email: "", password: "", confirmPassword: "", district: "", language: "Telugu",
  ageCategory: "", gName: "", gRel: "", gMobile: "", gEmail: "", gAgreed: false,
  consent: { privacy: false, terms: false, whatsapp: false, email: false, photo: false }, profile: {},
};

const STEP_NAMES: Record<string, string> = {
  role: "Choose your role", details: "Your details", otp: "Verify email", parent: "Parent / guardian",
  pconsent: "Parent's consent", consent: "Privacy and consent", profile: "About you", welcome: "Welcome",
};

// which step shows which server field error
const stepOfField = (f: string) =>
  f === "role" ? "role"
  : f.startsWith("guardian") ? "parent"
  : f === "consents" ? "consent"
  : f.startsWith("profile") ? "profile"
  : "details";

async function postJson(url: string, body: unknown) {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } catch {
    return { status: 0, data: { message: "Could not reach the server. Check your connection and try again." } };
  }
}

export default function JoinFlow() {
  const router = useRouter();
  const [f, setF] = useState<Form>(EMPTY);
  const [stepId, setStepId] = useState("role");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [tokens, setTokens] = useState<Tokens>({});
  const [otpInfo, setOtpInfo] = useState<Partial<Record<Purpose, OtpInfo>>>({});
  const [createdName, setCreatedName] = useState("");
  const [openValue, setOpenValue] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const isMinor = f.ageCategory === "minor";
  const steps = isMinor
    ? ["role", "details", "otp", "parent", "pconsent", "consent", "profile", "welcome"]
    : ["role", "details", "otp", "consent", "profile", "welcome"];
  const idx = Math.max(0, steps.indexOf(stepId));
  const roleName = (ROLES.find((r) => r[0] === f.role) ?? [, "member"])[1] as string;

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    headingRef.current?.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [stepId]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    setErrors((p) => { if (!p[k as string]) return p; const n = { ...p }; delete n[k as string]; return n; });
    setFormError("");
  };
  const go = (id: string) => { setErrors({}); setFormError(""); setStepId(id); };
  const next = () => go(steps[Math.min(idx + 1, steps.length - 1)]);
  const back = () => go(steps[Math.max(idx - 1, 0)]);

  // ---- OTP plumbing (server issues and checks everything) ----
  async function sendOtp(purpose: Purpose, emailAddr: string): Promise<boolean> {
    const email = normalizeEmail(emailAddr)!;
    const { status, data } = await postJson("/api/auth/otp/request", { email, purpose, ...(purpose === "guardian" ? { studentEmail: normalizeEmail(f.email) } : {}) });
    if (data.success) {
      setOtpInfo((p) => ({ ...p, [purpose]: { devOtp: data.devOtp, emailSent: data.emailSent === true, cooldownUntil: Date.now() + (data.resendAfterSeconds ?? 30) * 1000 } }));
      return true;
    }
    if (status === 429 && data.error === "RESEND_COOLDOWN") { // a code was already sent a moment ago
      setOtpInfo((p) => ({ ...p, [purpose]: { devOtp: p[purpose]?.devOtp, emailSent: p[purpose]?.emailSent ?? true, cooldownUntil: Date.now() + (data.retryAfterSeconds ?? 30) * 1000 } }));
      return true;
    }
    setFormError(data.message ?? "Could not send the code. Please try again.");
    return false;
  }
  async function verifyCode(purpose: Purpose, emailAddr: string, code: string): Promise<boolean> {
    const email = normalizeEmail(emailAddr)!;
    const { data } = await postJson("/api/auth/otp/verify", { email, purpose, code });
    if (data.success) {
      setTokens((p) => ({ ...p, [purpose]: { token: data.verificationToken, email } }));
      return true;
    }
    setFormError(data.message ?? "Could not verify the code.");
    return false;
  }
  const isVerified = (p: Purpose, emailAddr: string) => { const e = normalizeEmail(emailAddr); return !!e && tokens[p]?.email === e; };

  // ---- per-step validation (the server re-validates everything) ----
  function validate(id: string): Errors {
    const e: Errors = {};
    if (id === "role" && !f.role) e.role = "Choose a role to continue.";
    if (id === "details") {
      if (!f.fullName.trim()) e.fullName = "Enter your full name.";
      if (!normalizeMobile(f.mobile)) e.mobile = "Enter a 10-digit mobile number starting with 6, 7, 8 or 9.";
      if (!f.email.trim()) e.email = "Enter your email address.";
      else if (!normalizeEmail(f.email)) e.email = "Enter a valid email address.";
      if (f.password.length < 8) e.password = "Password must contain at least 8 characters.";
      else if (f.password !== f.confirmPassword) e.confirmPassword = "Passwords do not match.";
      if (!f.district.trim()) e.district = "Enter your district.";
      if (!f.ageCategory) e.ageCategory = "Tell us whether you are 18 or older.";
      else if (f.ageCategory === "minor" && !MINOR_ALLOWED_ROLES.includes(f.role)) e.ageCategory = "Members under 18 can join only as a student.";
    }
    if (id === "parent") {
      if (!f.gName.trim()) e["guardian.name"] = "Enter your parent's name.";
      if (!f.gRel) e["guardian.relationship"] = "Choose the relationship.";
      const gm = normalizeMobile(f.gMobile);
      if (!gm) e["guardian.mobile"] = "Enter a valid 10-digit mobile number for your parent.";
      else if (gm === normalizeMobile(f.mobile)) e["guardian.mobile"] = "Your parent's number must be different from yours.";
      const ge = normalizeEmail(f.gEmail);
      if (!ge) e["guardian.email"] = "Enter a valid email address for your parent.";
      else if (ge === normalizeEmail(f.email)) e["guardian.email"] = "Your parent's email must be different from yours.";
    }
    if (id === "consent" && !(f.consent.privacy && f.consent.terms)) e.consents = "Please agree to the Privacy Notice, Terms of Use and Community Rules to continue.";
    if (id === "profile") {
      for (const q of ROLE_FIELDS[f.role] ?? []) {
        const v = f.profile[q.key];
        if (q.required && (!v || (Array.isArray(v) && !v.length))) e[`profile.${q.key}`] = `Please answer: ${q.label}.`;
      }
    }
    return e;
  }
  const run = async (fn: () => Promise<void>) => {
    if (busyRef.current) return; // blocks accidental double submits
    busyRef.current = true; setBusy(true); setFormError("");
    try { await fn(); } finally { busyRef.current = false; setBusy(false); }
  };

  async function onNext() {
    const e = validate(stepId);
    if (Object.keys(e).length) { setErrors(e); setFormError(Object.values(e)[0]); return; }
    if (stepId === "details") {
      return run(async () => {
        if (!isVerified("signup", f.email) && !(await sendOtp("signup", f.email))) return;
        next();
      });
    }
    if (stepId === "parent") {
      return run(async () => {
        if (!isVerified("guardian", f.gEmail) && !(await sendOtp("guardian", f.gEmail))) return;
        next();
      });
    }
    next();
  }

  async function submit(skipProfile: boolean) {
    if (!skipProfile) {
      const e = validate("profile");
      if (Object.keys(e).length) { setErrors(e); setFormError(Object.values(e)[0]); return; }
    }
    await run(async () => {
      const payload = {
        role: f.role, fullName: f.fullName, mobile: f.mobile, email: f.email, password: f.password, confirmPassword: f.confirmPassword,
        district: f.district, language: f.language, ageCategory: f.ageCategory,
        ...(isMinor ? { guardian: { name: f.gName, relationship: f.gRel, mobile: f.gMobile, email: f.gEmail } } : {}),
        consents: f.consent,
        ...(skipProfile ? { profileSkipped: true } : { profile: f.profile }),
        verification: { signup: tokens.signup?.token, guardian: isMinor ? tokens.guardian?.token : undefined },
      };
      const { status, data } = await postJson("/api/auth/signup", payload);
      if (data.success) {
        setCreatedName(f.fullName);
        setF((p) => ({ ...p, password: "", confirmPassword: "" }));
        setTokens({});
        go("welcome");
        return;
      }
      if (data.fieldErrors) {
        setErrors(data.fieldErrors);
        const first = Object.keys(data.fieldErrors)[0];
        setStepId(stepOfField(first));
      }
      if (status === 403 && data.error === "VERIFICATION_REQUIRED") {
        const which: Purpose = data.which === "guardian" ? "guardian" : "signup";
        setTokens((p) => ({ ...p, [which]: undefined }));
        setStepId(which === "guardian" ? "pconsent" : "otp");
      }
      setFormError(data.message ?? "Something went wrong. Please try again.");
    });
  }

  const reset = () => { setF(EMPTY); setTokens({}); setOtpInfo({}); setErrors({}); setFormError(""); setCreatedName(""); setStepId("role"); };

  // ---- small render helpers ----
  const Err = (k: string) => (errors[k] ? <span className="fe" id={`e-${k}`}>{errors[k]}</span> : null);
  const ea = (k: string) => ({ "aria-invalid": errors[k] ? true : undefined, "aria-describedby": errors[k] ? `e-${k}` : undefined } as const);

  const Nav = ({ label, onClick, extra, hideBack }: { label: string; onClick: () => void; extra?: React.ReactNode; hideBack?: boolean }) => (
    <>
      <p className="err" id="err" role="alert">{formError}</p>
      <div className="actions">
        {idx > 0 && !hideBack ? <button type="button" className="btn" onClick={back} disabled={busy}>← Back</button> : <span />}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {extra}
          <button type="button" className="btn primary" onClick={onClick} disabled={busy} aria-busy={busy}>{busy ? "Please wait…" : label}</button>
        </div>
      </div>
    </>
  );

  const Page = () => {
    switch (stepId) {
      case "role":
        return (
          <>
            <h1 ref={headingRef} tabIndex={-1}>Join the RoboValley Community</h1>
            <p className="muted">Choose the one role that fits you best. Tap <b>View value</b> to see what you get. You can add more roles later, after your account is verified.</p>
            <div className="rlist" role="radiogroup" aria-label="Your role" {...ea("role")}>
              {GROUPS.map(([g, codes]) => (
                <div className="rgrp" key={g}>
                  <div className="lbl">{g}</div>
                  {codes.map((c) => {
                    const r = ROLES.find((x) => x[0] === c)!, v = VALUE[c], open = openValue === c;
                    return (
                      <div className={`ritem${f.role === c ? " sel" : ""}`} key={c}>
                        <div className="rhead">
                          <input type="radio" name="role" value={c} id={`rr-${c}`} checked={f.role === c} onChange={() => set("role", c)} />
                          <label htmlFor={`rr-${c}`} style={{ cursor: "pointer" }}><b>{r[1]}</b><span className="hint">{r[2]}</span><p className="tag">{v[0]}</p></label>
                          <button type="button" className="vbtn" aria-expanded={open} aria-controls={`rv-${c}`} onClick={() => setOpenValue(open ? "" : c)}>{open ? "Hide value ▴" : "View value ▾"}</button>
                        </div>
                        <div className="rval" id={`rv-${c}`} hidden={!open}>
                          {open && (<>
                            <div className="lbl">What you get</div>
                            <ul className="vlist">{v[1].map((x) => <li key={x}>{x}</li>)}</ul>
                            <div className="lbl">Your first month</div>
                            <ol className="first">{v[2].map((x) => <li key={x}>{x}</li>)}</ol>
                            <div><button type="button" className="btn primary" onClick={() => { set("role", c); go("details"); }}>Join as {r[1]} →</button></div>
                          </>)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {Err("role")}
            <p className="muted" style={{ fontSize: ".85rem" }}>Already a member? <Link href="/login">Sign in</Link></p>
            {Nav({ label: "Continue", onClick: onNext })}
          </>
        );
      case "details":
        return (
          <>
            <h1 ref={headingRef} tabIndex={-1}>Your details</h1>
            <p className="muted">Joining as <b>{roleName}</b>. Use your email address and password to access your account.</p>
            <div className="grid">
              <label className="f full"><span className="req">Full name</span><input autoComplete="name" value={f.fullName} onChange={(e) => set("fullName", e.target.value)} maxLength={100} {...ea("fullName")} />{Err("fullName")}</label>
              <label className="f"><span className="req">Mobile number</span><input inputMode="numeric" autoComplete="tel-national" maxLength={10} placeholder="10 digits" value={f.mobile} onChange={(e) => set("mobile", e.target.value.replace(/\D/g, ""))} {...ea("mobile")} /><small>For contact. It is not verified by code.</small>{Err("mobile")}</label>
              <label className="f"><span className="req">Email address</span><input type="email" autoComplete="email" value={f.email} onChange={(e) => set("email", e.target.value)} maxLength={254} {...ea("email")} /><small>We'll email a code to verify it</small>{Err("email")}</label>
              <label className="f"><span className="req">Password</span><input type="password" autoComplete="new-password" minLength={8} value={f.password} onChange={(e) => set("password", e.target.value)} {...ea("password")} /><small>Use at least 8 characters.</small>{Err("password")}</label>
              <label className="f"><span className="req">Confirm password</span><input type="password" autoComplete="new-password" minLength={8} value={f.confirmPassword} onChange={(e) => set("confirmPassword", e.target.value)} {...ea("confirmPassword")} />{Err("confirmPassword")}</label>
              <label className="f"><span className="req">District</span><input autoComplete="address-level2" value={f.district} onChange={(e) => set("district", e.target.value)} maxLength={80} {...ea("district")} />{Err("district")}</label>
              <label className="f"><span>Preferred language</span><select value={f.language} onChange={(e) => set("language", e.target.value)}>{LANGUAGES.map((l) => <option key={l}>{l}</option>)}</select></label>
              <fieldset className="full" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="req" style={{ fontWeight: 600, fontSize: ".88rem", marginBottom: 6 }}>Your age</legend>
                <div className="chips">
                  <label className="chip"><input type="radio" name="age" checked={f.ageCategory === "adult"} onChange={() => set("ageCategory", "adult")} />18 or older</label>
                  <label className="chip"><input type="radio" name="age" checked={f.ageCategory === "minor"} onChange={() => set("ageCategory", "minor")} />Under 18</label>
                </div>
                {Err("ageCategory")}
              </fieldset>
            </div>
            <div className="box info">We collect only what is needed to run your account. Details: Privacy Notice (available soon).</div>
            {Nav({ label: "Send code to my email", onClick: onNext })}
          </>
        );
      case "otp":
        return (
          <>
            <h1 ref={headingRef} tabIndex={-1}>Verify your email</h1>
            <p className="muted">Enter the 6-digit code sent to <b>{f.email.trim()}</b>. <button type="button" className="btn link" style={{ padding: 0 }} onClick={() => go("details")}>Change email</button></p>
            {isVerified("signup", f.email)
              ? <><div className="box ok" role="status">✓ Email address verified.</div>{Nav({ label: "Continue", onClick: next })}</>
              : <OtpEntry key={normalizeEmail(f.email) ?? ""} variant="boxes" info={otpInfo.signup} onResend={() => run(async () => void (await sendOtp("signup", f.email)))}
                  onVerify={async (code) => { let ok = false; await run(async () => { ok = await verifyCode("signup", f.email, code); }); if (ok) next(); }}
                  busy={busy} error={formError} back={back} />}
          </>
        );
      case "parent":
        return (
          <>
            <h1 ref={headingRef} tabIndex={-1}>Your parent or guardian</h1>
            <p className="muted">Because you are under 18, a parent or guardian must agree before your account opens. We'll email them a code.</p>
            <div className="grid">
              <label className="f"><span className="req">Parent / guardian name</span><input value={f.gName} onChange={(e) => set("gName", e.target.value)} maxLength={100} {...ea("guardian.name")} />{Err("guardian.name")}</label>
              <label className="f"><span className="req">Relationship</span><select value={f.gRel} onChange={(e) => set("gRel", e.target.value)} {...ea("guardian.relationship")}><option value="">Choose</option>{GUARDIAN_RELATIONSHIPS.map((x) => <option key={x}>{x}</option>)}</select>{Err("guardian.relationship")}</label>
              <label className="f"><span className="req">Their mobile number</span><input inputMode="numeric" maxLength={10} placeholder="Must be different from yours" value={f.gMobile} onChange={(e) => set("gMobile", e.target.value.replace(/\D/g, ""))} {...ea("guardian.mobile")} />{Err("guardian.mobile")}</label>
              <label className="f"><span className="req">Their email address</span><input type="email" autoComplete="off" maxLength={254} placeholder="Must be different from yours" value={f.gEmail} onChange={(e) => set("gEmail", e.target.value)} {...ea("guardian.email")} /><small>We'll email them the code</small>{Err("guardian.email")}</label>
            </div>
            <div className="box info">Until your parent agrees, you can browse projects but cannot chat, book mentors or join teams.</div>
            {Nav({ label: "Send code to parent", onClick: onNext })}
          </>
        );
      case "pconsent":
        return (
          <>
            <h1 ref={headingRef} tabIndex={-1}>Parent's consent</h1>
            <p className="muted">Your parent or guardian needs to enter the code we emailed them.</p>
            <div className="box">Your child <b>{f.fullName || "[child's name]"}</b> wants to join the RoboValley Community as a student.</div>
            <ul style={{ margin: 0, paddingLeft: 20 }} className="muted"><li>We collect: name, class, school, district, and projects your child uploads.</li><li>Contact with adults happens only through moderated channels.</li><li>You can see your child's activity and withdraw consent at any time.</li></ul>
            {isVerified("guardian", f.gEmail)
              ? <><div className="box ok" role="status">✓ Parent's email address verified.</div>{Nav({ label: "Continue", onClick: next })}</>
              : <>
                <OtpEntry key={normalizeEmail(f.gEmail) ?? ""} variant="single" label={`Code sent to ${f.gEmail.trim()}`} info={otpInfo.guardian} onResend={() => run(async () => void (await sendOtp("guardian", f.gEmail)))}
                  onVerify={async (code) => {
                    if (!f.gAgreed) { setFormError("Please tick the box to confirm you are the parent or guardian."); return; }
                    let ok = false; await run(async () => { ok = await verifyCode("guardian", f.gEmail, code); }); if (ok) next();
                  }}
                  busy={busy} error={formError} back={back}
                  before={<label className="check"><input type="checkbox" checked={f.gAgreed} onChange={(e) => set("gAgreed", e.target.checked)} /> <span>I am the parent or legal guardian and I agree to my child joining, as described in the Privacy Notice.</span></label>} />
              </>}
          </>
        );
      case "consent":
        return (
          <>
            <h1 ref={headingRef} tabIndex={-1}>Privacy and consent</h1>
            <p className="muted">Please read and agree to continue. You can change the optional choices at any time in Settings.</p>
            <label className="check"><input type="checkbox" checked={f.consent.privacy} onChange={(e) => set("consent", { ...f.consent, privacy: e.target.checked })} /> <span className="req">I have read the Privacy Notice (version 1.0) and agree to my data being used as described</span></label>
            <label className="check"><input type="checkbox" checked={f.consent.terms} onChange={(e) => set("consent", { ...f.consent, terms: e.target.checked })} /> <span className="req">I agree to the Terms of Use and Community Rules</span></label>
            {Err("consents")}
            <div className="lbl" style={{ marginTop: 6 }}>Optional</div>
            <label className="check"><input type="checkbox" checked={f.consent.whatsapp} onChange={(e) => set("consent", { ...f.consent, whatsapp: e.target.checked })} /> Send me event and challenge updates on WhatsApp</label>
            <label className="check"><input type="checkbox" checked={f.consent.email} onChange={(e) => set("consent", { ...f.consent, email: e.target.checked })} /> Send me a weekly email digest</label>
            <label className="check"><input type="checkbox" checked={f.consent.photo} onChange={(e) => set("consent", { ...f.consent, photo: e.target.checked })} /> RoboValley may feature my projects and photos on its website and social media</label>
            {isMinor && <div className="box warn">Optional choices for under-18s are also shown to your parent.</div>}
            {Nav({ label: "Agree and continue", onClick: onNext })}
          </>
        );
      case "profile": {
        const fields = ROLE_FIELDS[f.role] ?? ROLE_FIELDS.ST;
        const setP = (key: string, v: string | string[]) => { setF((p) => ({ ...p, profile: { ...p.profile, [key]: v } })); setErrors((p) => { const n = { ...p }; delete n[`profile.${key}`]; return n; }); setFormError(""); };
        return (
          <>
            <h1 ref={headingRef} tabIndex={-1}>About you</h1>
            <p className="muted">A few questions for <b>{roleName}</b> so we can show you the right projects, people and opportunities.</p>
            <div className="grid">
              {fields.map((q) => {
                const k = `profile.${q.key}`, v = f.profile[q.key];
                if (q.type === "txt") return <label className={`f${q.label.length > 30 ? " full" : ""}`} key={q.key}><span className={q.required ? "req" : ""}>{q.label}</span><input placeholder={q.hint} maxLength={150} value={(v as string) ?? ""} onChange={(e) => setP(q.key, e.target.value)} {...ea(k)} />{Err(k)}</label>;
                if (q.type === "sel") return <label className="f" key={q.key}><span className={q.required ? "req" : ""}>{q.label}</span><select value={(v as string) ?? ""} onChange={(e) => setP(q.key, e.target.value)} {...ea(k)}><option value="">Choose</option>{q.options.map((o) => <option key={o}>{o}</option>)}</select>{Err(k)}</label>;
                const arr = (v as string[]) ?? [];
                return (
                  <fieldset className="full" style={{ border: 0, padding: 0, margin: 0 }} key={q.key}>
                    <legend className={q.required ? "req" : ""} style={{ fontWeight: 600, fontSize: ".88rem", marginBottom: 6 }}>{q.label}</legend>
                    <div className="chips">{q.options.map((o) => <label className="chip" key={o}><input type="checkbox" checked={arr.includes(o)} onChange={(e) => setP(q.key, e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))} />{o}</label>)}</div>
                    {Err(k)}
                  </fieldset>
                );
              })}
            </div>
            {Nav({ label: "Finish", onClick: () => submit(false), extra: <button type="button" className="btn link" disabled={busy} onClick={() => submit(true)}>Skip for now</button> })}
          </>
        );
      }
      default:
        return (
          <>
            <h1 ref={headingRef} tabIndex={-1}>Welcome to the RoboValley Community, {(createdName || "maker").split(" ")[0]}!</h1>
            <p className="muted">Your account is ready as a <b>{roleName}</b>.</p>
            {isMinor && <div className="box warn">Your parent's consent is still pending. Until it is confirmed you can browse projects but cannot chat, book mentors or join teams.</div>}
            <div><div className="lbl" style={{ marginBottom: 6 }}>Your level</div><div className="levels"><span>L0 Visitor</span><span className="on">L1 Registered</span><span>L2 Verified</span><span>L3 Expertise assessed</span><span>L4 Trusted associate</span></div></div>
            <div className="welcome">
              <div><b>1 · Open your dashboard</b><span className="muted">See projects, events and people matched to you.</span></div>
              <div><b>2 · Get verified</b><span className="muted">Verify your identity or organisation to add roles and offer services.</span></div>
              <div><b>3 · Take part</b><span className="muted">Join a challenge, a club or book a mentor.</span></div>
            </div>
            <div className="box info">Follow RoboValley on LinkedIn, Facebook, Instagram, YouTube, X and WhatsApp for challenge and event news.</div>
            <div className="actions"><button type="button" className="btn" onClick={reset}>Start again</button><button type="button" className="btn primary" onClick={() => router.push("/login")}>Sign in to my dashboard →</button></div>
          </>
        );
    }
  };

  const pct = Math.round((idx / (steps.length - 1)) * 100);
  return (
    <div className="rv">
      <div className="wrap">
        <div className="top"><div className="brand">RoboValley Community<small>Join the community</small></div></div>
        <section className="map" aria-label="Sign-up journey">
          <div className="trackwrap">
            <ol className="track">
              {steps.map((id, k) => {
                const c = k < idx ? "done" : k === idx ? "now" : "todo";
                return (
                  <li key={id} className={`stp ${c}${id === "parent" || id === "pconsent" ? " minor" : ""}`} {...(k === idx ? { "aria-current": "step" as const } : {})}>
                    <span className="dot" aria-hidden="true">{k < idx ? "✓" : k + 1}</span>
                    <span className="nm"><span className="sr">Step {k + 1}: </span>{STEP_NAMES[id]}</span>
                    <span className="st">{c === "done" ? "Done" : c === "now" ? "You are here" : "To do"}</span>
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="status">
            <span>Step <b>{idx + 1} of {steps.length}</b> · {STEP_NAMES[stepId]}</span>
            <div className="meter" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
            <span><b>{idx}</b> done · <b>{steps.length - 1 - idx}</b> to go</span>
          </div>
        </section>
        <div className="frame">
          <div className="page" aria-live="polite">
            <span className="lbl">Step {idx + 1} of {steps.length}</span>
            {Page()}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Six-box (or single-field) code entry with resend countdown. `info.devOtp` exists only when the server runs in dev mock mode. */
function OtpEntry({ variant, info, onResend, onVerify, busy, error, back, before, label }: {
  variant: "boxes" | "single"; info?: OtpInfo; onResend: () => void; onVerify: (code: string) => void; busy: boolean; error: string; back: () => void; before?: React.ReactNode; label?: string;
}) {
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [now, setNow] = useState(() => Date.now());
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  useEffect(() => { refs.current[0]?.focus(); }, []);
  const left = Math.max(0, Math.ceil(((info?.cooldownUntil ?? 0) - now) / 1000));
  const code = digits.join("");

  // after a failed attempt, start fresh
  useEffect(() => { if (error) { setDigits(["", "", "", "", "", ""]); refs.current[0]?.focus(); } }, [error]);

  const paste = (text: string) => {
    const d = text.replace(/\D/g, "").slice(0, 6).split("");
    if (!d.length) return;
    setDigits([...d, ...Array(6 - d.length).fill("")]);
    refs.current[Math.min(d.length, 5)]?.focus();
  };
  const setAt = (i: number, v: string) => {
    const clean = v.replace(/\D/g, "").slice(-1);
    setDigits((p) => p.map((x, k) => (k === i ? clean : x)));
    if (clean && i < 5) refs.current[i + 1]?.focus();
  };

  return (
    <>
      {info?.devOtp && (
        <div className="box warn" role="status">
          <b>Development mock OTP — no email was sent.</b> Test code: <b style={{ fontFamily: "var(--mono)", letterSpacing: ".15em" }}>{info.devOtp}</b>
          <br /><small>Mock verification is for testing only. It does not prove email ownership or real consent.</small>
        </div>
      )}
      {info?.emailSent && !info.devOtp && (
        <div className="box info" role="status">We've emailed you a 6-digit code. It can take a minute to arrive; check your spam folder too.</div>
      )}
      {before}
      {variant === "boxes" ? (
        <div className="otp" role="group" aria-label="6-digit code">
          {digits.map((d, i) => (
            <input key={i} ref={(el) => { refs.current[i] = el; }} inputMode="numeric" autoComplete={i === 0 ? "one-time-code" : "off"} value={d} aria-label={`Digit ${i + 1}`}
              onFocus={(e) => e.target.select()} onPaste={(e) => { e.preventDefault(); paste(e.clipboardData.getData("text")); }}
              onChange={(e) => setAt(i, e.target.value)} onKeyDown={(e) => { if (e.key === "Backspace" && !d && i > 0) refs.current[i - 1]?.focus(); if (e.key === "Enter" && code.length === 6) onVerify(code); }} />
          ))}
        </div>
      ) : (
        <label className="f" style={{ maxWidth: 260, display: "flex", flexDirection: "column", gap: 5, fontWeight: 600, fontSize: ".88rem" }}>
          <span className="req">{label ?? "Code"}</span>
          <input ref={(el) => { refs.current[0] = el; }} inputMode="numeric" maxLength={6} placeholder="6 digits" value={code}
            onChange={(e) => setDigits(e.target.value.replace(/\D/g, "").slice(0, 6).padEnd(6, " ").split("").map((c) => c.trim()))} />
        </label>
      )}
      <p className="muted" style={{ fontSize: ".85rem" }}>
        Didn't get it? <button type="button" className="btn link" onClick={onResend} disabled={busy || left > 0}>Resend code</button>
        <span aria-live="polite">{left > 0 ? ` in ${left}s` : ""}</span>
      </p>
      <p className="err" role="alert">{error}</p>
      <div className="actions">
        <button type="button" className="btn" onClick={back} disabled={busy}>← Back</button>
        <button type="button" className="btn primary" disabled={busy || code.length !== 6} aria-busy={busy} onClick={() => onVerify(code)}>{busy ? "Please wait…" : "Verify"}</button>
      </div>
    </>
  );
}
