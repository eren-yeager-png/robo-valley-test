"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LANGUAGES, type ProfileField } from "../../../lib/roles";

type Errors = Record<string, string>;
type Initial = { fullName: string; district: string; language: string; profile: Record<string, string | string[]> };

// Only name, district, language and the role's own profile answers can be changed. The server
// re-validates everything and decides what is allowed; role and email cannot be edited here.
export default function ProfileForm({ fields, initial, readonly }: {
  fields: ProfileField[]; initial: Initial; readonly: { email: string; role: string; mobile: string; age: string };
}) {
  const router = useRouter();
  const [f, setF] = useState<Initial>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const clear = (k: string) => { setMsg(null); setErrors((p) => { if (!p[k]) return p; const n = { ...p }; delete n[k]; return n; }); };
  const setP = (key: string, v: string | string[]) => { setF((p) => ({ ...p, profile: { ...p.profile, [key]: v } })); clear(`profile.${key}`); };
  const ea = (k: string) => ({ "aria-invalid": errors[k] ? true : undefined, "aria-describedby": errors[k] ? `pe-${k}` : undefined } as const);
  const Err = (k: string) => (errors[k] ? <span className="fe" id={`pe-${k}`}>{errors[k]}</span> : null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setMsg(null); setErrors({});
    try {
      const res = await fetch("/api/account/profile", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: f.fullName, district: f.district, language: f.language, profile: f.profile }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) { setMsg({ ok: true, text: "Saved." }); router.refresh(); }
      else if (res.status === 401) { router.replace("/login"); }
      else { if (data.fieldErrors) setErrors(data.fieldErrors); setMsg({ ok: false, text: data.message ?? "Could not save your changes." }); }
    } catch {
      setMsg({ ok: false, text: "Could not reach the server. Check your connection and try again." });
    }
    busyRef.current = false; setBusy(false);
  }

  return (
    <form className="pform" onSubmit={onSubmit} noValidate aria-busy={busy}>
      <section className="dsec">
        <h2>Account</h2>
        <div className="grid">
          <label className="f"><span>Email address</span><input className="ro" value={readonly.email} readOnly aria-readonly="true" /><small>Your email can't be changed here.</small></label>
          <label className="f"><span>Role</span><input className="ro" value={readonly.role} readOnly aria-readonly="true" /><small>More roles open after verification.</small></label>
          <label className="f"><span>Mobile number</span><input className="ro" value={readonly.mobile} readOnly aria-readonly="true" /></label>
          <label className="f"><span>Age group</span><input className="ro" value={readonly.age} readOnly aria-readonly="true" /></label>
        </div>
      </section>

      <section className="dsec">
        <h2>Your details</h2>
        <div className="grid">
          <label className="f full"><span className="req">Full name</span><input value={f.fullName} maxLength={100} autoComplete="name" onChange={(e) => { setF({ ...f, fullName: e.target.value }); clear("fullName"); }} {...ea("fullName")} />{Err("fullName")}</label>
          <label className="f"><span className="req">District</span><input value={f.district} maxLength={80} autoComplete="address-level2" onChange={(e) => { setF({ ...f, district: e.target.value }); clear("district"); }} {...ea("district")} />{Err("district")}</label>
          <label className="f"><span>Preferred language</span><select value={f.language} onChange={(e) => { setF({ ...f, language: e.target.value }); clear("language"); }} {...ea("language")}>{LANGUAGES.map((l) => <option key={l}>{l}</option>)}</select>{Err("language")}</label>
        </div>
      </section>

      {fields.length > 0 && (
        <section className="dsec">
          <h2>About you</h2>
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
        </section>
      )}

      <p className={msg?.ok ? "ok-msg" : "err"} role={msg?.ok ? "status" : "alert"}>{msg?.text ?? ""}</p>
      <div className="actions" style={{ justifyContent: "flex-end" }}>
        <button type="submit" className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
      </div>
    </form>
  );
}
