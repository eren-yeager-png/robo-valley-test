"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV, MODERATOR_NAV, titleFor } from "./nav";
import HeaderMenuSlot from "../../_components/HeaderMenuSlot";
import { useDrawer } from "../../_components/useDrawer";

/**
 * Sidebar + top bar. From 1024px (lg) the sidebar is fixed on the left; below that it is an off-canvas drawer opened from the Menu
 * button (tablets and phones alike), with a Close button, a backdrop, Escape, a focus trap and the rest of the page inert while it
 * is open (src/app/_components/useDrawer.ts). `locked` hides the navigation until the password is changed.
 * The only account control is the shared header account menu (the avatar, public/rv-header-menu.js), with Sign Out at the end.
 * It stays in the top bar while a password change is forced, so Sign Out is always there.
 * `role` only decides what the sidebar shows (Moderation is open to moderators too); every page and API checks access on the server.
 */
export default function AdminShell({ landingUrl, locked, role = "admin", children }: { landingUrl: string; locked: boolean; role?: "admin" | "moderator"; children: React.ReactNode }) {
  const nav = role === "admin" ? ADMIN_NAV : MODERATOR_NAV;
  const pathname = usePathname();
  const { open, setOpen, close, panel, toggle } = useDrawer(pathname);

  return (
    <div className={"adm" + (open ? " open" : "")}>
      {!locked && (
        <aside className="adm-side" id="adm-side" aria-label="Admin navigation" ref={panel}>
          <div className="adm-brand"><span className="adm-mark" aria-hidden="true">RV</span><span>RoboValley<small>{role === "admin" ? "Admin" : "Moderator"}</small></span>
            <button type="button" className="adm-close" aria-label="Close menu" onClick={close}>✕</button></div>
          <nav>
            {nav.map((n) => {
              const active = pathname === n.href || pathname?.startsWith(n.href + "/");
              return (
                <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} className={active ? "active" : undefined} onClick={() => setOpen(false)}>
                  <span aria-hidden="true" className="ic">{n.icon}</span>{n.label}
                </Link>
              );
            })}
          </nav>
        </aside>
      )}
      {open && <button type="button" className="adm-scrim" aria-hidden="true" tabIndex={-1} onClick={close} />}
      <div className="adm-body" inert={open || undefined}>
        <header className="adm-top">
          {!locked && (
            <button type="button" className="adm-burger" aria-label="Menu" aria-expanded={open} aria-controls="adm-side" ref={toggle} onClick={() => setOpen((o) => !o)}>☰</button>
          )}
          <span className="adm-logo">RoboValley Admin</span>
          <h2 className="adm-title">{locked ? "Change your password" : titleFor(pathname)}</h2>
          <HeaderMenuSlot site={landingUrl} />
        </header>
        <main className="adm-main">{children}</main>
      </div>
    </div>
  );
}
