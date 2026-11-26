"use client";
// Mounts one of the contribution workflow's plain JavaScript screens (public/cw/js) inside an admin portal page. The module is loaded
// by the browser at run time (not bundled), so the portal, the WordPress plugin and the standalone demo run the SAME files.
import { useEffect, useRef } from "react";

const SRC = { moderator: "/cw/js/moderator.js", admin: "/cw/js/admin.js" } as const;

export default function CwMount({ screen }: { screen: keyof typeof SRC }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    let alive = true;
    const src = SRC[screen];
    import(/* webpackIgnore: true */ src)
      .then((m: { mount: (el: HTMLElement, opts: object) => Promise<void> }) => { if (alive && el) return m.mount(el, {}); })
      .catch(() => { if (alive && el) el.innerHTML = '<div class="cw-notice cw-n-err" role="alert">This page could not be loaded. Please reload it.</div>'; });
    return () => { alive = false; if (el) el.innerHTML = ""; };
  }, [screen]);
  return <div className="rv-cw-root" ref={ref}><p className="cw-muted">Loading…</p></div>;
}
