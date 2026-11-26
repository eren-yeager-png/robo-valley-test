// Responsive PR 4: the WordPress landing page and site styles follow Astra's breakpoints (tablet 921px, mobile 544px) plus the shared
// 768px step, and nothing else. Static checks of the shipped files; the pages themselves were checked in a real browser on a
// throw-away WordPress with the real Astra theme at every device size of the brief (see the pull request).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const LANDING = "frontend/wordpress/plugins/robovalley-landing/";
const C2 = "frontend/wordpress/plugins/rv-contribution-v2/";
const HOME = read(LANDING + "assets/robovalley-home.css"), SITE = read(C2 + "assets/rv-site.css");
const LPHP = read(LANDING + "robovalley-landing.php"), C2PHP = read(C2 + "rv-contribution-v2.php");
const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
/** every @media block: its query and its body (balanced braces) */
const blocks = (css: string) => {
  const out: { q: string; body: string }[] = [], t = noComments(css);
  for (const m of t.matchAll(/@media\s*([^{]+)\{/g)) {
    let depth = 1, i = m.index! + m[0].length;
    for (; i < t.length && depth; i++) depth += t[i] === "{" ? 1 : t[i] === "}" ? -1 : 0;
    out.push({ q: m[1].trim(), body: t.slice(m.index! + m[0].length, i - 1) });
  }
  return out;
};
// the sector button's stylesheet, printed by the plugin in wp_head: the PHP string pieces joined
const INLINE = [.../'([^']*)'/g[Symbol.matchAll](/<style id="rv-c2-sector-css">'\n([\s\S]*?)\. '<\/style>'/.exec(C2PHP)![1])].map((m) => m[1]).join("");

const ALLOWED = new Set(["(max-width:921px)", "(min-width:922px)", "(max-width:767.98px)", "(min-width:768px)", "(max-width:544px)", "(min-width:545px)"]);
const FEATURES = /^\((prefers-reduced-motion|pointer|hover|any-pointer|any-hover|orientation):[a-z-]+\)$/;
const ADMIN_BAR = new Set(["(max-width:600px)", "(min-width:601px)"]); // WordPress core: the admin bar scrolls away at 600px and below

describe("one set of WordPress breakpoints: Astra's 921px and 544px, and the shared 768px", () => {
  for (const [name, css] of [["robovalley-home.css", HOME], ["rv-site.css", SITE], ["the sector button's inline style", INLINE]] as const) {
    it(`${name}: every width in a media query is one of them (600/601px only in the admin-bar rules)`, () => {
      const bad: string[] = [];
      for (const { q, body } of blocks(css)) for (const part of q.replace(/\s+/g, "").split(/and|,/)) {
        if (!part) continue;
        if (ADMIN_BAR.has(part)) { if (!/^\s*body\.admin-bar[^{]*\{[^}]*\}\s*$/.test(body)) bad.push(`${q}: not an admin-bar rule`); continue; }
        if (/width/.test(part) ? !ALLOWED.has(part) : !FEATURES.test(part)) bad.push(q);
      }
      expect(bad).toEqual([]);
    });
  }
  it("the old one-off widths are gone (980, 860, 760, 640, 520px; 600px for the sector button)", () => {
    for (const w of ["980px", "860px", "760px", "640px", "520px"]) expect(noComments(HOME), w).not.toMatch(new RegExp(`@media[^{]*max-width: ${w}`)); // media queries; the same numbers as box widths are fine
    expect(INLINE).not.toContain("max-width:600px");
  });
});

