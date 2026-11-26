// The four shared breakpoints (mobile first, min-width), for scripts. The same numbers are the --bp-* custom properties in
// src/app/globals.css, which media queries cannot read, so CSS writes them out; tests/responsive-foundations.test.ts keeps the two
// in step and allows no other widths in any stylesheet of the app.
export const BREAKPOINTS = { sm: 480, md: 768, lg: 1024, xl: 1280 } as const;
export type Breakpoint = keyof typeof BREAKPOINTS;

/** "This width and wider", e.g. up("lg") = "(min-width: 1024px)". */
export const up = (bp: Breakpoint) => `(min-width: ${BREAKPOINTS[bp]}px)`;
/** "Narrower than this breakpoint", e.g. below("lg") = "(max-width: 1023.98px)" (no overlap with up("lg")). */
export const below = (bp: Breakpoint) => `(max-width: ${BREAKPOINTS[bp] - 0.02}px)`;

/** true when the window is at least this wide. false on the server and where matchMedia is missing (tests). */
export function isUp(bp: Breakpoint): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(up(bp)).matches;
}
