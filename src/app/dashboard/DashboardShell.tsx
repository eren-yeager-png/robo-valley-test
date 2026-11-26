"use client";

import { usePathname } from "next/navigation";
import LogoutButton from "./LogoutButton";
import HeaderMenuSlot from "../_components/HeaderMenuSlot";
import { useDrawer } from "../_components/useDrawer";
import "../join/join.css";
import "../login/login.css";
import "./dashboard.css";

export type NavItem = { href: string; label: string };

export default function DashboardShell({ userName, roleLabel, items, site, children }: {
  userName: string; roleLabel: string; items: NavItem[]; site?: string; children: React.ReactNode;
}) {
  const pathname = usePathname();
  // Below 1024px the navigation is an off-canvas drawer, the same pattern as the admin portal (src/app/_components/useDrawer.ts):
  // Close button, backdrop, Escape (the focus goes back to Menu), a focus trap, the rest of the page inert while it is open.
  const { open, setOpen, close, panel, toggle } = useDrawer(pathname);

  const isActive = (href: string) => (href === "/dashboard" ? pathname === "/dashboard" : pathname === href || pathname?.startsWith(href + "/"));

  return (
    <div className={`rv dshell${open ? " open" : ""}`}>
      <a className="skip" href="#main">Skip to main content</a>
      <header className="dtop" inert={open || undefined}>
        <div className="brand">RoboValley Community<small>{roleLabel}</small></div>
        <div className="dtop-right">
          <span className="who" title={userName}>{userName}</span>
          <HeaderMenuSlot site={site} />
          <button ref={toggle} type="button" className="btn menu" aria-expanded={open} aria-controls="dash-nav" onClick={() => setOpen((o) => !o)}>
            <span aria-hidden="true">☰ </span>Menu<span className="sr"> navigation</span>
          </button>
        </div>
      </header>

      <div className="dbody">
        <aside className={`dside${open ? " open" : ""}`} ref={panel}>
          <div className="dside-head"><span className="brand">RoboValley</span><button type="button" className="dclose" aria-label="Close menu" onClick={close}>✕</button></div>
          <nav id="dash-nav" aria-label="Dashboard">
            <ul>
              {items.map((it) => (
                <li key={it.href}>
                  <a href={it.href} className={isActive(it.href) ? "active" : undefined} aria-current={isActive(it.href) ? "page" : undefined} onClick={() => setOpen(false)}>{it.label}</a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="dside-foot"><LogoutButton /></div>
        </aside>
        {open && <button type="button" className="dscrim" aria-hidden="true" tabIndex={-1} onClick={close} />}
        <main id="main" className="dmain" tabIndex={-1} inert={open || undefined}>{children}</main>
      </div>
    </div>
  );
}
