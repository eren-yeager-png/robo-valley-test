"use client";
// Mounts one of the contribution workflow's plain JavaScript screens (public/cw/js) inside an app page. The module is loaded by the
// browser at run time (not bundled), so the portal, the WordPress plugin and the standalone demo run the SAME files.
import { useEffect, useRef } from "react";

const SRC = {
  moderator: "/cw/js/moderator.js", admin: "/cw/js/admin.js", mine: "/cw/js/mine.js", sectors: "/cw/js/sectors.js",
  moderation: "/cw/js/moderation.js", requests: "/cw/js/requests.js", sectorForms: "/cw/js/sector-forms.js", overview: "/cw/js/overview.js",
  audit: "/cw/js/audit.js", site: "/cw/js/site.js", sectorsAdmin: "/cw/js/sectors-admin.js", contribute: "/cw/js/contribute-modal.js",
} as const;

export default function CwMount({ screen, options = {} }: { screen: keyof typeof SRC; options?: Record<string, unknown> }) {
  const ref = useRef<HTMLDivElement>(null);
  const opts = JSON.stringify(options);
  useEffect(() => {
    const el = ref.current;
    let alive = true;
    let handle: { stop?: () => void } | null = null;
    const src = SRC[screen];
    import(/* webpackIgnore: true */ src)
      .then(async (m: { mount: (el: HTMLElement, opts: object) => Promise<unknown> }) => {
        if (alive && el) handle = ((await m.mount(el, JSON.parse(opts))) as { stop?: () => void } | null) ?? null;
      })
      .catch(() => { if (alive && el) el.innerHTML = '<div class="cw-notice cw-n-err" role="alert">This page could not be loaded. Please reload it.</div>'; });
    return () => { alive = false; if (handle && handle.stop) handle.stop(); if (el) el.innerHTML = ""; };
  }, [screen, opts]);
  return <div className="rv-cw-root" ref={ref}><p className="cw-muted">Loading…</p></div>;
}
