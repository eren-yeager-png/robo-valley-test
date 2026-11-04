"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The single profile button in the admin top bar: Landing Page, My Profile, Sign Out.
 * Sign Out uses the existing logout route (it clears the session cookie on the server) and then goes to /login.
 * Closes on outside click, Escape, Tab, or choosing an item; arrow keys, Home and End move between items.
 */
export default function ProfileMenu({ email, landingUrl }: { email: string; landingUrl: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const close = useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("focusin", onDown);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("focusin", onDown); };
  }, [open]);

  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  function onMenuKey(e: React.KeyboardEvent) {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === "Escape") { e.preventDefault(); close(true); }
    else if (e.key === "Tab") close();
  }

  function onButtonKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); }
    else if (e.key === "Escape" && open) { e.preventDefault(); close(true); }
  }

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* the cookie expires anyway */ }
    setOpen(false);
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="adm-profile" ref={root}>
      <button ref={button} type="button" className="adm-profile-btn" aria-haspopup="menu" aria-expanded={open} aria-controls="adm-profile-menu"
        onClick={() => setOpen((o) => !o)} onKeyDown={onButtonKey}>
        <span className="adm-avatar" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></svg>
        </span>
        <span className="adm-profile-label">Admin</span>
        <svg className="adm-caret" aria-hidden="true" viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4l4 4 4-4" /></svg>
      </button>
      {open && (
        <div id="adm-profile-menu" className="adm-menu" role="menu" aria-label="Admin profile" ref={menu} onKeyDown={onMenuKey}>
          <div className="adm-menu-who" role="presentation" title={email}>Signed in as<strong>{email}</strong></div>
          <a role="menuitem" tabIndex={-1} href={landingUrl} onClick={() => close()}>Landing Page</a>
          <Link role="menuitem" tabIndex={-1} href="/admin/settings#profile" onClick={() => close()}>My Profile</Link>
          <button role="menuitem" tabIndex={-1} type="button" onClick={signOut} disabled={busy}>{busy ? "Signing out…" : "Sign Out"}</button>
        </div>
      )}
    </div>
  );
}
