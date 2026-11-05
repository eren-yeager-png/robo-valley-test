import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const php = readFileSync("wp-content-mu-plugins/rv-contribute-button.php", "utf8");
const ref = readFileSync("reference/unpacked/sector-agriculture-dairy.html", "utf8");
const rule = (src: string, sel: string) => src.match(new RegExp("\\" + sel.replace(/[()]/g, "\$&") + "\{[^}]*\}"))?.[0];

describe("Contribution button mu-plugin", () => {
  it("uses the reference button CSS exactly (base, hover, active, focus, svg)", () => {
    const norm = (s: string) => s.replace(/#FFFFFF/gi, "#fff").replace(/text-decoration:none;/, "");
    for (const sel of [".rv-contribute-btn", ".rv-contribute-btn:hover", ".rv-contribute-btn:active", ".rv-contribute-btn:focus-visible", ".rv-contribute-btn svg"]) {
      const want = rule(ref, sel);
      expect(want, sel).toBeTruthy();
      expect(norm(php)).toContain(norm(want!));
    }
  });
  it("matches the reference markup: label, aria-label, 18px plus icon", () => {
    expect(php).toContain('aria-label="Contribute to RoboValley"');
    expect(php).toContain('width="18" height="18" viewBox="0 0 24 24"');
    expect(php).toContain('<path d="M12 5v14M5 12h14">');
    expect(php).toContain("Contribution</a>");
  });
  it("has the phone rule (44px, no negative margin) and reduced motion", () => {
    expect(php).toContain("@media (max-width:720px){.rv-contribute-btn{margin-right:0;min-height:44px");
    expect(php).toContain("prefers-reduced-motion:reduce");
  });
  it("is inserted inside the bar nav via the shortcode filter, once", () => {
    expect(php).toContain("'do_shortcode_tag'");
    expect(php).toContain("'rv_sector_bar' !== $tag");
    expect(php).toContain("strripos( $output, '</nav>' )");
    expect(php.match(/false !== strpos\( \$output, 'rv-contribute-btn' \)/g)?.length).toBe(1);
    expect(php).toContain("document.querySelector( '.rv-contribute-btn' )"); // JS fallback never duplicates
  });
  it("is admin-only until RV_CONTRIBUTE_PUBLIC, never on Contact Us, URL from RV_CONTRIBUTE_URL", () => {
    expect(php).toContain("current_user_can( 'manage_options' )");
    expect(php).toContain("RV_CONTRIBUTE_PUBLIC");
    expect(php).toContain("array( 'contact-us', 'contact' )");
    expect(php).toContain("RV_CONTRIBUTE_URL");
  });
  it("makes no network or storage calls and edits no other plugin", () => {
    expect(php).not.toMatch(/fetch\(|XMLHttpRequest|localStorage|wp_remote_|update_option|file_put_contents/);
  });
});
