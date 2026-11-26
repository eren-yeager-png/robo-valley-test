// Responsive foundations (PR 1): one set of breakpoints for the whole app, the base rules every page gets, and the viewport.
// Static checks of the real files (jsdom does not lay out CSS); the layouts themselves were checked in a real browser at every
// device size of the brief (see the pull request).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BREAKPOINTS, below, up } from "../src/lib/breakpoints";
import { viewport } from "../src/app/layout";

const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const APP_CSS = walk("src").filter((f) => f.endsWith(".css"));
const read = (f: string) => readFileSync(f, "utf8");
const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const queries = (css: string) => [...noComments(css).matchAll(/@media\s*([^{]+)\{/g)].map((m) => m[1].trim());
const globals = read("src/app/globals.css");

describe("one set of breakpoints", () => {
  it("is defined once: the --bp-* custom properties and src/lib/breakpoints.ts hold the same four widths", () => {
    expect(BREAKPOINTS).toEqual({ sm: 480, md: 768, lg: 1024, xl: 1280 });
    for (const [k, v] of Object.entries(BREAKPOINTS)) expect(globals, k).toMatch(new RegExp(`--bp-${k}:\\s*${v}px;`));
    expect(up("lg")).toBe("(min-width: 1024px)");
    expect(below("md")).toBe("(max-width: 767.98px)");
  });

  it("every media query in the app's stylesheets uses only those widths (min-width W, or max-width W - 0.02 for 'below')", () => {
    const allowedWidths = new Set(Object.values(BREAKPOINTS).flatMap((w) => [`(min-width:${w}px)`, `(max-width:${w - 0.02}px)`]));
    const features = /^\((prefers-reduced-motion|prefers-color-scheme|pointer|hover|any-pointer|any-hover|orientation):[a-z-]+\)$/;
    const found: string[] = [];
    for (const f of APP_CSS) for (const q of queries(read(f))) {
      for (const part of q.replace(/\s+/g, "").split(/and|,/)) {
        if (!part) continue;
        if (/width/.test(part) ? !allowedWidths.has(part) : !features.test(part)) found.push(`${f}: ${q}`);
      }
    }
    expect(found).toEqual([]);
    expect(APP_CSS.length).toBeGreaterThanOrEqual(6);
  });

  it("scripts do not write their own widths either: no matchMedia or @media outside src/lib/breakpoints.ts", () => {
    const code = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && !f.replace(/\\/g, "/").endsWith("src/lib/breakpoints.ts"));
    const offenders = code.filter((f) => /matchMedia\(\s*["'`]|@media/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe("the base every page gets", () => {
  it("border-box everywhere; media never wider than its container; images and videos keep their shape", () => {
    expect(globals).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{\s*box-sizing:\s*border-box;/);
    expect(globals).toMatch(/img,\s*picture,\s*video,\s*canvas,\s*svg,\s*iframe,\s*embed,\s*object\s*\{\s*max-width:\s*100%;/);
    expect(globals).toMatch(/img,\s*video\s*\{\s*height:\s*auto;/);
  });
  it("full height uses 100dvh where supported (falls back to 100vh); no stylesheet uses a bare 100vh any more", () => {
    expect(globals).toMatch(/--vh:\s*100vh;/);
    expect(globals).toMatch(/@supports \(height: 100dvh\) \{\s*:root \{ --vh: 100dvh; \}/);
    const bare = APP_CSS.flatMap((f) => [...noComments(read(f)).replace(/--vh:\s*100vh;/g, "").matchAll(/[^(,]100vh/g)].map(() => f)); // var(--vh,100vh) is the fallback form
    expect(bare).toEqual([]);
  });
  it("safe-area insets, fluid page padding and heading size, and the touch target size are tokens", () => {
    for (const t of ["--safe-t: env(safe-area-inset-top, 0px)", "--safe-b: env(safe-area-inset-bottom, 0px)", "--page-pad: clamp(16px, 4vw, 40px)", "--h1: clamp(24px, 5vw, 32px)", "--touch: 44px", "--touch-gap: 8px"]) expect(globals, t).toContain(t);
  });
  it("body and input text are 16px on every touch screen (iOS zooms into smaller inputs, and an iPhone in landscape is wider than 768px); smaller only with a mouse from 768px; touch targets grow on touch screens", () => {
    const base = read("src/app/join/join.css"), admin = read("src/app/admin/admin.css"), login = read("src/app/login/login.css"), dash = read("src/app/dashboard/dashboard.css");
    expect(base).toMatch(/font:16px\/1\.55 var\(--font\)/);
    expect(base).toMatch(/@media \(min-width:768px\) and \(pointer:fine\)\{\.rv\{font-size:15\.5px\}\}/);
    expect(base).toMatch(/\.rv input,\.rv select,\.rv textarea\{font:inherit;font-size:16px;/);
    expect(base).toMatch(/@media \(min-width:768px\) and \(pointer:fine\)\{\.rv input,\.rv select,\.rv textarea\{font-size:\.95rem\}\}/);
    expect(admin).toMatch(/font-size:16px;line-height:1\.5\}\r?\n@media \(min-width:768px\) and \(pointer:fine\)\{\.rv \.adm\{font-size:15px\}\}/);
    for (const css of [base, admin]) expect(noComments(css)).not.toMatch(/@media \(min-width:768px\)\{[^}]*font-size/); // never smaller on a touch screen
    expect(base).toMatch(/@media \(pointer:coarse\)\{[\s\S]*\.rv \.btn,\.rv \.vbtn,\.rv \.chip\{min-height:var\(--touch\)\}/);
    expect(base).toMatch(/@media \(pointer:coarse\)\{[\s\S]*\.rv input:not\(\[type=checkbox\]\):not\(\[type=radio\]\),\.rv select\{min-height:var\(--touch\)\}/);
    expect(login).toMatch(/\.rv \.row \.forgot,\.rv \.alt a\{display:inline-flex;align-items:center;min-height:var\(--touch\)\}/);
    expect(dash).toMatch(/@media \(pointer:coarse\)\{\.rv \.skip\{display:inline-flex;align-items:center;min-height:var\(--touch\)\} \.rv details\.sample summary\{padding-block:10px\}\}/);
  });
});

describe("viewport", () => {
  it("device width, scale 1, safe areas reachable, and pinch zoom never switched off", () => {
    expect(viewport).toEqual({ width: "device-width", initialScale: 1, viewportFit: "cover" });
    // code only: comments that explain the rule (like the one in layout.tsx) are left out
    const everything = walk("src").filter((f) => /\.(ts|tsx|css)$/.test(f)).map((f) => noComments(read(f)).replace(/(^|\s)\/\/.*$/gm, "")).join("\n");
    expect(everything).not.toMatch(/user-?[sS]calable|maximumScale|maximum-scale/);
  });
});

describe("the shells: a fixed sidebar from 1024px, an off-canvas drawer below", () => {
  const admin = noComments(read("src/app/admin/admin.css")), dash = noComments(read("src/app/dashboard/dashboard.css"));
  it("admin: the drawer below 1024px is hidden with visibility when closed (out of the Tab order) and clears the safe areas", () => {
    expect(admin).toMatch(/@media \(max-width:1023\.98px\)\{\s*\.rv \.adm-side\{position:fixed;[^}]*transform:translateX\(-100%\);visibility:hidden;/);
    expect(admin).toMatch(/\.rv \.adm\.open \.adm-side\{transform:none;visibility:visible;/);
    expect(admin).toMatch(/\.rv \.adm-side\{position:sticky;[^}]*padding:calc\(18px \+ var\(--safe-t\)\)/);
    expect(admin).toMatch(/\.rv \.adm-top\{[^}]*padding:calc\(10px \+ var\(--safe-t\)\)/);
  });
  it("member: the same pattern (drawer below 1024px, fixed sidebar from 1024px)", () => {
    expect(dash).toMatch(/\.rv \.dside\{position:fixed;[^}]*transform:translateX\(-100%\);visibility:hidden;/);
    expect(dash).toMatch(/\.rv \.dside\.open\{transform:none;visibility:visible;/);
    expect(dash).toMatch(/@media \(min-width:1024px\)\{[^@]*\.rv \.dside\{position:sticky;[^}]*visibility:visible;/);
    expect(dash).toMatch(/\.rv \.dtop\{[^}]*padding:calc\(10px \+ var\(--safe-t\)\)/);
  });
});
