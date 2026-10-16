"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import LogoutButton from "./LogoutButton";
import "../join/join.css";
import "../login/login.css";
import "./dashboard.css";

export type NavItem = { href: string; label: string };

export default function DashboardShell({ userName, roleLabel, items, children }: {
  userName: string; roleLabel: string; items: NavItem[]; children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);

  // Escape closes the mobile menu and returns focus to its button.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); menuBtn.current?.focus(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const isActive = (href: string) => (href === "/dashboard" ? pathname === "/dashboard" : pathname === href || pathname?.startsWith(href + "/"));

  return (
    <div className="rv dshell">
      <a className="skip" href="#main">Skip to main content</a>
      <header className="dtop">
        <div className="brand">RoboValley Community<small>{roleLabel}</small></div>
        <div className="dtop-right">
          <span className="who" title={userName}>{userName}</span>
          <button ref={menuBtn} type="button" className="btn menu" aria-expanded={open} aria-controls="dash-nav" onClick={() => setOpen((o) => !o)}>
            {open ? "Close" : "Menu"}<span className="sr"> navigation</span>
          </button>
        </div>
      </header>

      <div className="dbody">
        <aside className={`dside${open ? " open" : ""}`}>
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
        <main id="main" className="dmain" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
