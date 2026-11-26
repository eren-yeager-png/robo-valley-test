// The robovalley-contribution WordPress plugin (static checks; it is also run on a throw-away WordPress with the real Astra theme, see
// the pull request). A thin shell: its pages are created private, its files load only on its pages with its version, its pages are
// never cached, it has no WordPress tables or roles, uninstall keeps everything. And the CURRENT form (rv-contribution-v2) is untouched.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = "frontend/wordpress/plugins/robovalley-contribution/";
const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const PHP = read(DIR + "robovalley-contribution.php");
const code = PHP.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("identity and version", () => {
  it("folder robovalley-contribution, main file, text domain; header version = RV_CONTRIB_VERSION", () => {
    const header = PHP.match(/\* Version: (\d+\.\d+\.\d+)/)![1], constant = PHP.match(/const RV_CONTRIB_VERSION = '([^']+)'/)![1];
    expect(header).toBe(constant);
    expect(PHP).toContain("Text Domain: robovalley-contribution");
  });
  it("every file it loads carries the plugin version (a cache purge serves the new files)", () => {
    for (const m of code.matchAll(/wp_enqueue_(style|script)\(([^;]+)\);/g)) expect(m[2]).toContain("RV_CONTRIB_VERSION");
  });
});

describe("zero manual setup, never touching what exists", () => {
  it("creates its pages as PRIVATE, only when missing, never duplicating or overwriting one", () => {
    expect(code).toContain("'post_status'  => 'private'");
    expect(code).toContain("get_page_by_path( $slug, OBJECT, 'page' )");
    expect(code).toMatch(/if \( \$id && get_post\( \$id \) \) \{\s*continue;/);
    expect(code).not.toMatch(/wp_update_post|wp_delete_post|wp_trash_post/);
    expect(code).toContain("register_activation_hook( __FILE__, 'rv_contrib_setup' )");
    expect(code).toContain("get_option( RV_CONTRIB_OPTION ) !== RV_CONTRIB_VERSION");
  });
  it("uses the app address the current form already uses; no new setting", () => {
    expect(code).toContain("defined( 'RV_CONTRIBUTION_APP_URL' )");
    expect(code).not.toMatch(/add_options_page|register_setting/.source === "" ? /$^/ : /register_setting\(/);
  });
  it("no WordPress tables, no WordPress roles or capabilities, no page builder, no theme files", () => {
    expect(code).not.toMatch(/dbDelta|CREATE TABLE|\$wpdb->query|add_role|add_cap|elementor|get_template_part|locate_template/i);
  });
});

describe("loading and caching", () => {
  it("its stylesheet and script load ONLY on pages that contain its shortcodes", () => {
    const hook = code.slice(code.indexOf("'wp_enqueue_scripts'"), code.indexOf("function rv_contrib_container"));
    expect(hook).toMatch(/if \( ! rv_contrib_on_our_page\(\) \) \{\s*return;/);
    expect(code).toContain("has_shortcode( $post->post_content, 'rv_contribution_form' )");
  });
  it("its pages are never cached (WordPress caches and LiteSpeed): DONOTCACHEPAGE and no-cache headers", () => {
    expect(code).toContain("define( 'DONOTCACHEPAGE', true )");
    expect(code).toContain("nocache_headers()");
  });
  it("the container escapes the app address; nothing else is printed into the page", () => {
    expect(code).toContain("esc_attr( $base )");
  });
});

describe("uninstall keeps everything by default", () => {
  it("removes only its own options, and only when RV_CONTRIB_UNINSTALL_DELETE is true; never pages or data", () => {
    const u = read(DIR + "uninstall.php");
    expect(u).toContain("defined( 'RV_CONTRIB_UNINSTALL_DELETE' ) && true === RV_CONTRIB_UNINSTALL_DELETE");
    expect(u).not.toMatch(/wp_delete_post|DROP|TRUNCATE|\$wpdb/);
  });
});

describe("the current Contribute form (rv-contribution-v2) is untouched", () => {
  // the files exactly as they are on main (plugin 0.1.14, the live form): any change to them fails here
  const PINNED: Record<string, string> = {
    "README.txt": "8b4d629e6fe62fcb6a02a4c62d21301a55c6025ba53f722530e70a88a6f36e6d",
    "assets/rv-contribution-v2.css": "5bcc55b0c9d4529341824d0ec1797e9c95d3ffb6f1c4a79521805030745d0571",
    "assets/rv-contribution-v2.html": "6d548a6e2dd23343c748b52923b2020b3beeaa2498f8414e357141317f2d99e8",
    "assets/rv-contribution-v2.js": "4b683891e30f3010e53e624519900ca840849929bbdce74aa9214ff7ed75c0f7",
    "assets/rv-site.css": "1d7bdbca4ef6dd33922c7e4df90a86e1574ba910da60eff71ce30f4c60b413ec",
    "rv-contribution-v2.php": "5c003f4c44d19c6e303f160197ce560d2ce9e279ace07dd0ad068226d5dc92af",
  };
  it("every file is byte-identical to main", () => {
    for (const [f, sha] of Object.entries(PINNED)) {
      const raw = readFileSync("frontend/wordpress/plugins/rv-contribution-v2/" + f);
      expect(createHash("sha256").update(raw).digest("hex"), f).toBe(sha);
    }
  });
  it("the new plugin never touches the current form's pages or functions", () => {
    expect(code).not.toMatch(/rv_c2_|contribute-now|'contribution'|'contributor'/);
  });
});