describe("the landing page (robovalley-landing 1.3.5)", () => {
  const at = (q: string) => blocks(HOME).filter((b) => b.q === q).map((b) => b.body).join("\n");
  it("tablet (921px and below, where Astra shows its mobile header): 4- and 3-column grids in two, the hero slide in one column", () => {
    expect(at("(max-width: 921px)")).toMatch(/\.robovalley-cols-4,\s*body\.robovalley-landing-page \.robovalley-home \.robovalley-cols-3 \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    expect(at("(max-width: 921px)")).toMatch(/\.robovalley-slide \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  });
  it("768px step: the two-column sections in one column, the slider tabs on their own row", () => {
    expect(at("(max-width: 767.98px)")).toMatch(/\.robovalley-pipe,[\s\S]*\.robovalley-charts,[\s\S]*\.robovalley-contact \{\s*grid-template-columns: minmax\(0, 1fr\);/);
    expect(at("(max-width: 767.98px)")).toMatch(/\.robovalley-tabs \{\s*order: -1;\s*flex-basis: 100%;/);
  });
  it("phones (544px and below, Astra mobile): the remaining grids in one column, full-width buttons", () => {
    expect(at("(max-width: 544px)")).toMatch(/\.robovalley-zones,[\s\S]*\.robovalley-opps,[\s\S]*\.robovalley-cats,[\s\S]*\{\s*grid-template-columns: minmax\(0, 1fr\);/);
    expect(at("(max-width: 544px)")).toMatch(/\.robovalley-btn \.elementor-button \{\s*width: 100%;/);
  });
  it("touch screens only (nothing changes with a mouse): the menu button, the slider arrows and Pause and the RoboCity buttons are at least 44px; body copy is at least 16px", () => {
    const touch = at("(pointer: coarse)");
    expect(touch).toMatch(/body\.robovalley-landing-page #masthead \.menu-toggle \{\s*min-width: 44px;\s*min-height: 44px;/);
    expect(touch).toMatch(/\.robovalley-arrow \{\s*width: 44px;\s*height: 44px;/);
    expect(touch).toMatch(/\.robovalley-pause \{\s*min-height: 44px;/);
    expect(touch).toMatch(/\.robovalley-cm-city \{\s*padding-top: 12px;\s*padding-bottom: 12px;/);
    expect(touch).toMatch(/\.robovalley-lede,[\s\S]*\.robovalley-small,[\s\S]*\.robovalley-opp \.robovalley-small \{\s*font-size: max\(1rem, 16px\);/);
    // the story card's close and pause buttons keep their look; an invisible layer makes each answer taps over at least 44 by 44px
    expect(touch).toMatch(/\.rv-animation-root \.rv-animation-close::after,\s*body\.robovalley-landing-page \.rv-animation-root \.rv-animation-pause::after \{\s*content: "";\s*position: absolute;\s*inset: min\(-6px, calc\(\(100% - 44px\) \/ 2\)\);/);
  });
  it("the six zone buttons: taller hexes below 768px, and two rows of three on phones (six in one row cannot be 44px wide at 320px)", () => {
    expect(at("(max-width: 767.98px)")).toMatch(/\.robovalley-cm-hex \{\s*aspect-ratio: 7 \/ 4;/);
    expect(at("(max-width: 544px)")).toMatch(/\.robovalley-cm-row \{\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
    expect(at("(max-width: 544px)")).toMatch(/\.robovalley-cm-row::before \{\s*left: calc\(100% \/ 6\);\s*right: calc\(100% \/ 6\);/);
  });
  it("the version moved to 1.3.5 so browsers and caches fetch the new stylesheet", () => {
    expect(LPHP).toMatch(/\* Version: {11}1\.3\.5\n/);
    expect(LPHP).toContain("define( 'ROBOVALLEY_LANDING_VERSION', '1.3.5' );");
  });
});

describe("the site styles and the sector button (rv-contribution-v2 0.1.13)", () => {
  const phone = blocks(SITE).filter((b) => b.q === "(max-width: 544px)").map((b) => b.body).join("\n");
  it("phones: 20px above and 15px below the entry header; the empty header still gets none; 16px inside .rv-rt", () => {
    expect(phone).toMatch(/\.ast-single-post \.entry-header\.ast-header-without-markup,\s*\.ast-single-post \.entry-header\.ast-no-title\.ast-no-thumbnail,\s*\.ast-page-builder-template \.entry-header\.ast-header-without-markup \{\s*margin-top: 20px;\s*margin-bottom: 15px;/);
    expect(phone.indexOf(":not(:has(*))")).toBeGreaterThan(phone.indexOf("margin-top: 20px")); // after it: the same weight as its second selector
    expect(phone).toMatch(/:not\(:has\(\*\)\) \{\s*margin-top: 0;\s*margin-bottom: 0;/);
    expect(phone).toMatch(/\.rv-rt \{\s*padding: 16px;\s*\}/);
  });
  it("the desktop values stay as they were (35/25px, page builder 25/15px, .rv-rt 24px)", () => {
    const top = noComments(SITE).replace(/@media[^{]+\{[\s\S]*$/, "");
    expect(top).toMatch(/\.ast-single-post \.entry-header\.ast-no-title\.ast-no-thumbnail \{\s*margin-bottom: 25px;\s*margin-top: 35px;/);
    expect(top).toMatch(/\.ast-page-builder-template \.entry-header\.ast-header-without-markup \{\s*margin-top: 25px;\s*margin-bottom: 15px;/);
    expect(top).toMatch(/\.rv-rt \{[^}]*padding: 24px;/);
  });
  it("a table in .rv-rt keeps whole words in its cells and scrolls inside the block (no cells squeezed to one letter)", () => {
    expect(SITE).toMatch(/\.rv-rt table \{\n\tdisplay: block;\n\twidth: 100%;\n\toverflow-x: auto;\n\toverflow-wrap: normal;\n\}/);
  });
  it("touch screens: the header's menu button and the comment form are 44px; text in .rv-rt and the comment form is at least 16px", () => {
    const touch = blocks(SITE).filter((b) => b.q === "(pointer: coarse)").map((b) => b.body).join("\n");
    expect(touch).toMatch(/#masthead \.menu-toggle \{\s*min-width: 44px;\s*min-height: 44px;/);
    expect(touch).toMatch(/\.rv-rt \{\s*font-size: max\(1em, 16px\);/);
    expect(touch).toMatch(/\.entry-content > :is\(p, ul, ol, dl, blockquote, table\) \{\s*font-size: max\(1em, 16px\);/); // editor text only, not page-builder content
    expect(touch).toMatch(/\.comment-form textarea \{\s*min-height: 44px;\s*font-size: max\(1em, 16px\);/);
  });
  it("embedded frames keep an aspect ratio at full width (maps 4:3); frames inside the WordPress, Astra and Elementor wrappers are left alone", () => {
    expect(SITE).toMatch(/\.rv-rt iframe,\n\.rv-rt embed,\n\.rv-rt object,\n\.entry-content iframe:is\([^)]*youtube\.com[^)]*\):not\(:is\(\.wp-has-aspect-ratio, \.ast-oembed-container, \.elementor-widget-video, \.elementor-widget-google_maps\) iframe\) \{\n\twidth: 100%;\n\theight: auto;\n\taspect-ratio: 16 \/ 9;/);
    expect(SITE).toMatch(/google\.com\/maps[^{]*\{\n\taspect-ratio: 4 \/ 3;/);
  });
  it("the sector button: under the heading at full width on phones (544px and below), beside it from 545px; still 44px tall", () => {
    expect(INLINE).toContain("@media (max-width:544px){.rv-c2-has-sector-cta{display:block}.rv-c2-has-sector-cta .rv-c2-sector-cta{margin:12px 0 0}.rv-c2-sector-cta{display:block}.rv-c2-sector-btn{display:flex;width:100%;justify-content:center;white-space:normal;text-align:center}}");
    expect(INLINE).toContain(".rv-c2-has-sector-cta{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px}");
    expect(INLINE).toContain("min-height:44px");
  });
  it("the version moved to 0.1.13 (stylesheet URLs change, so caches refresh); the README says what changed", () => {
    expect(C2PHP).toMatch(/\* Version: 0\.1\.13\n/);
    expect(C2PHP).toContain("const RV_C2_VERSION = '0.1.13';");
    const readme = read(C2 + "README.txt");
    expect(readme.split("\n")[0]).toBe("RoboValley Contribution (v2) - WordPress plugin, version 0.1.13");
    expect(readme).toContain("NEW IN 0.1.13");
  });
});
