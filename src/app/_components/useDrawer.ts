"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { up } from "../../lib/breakpoints";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * The navigation drawer of the app's two shells (admin and member). Below the lg breakpoint (1024px) the sidebar is an off-canvas
 * drawer opened from the Menu button; from lg up it is a fixed sidebar and this hook does nothing.
 * While open: Escape closes it and puts the focus back on the Menu button; Tab and Shift+Tab stay inside the drawer (focus trap);
 * the page behind does not scroll; the shell marks the rest of the page inert. It closes when the page changes (a link was chosen),
 * and by itself if the window becomes wide enough for the fixed sidebar (a tablet turned to landscape).
 */
export function useDrawer(pathname: string | null) {
  const [open, setOpen] = useState(false);
  // Close when the page changes. (Adjusting state while rendering, not in an effect: same result without an extra render pass.)
  const [shownPath, setShownPath] = useState(pathname);
  if (shownPath !== pathname) { setShownPath(pathname); setOpen(false); }
  const panel = useRef<HTMLElement | null>(null);
  const toggle = useRef<HTMLButtonElement | null>(null);
  // The Menu button gets the focus back only after the drawer has closed: until then the rest of the page (the Menu button with it)
  // is inert, and a browser does not focus an inert element. So close() asks for it and the effect below gives it.
  const refocus = useRef(false);
  const close = useCallback(() => { refocus.current = true; setOpen(false); }, []);

  useEffect(() => {
    if (!open) {
      if (refocus.current) { refocus.current = false; toggle.current?.focus(); }
      return;
    }
    const items = () => Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "Tab") return;
      const list = items();
      if (!list.length) return;
      const first = list[0], last = list[list.length - 1], at = document.activeElement;
      if (!panel.current?.contains(at)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    const root = document.documentElement, overflow = root.style.overflow;
    root.style.overflow = "hidden";
    const wide = typeof window.matchMedia === "function" ? window.matchMedia(up("lg")) : null;
    const onWide = () => { if (wide?.matches) setOpen(false); };
    wide?.addEventListener?.("change", onWide);
    items()[0]?.focus(); // the focus moves into the drawer (its Close button)
    return () => {
      document.removeEventListener("keydown", onKey);
      root.style.overflow = overflow;
      wide?.removeEventListener?.("change", onWide);
    };
  }, [open, close]);

  return { open, setOpen, close, panel, toggle };
}
