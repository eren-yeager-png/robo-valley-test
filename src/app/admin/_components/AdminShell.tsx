"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import LogoutButton from "../../dashboard/LogoutButton";
import { ADMIN_NAV, titleFor } from "./nav";

/** Sidebar (a slide-in drawer on small screens) + top bar. `locked` hides the navigation until the password is changed. */
export default function AdminShell({ email, locked, children }: { email: string; locked: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className={"adm" + (open ? " open" : "")}>
      {!locked && (
        <aside className="adm-side" id="adm-side" aria-label="Admin navigation">
          <div className="adm-brand"><span className="adm-mark" aria-hidden="true">RV</span> RoboValley</div>
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
          <span className="adm-logo">RoboValley</span>
          <h2 className="adm-title">{locked ? "Change your password" : titleFor(pathname)}</h2>
          <div className="adm-who">
            <span className="adm-email" title={email}>{email}</span>
            <LogoutButton />
          </div>
        </header>
        <main className="adm-main">{children}</main>
      </div>
    </div>
  );
}
