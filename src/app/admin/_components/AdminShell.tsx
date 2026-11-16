"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ADMIN_NAV, titleFor } from "./nav";
import ProfileMenu from "./ProfileMenu";
import HeaderMenuSlot from "../../_components/HeaderMenuSlot";

/** Sidebar (a slide-in drawer on small screens) + top bar. `locked` hides the navigation until the password is changed. */
export default function AdminShell({ email, landingUrl, locked, children }: { email: string; landingUrl: string; locked: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Close the drawer when the page changes. (Adjusting state while rendering, not in an effect: same result without an extra render pass.)
  const [shownPath, setShownPath] = useState(pathname);
  if (shownPath !== pathname) { setShownPath(pathname); setOpen(false); }
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={"adm" + (open ? " open" : "")}>
      {!locked && (
        <aside className="adm-side" id="adm-side" aria-label="Admin navigation">
          <div className="adm-brand"><span className="adm-mark" aria-hidden="true">RV</span><span>RoboValley<small>Admin</small></span></div>
          <nav>
            {ADMIN_NAV.map((n) => {
              const active = pathname === n.href || pathname?.startsWith(n.href + "/");
              return (
                <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} className={active ? "active" : undefined}>
                  <span aria-hidden="true" className="ic">{n.icon}</span>{n.label}
                </Link>
              );
            })}
          </nav>
        </aside>
      )}
      {open && <button type="button" className="adm-scrim" aria-label="Close menu" onClick={() => setOpen(false)} />}
      <div className="adm-body">
        <header className="adm-top">
          {!locked && (
            <button type="button" className="adm-burger" aria-label="Menu" aria-expanded={open} aria-controls="adm-side" onClick={() => setOpen((o) => !o)}>☰</button>
          )}
          <span className="adm-logo">RoboValley Admin</span>
          <h2 className="adm-title">{locked ? "Change your password" : titleFor(pathname)}</h2>
          <HeaderMenuSlot site={landingUrl} />
          <ProfileMenu email={email} landingUrl={landingUrl} />
        </header>
        <main className="adm-main">{children}</main>
      </div>
    </div>
  );
}
