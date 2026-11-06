import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const php = readFileSync("wp-content-mu-plugins/rv-contribute-button.php", "utf8");
const ref = readFileSync("reference/unpacked/sector-agriculture-dairy.html", "utf8");
const sample = readFileSync("frontend/tests/rv-contribute-button/rv-sector-bar.sample.html", "utf8");
const rule = (src: string, sel: string) => src.match(new RegExp("\\" + sel.replace(/[()]/g, "\\$&") + "\\{[^}]*\\}"))?.[0];
const norm = (s: string) => s.replace(/#FFFFFF/gi, "#fff").replace(/text-decoration:none;/, "").replace("margin-right:-24px", "margin-right:0");

describe("Contribution button mu-plugin", () => {
  it("uses the reference button CSS (base, hover, active, focus, svg); only margin-right differs (0, not the mock's -24px)", () => {
    for (const sel of [".rv-contribute-btn", ".rv-contribute-btn:hover", ".rv-contribute-btn:active", ".rv-contribute-btn:focus-visible", ".rv-contribute-btn svg"]) {
      const want = rule(ref, sel);
      expect(want, sel).toBeTruthy();
      expect(norm(php)).toContain(norm(want!));
    }
    expect(php).not.toContain("margin-right:-24px;border-radius");
  });
  it("matches the reference markup: label, aria-label, 18px plus icon", () => {
    expect(php).toContain('aria-label="Contribute to RoboValley"');
    expect(php).toContain('width="18" height="18" viewBox="0 0 24 24"');
    expect(php).toContain('<path d="M12 5v14M5 12h14">');
    expect(php).toContain("Contribution</a>");
  });
  it("has the phone rule (44px) and reduced motion", () => {
    expect(php).toContain("@media (max-width:720px){.rv-contribute-btn{min-height:44px}");
    expect(php).toContain("prefers-reduced-motion:reduce");
  });
  it("hooks the real bar: only the [rv_sector_bar] shortcode, appended as the last child of the nav, outside .rv-fixed", () => {
    // the real plugin prints exactly one <nav class="rv-sector-bar" id="rv-sector-bar"> whose last child is a .rv-group, then </nav>
    expect(sample).toMatch(/^<nav class="rv-sector-bar" id="rv-sector-bar"/);
    expect(sample.match(/<\/nav>/g)?.length).toBe(1);
    expect(php).toContain("'do_shortcode_tag'");
    expect(php).toContain("'rv_sector_bar' !== $tag");
    expect(php).toContain("strripos( $output, '</nav>' )");
    expect(php).not.toContain("rv-fixed')"); // never inserted into the tab group
  });
  it("adds exactly one button per bar and no JavaScript fallback", () => {
    expect(php.match(/false !== strpos\( \$output, 'rv-contribute-btn' \)/g)?.length).toBe(1);
    expect(php).not.toContain("<script");
    expect(php).not.toContain("wp_footer");
  });
  it("keeps the shadow and the right edge visible in the real bar (overflow-x:auto): room above and below, margin 0, sticky", () => {
    expect(php).toContain(".rv-sector-bar.rv-has-contribute{padding-top:6px;padding-bottom:16px");
    expect(php).toContain("rv-sector-bar rv-has-contribute");
    expect(php).toContain("position:sticky;right:0");
    expect(php).toContain(".rv-sector-bar .rv-contribute-btn{right:8px}");
  });
  it("is admin-only until RV_CONTRIBUTE_PUBLIC, never on Contact Us, URL from RV_CONTRIBUTE_URL (default /contribute-now/)", () => {
    expect(php).toContain("current_user_can( 'manage_options' )");
    expect(php).toContain("RV_CONTRIBUTE_PUBLIC");
    expect(php).toContain("array( 'contact-us', 'contact' )");
    expect(php).toContain("RV_CONTRIBUTE_URL");
    expect(php).toContain("home_url( '/contribute-now/' )");
  });
  it("makes no network or storage calls and edits no other plugin", () => {
    expect(php).not.toMatch(/fetch\(|XMLHttpRequest|localStorage|wp_remote_|update_option|file_put_contents/);
  });
});
