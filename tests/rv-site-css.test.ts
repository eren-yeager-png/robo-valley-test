// The site styles of the Contribute plugin (Parts B and D): the space around Astra's entry header, and the .rv-rt block. Static checks;
// the result in a browser with the real Astra theme is checked separately (see the pull request).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = "frontend/wordpress/plugins/rv-contribution-v2/";
const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const CSS = read(DIR + "assets/rv-site.css"), PHP = read(DIR + "rv-contribution-v2.php"), HTML = read(DIR + "assets/rv-contribution-v2.html"), JS = read(DIR + "assets/rv-contribution-v2.js");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((r) => r.split("{")).filter((r) => r.length === 2).map(([s, b]) => ({ sel: s.trim().split(/\s*,\s*/), body: b.trim().split(/;\s*/).filter(Boolean) }));
const ruleOf = (sel: string) => rules.filter((r) => r.sel.includes(sel));

describe("B1 and B2: the space around the entry header", () => {
  it("has the two agreed rules, the page-builder rule last (a page-builder page matches both)", () => {
    expect(ruleOf(".ast-single-post .entry-header.ast-header-without-markup")[0]).toEqual({ sel: [".ast-single-post .entry-header.ast-header-without-markup", ".ast-single-post .entry-header.ast-no-title.ast-no-thumbnail"], body: ["margin-bottom: 25px", "margin-top: 35px"] });
    expect(ruleOf(".ast-page-builder-template .entry-header.ast-header-without-markup")[0].body).toEqual(["margin-top: 25px", "margin-bottom: 15px"]);
    expect(CSS.indexOf(".ast-page-builder-template")).toBeGreaterThan(CSS.indexOf(".ast-single-post .entry-header.ast-no-title.ast-no-thumbnail"));
  });
  it("a header with nothing in it gets no space (a page whose title is switched off)", () => {
    expect(ruleOf(".ast-single-post .entry-header.ast-no-title.ast-header-without-markup:not(:has(*))")[0].body).toEqual(["margin-top: 0", "margin-bottom: 0"]);
  });
  it("needs no !important, and is loaded after Astra's stylesheet, with the plugin's version, only while the switch is on", () => {
    expect(CSS.replace(/\/\*[\s\S]*?\*\//g, "")).not.toContain("!important");
    const hook = /add_action\(\n\t'wp_enqueue_scripts',\n\tfunction \(\) \{\n\t\tif \( ! rv_c2_enabled\(\) \) \{\n\t\t\treturn;\n\t\t\}\n([\s\S]*?)\n\t\},\n\t1000\n\);/.exec(PHP)![1];
    expect(hook).toContain("wp_style_is( 'astra-theme-css', 'registered' ) ? array( 'astra-theme-css' ) : array()");
    expect(hook).toContain("wp_enqueue_style( 'rv-c2-site', plugins_url( 'assets/rv-site.css', __FILE__ ), $after, RV_C2_VERSION );");
  });
});

describe("B3: the .rv-rt block", () => {
  it("has the agreed look, 880px wide, and shrinks with a narrow screen", () => {
    expect(ruleOf(".rv-rt")).toHaveLength(1);
    expect(ruleOf(".rv-rt")[0].body).toEqual(["max-width: 880px", "margin: 24px 0", "padding: 24px", "border: 1px solid #e1e4ea", "border-radius: 16px", "background: #fff", "color: #1b1f3b", "width: 100%", "box-sizing: border-box", "overflow-wrap: anywhere"]);
    expect(ruleOf(".rv-rt table")[0].body).toContain("overflow-x: auto");
    expect(ruleOf(".rv-rt img")[0].body).toContain("max-width: 100%");
  });
  it("is defined once: no other stylesheet or plugin file of ours has an .rv-rt rule, an 880px width or an inline width", () => {
    const files = [...walk("frontend/wordpress/plugins"), ...walk("public"), "frontend/wordpress/additional-css.css"].filter((f) => /\.(css|php|html|js)$/.test(f));
    for (const f of files) {
      const t = read(f).replace(/\/\*[\s\S]*?\*\//g, ""); // rules, not mentions in comments
      if (!f.replace(/\\/g, "/").endsWith("rv-contribution-v2/assets/rv-site.css")) expect(t, f).not.toMatch(/\.rv-rt\b[^{};]*\{/); // a rule, not a mention in a comment
      if (!f.replace(/\\/g, "/").endsWith("rv-contribution-v2/assets/rv-site.css")) expect(t, f).not.toMatch(/880px/); // the width is set in rv-site.css only
      expect(t, f).not.toMatch(/class="[^"]*\brv-rt\b[^"]*"[^>]*style=/);
    }
  });
});

describe("D: what an administrator adds later", () => {
  it("is put into the one shared .rv-rt container, not styled field by field", () => {
    expect(HTML).toContain('<div id="robot-choices" class="rv-rt"></div>');
    expect(HTML.match(/rv-rt/g)).toHaveLength(1);
    expect(JS).not.toContain("rv-rt"); // the script only adds fields to the container
    expect(JS).toContain("robotChoices.appendChild( label );");
  });
  it("an empty container shows nothing (a fixed robot, or a sector without robot types)", () => {
    expect(ruleOf(".rv-rt:empty")[0].body).toEqual(["display: none"]);
  });
});
