// The robovalley-contribution WordPress plugin (static checks; it is also run on a throw-away WordPress with the real Astra theme, see
// the pull request). A thin shell: its pages are created private, its files load only on its pages with its version, its pages are
// never cached, it has no WordPress tables or roles, uninstall keeps everything. And the CURRENT form (rv-contribution-v2) is untouched.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = "frontend/wordpress/plugins/robovalley-contribution/";
const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const PHP = read(DIR + "robovalley-contribution.php");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const code = strip(PHP);
const SB = read(DIR + "sector-buttons.php"), sb = strip(SB); // the sector pages' buttons: THE injection hook

describe("identity and version", () => {
  it("folder robovalley-contribution, main file, text domain; header version = RV_CONTRIB_VERSION", () => {
    const header = PHP.match(/\* Version: (\d+\.\d+\.\d+)/)![1], constant = PHP.match(/const RV_CONTRIB_VERSION = '([^']+)'/)![1];
    expect(header).toBe(constant);
    expect(PHP).toContain("Text Domain: robovalley-contribution");
  });
  it("every file it loads carries the plugin version (a cache purge serves the new files)", () => {
    for (const m of (code + sb).matchAll(/wp_enqueue_(style|script)\(([^;]+)\);/g)) expect(m[2]).toContain("RV_CONTRIB_VERSION");
  });
});

describe("zero manual setup, never touching what exists", () => {
  it("owns two pages, Share Your Idea and Community Ideas, each with its shortcode", () => {
    expect(code).toContain("'rv_contrib_page_form'  => array( 'share-your-idea', 'Share Your Idea', '[rv_contribution_form]' )");
    expect(code).toContain("'rv_contrib_page_ideas' => array( 'community-ideas', 'Community Ideas', '[rv_community_ideas]' )");
    expect(code).toMatch(/add_shortcode\(\s*'rv_community_ideas'/);
  });
  it("creates its pages as PRIVATE (public only once switched over), only when missing, never duplicating or overwriting one", () => {
    expect(code).toContain("'post_status'  => rv_contrib_switched() ? 'publish' : 'private'");
    expect(code).toContain("get_page_by_path( $slug, OBJECT, 'page' )");
    expect(code).toContain("if ( $existing && has_shortcode( $existing->post_content, trim( $shortcode, '[]' ) ) )"); // someone else's page is never adopted
    expect(code).toMatch(/if \( \$id && get_post\( \$id \) \) \{\s*continue;/);
    expect(code).not.toMatch(/wp_delete_post|wp_trash_post/);
    // the ONLY change it ever makes to a page: the visibility of its own pages, for the switch-over
    expect(code.match(/wp_update_post\(/g)).toHaveLength(1);
    expect(code).toContain("wp_update_post( array( 'ID' => $id, 'post_status' => $want ) )");
    expect(code).toContain("|| ! has_shortcode( $post->post_content, trim( $page[2], '[]' ) )");
    expect(code).toContain("register_activation_hook( __FILE__, 'rv_contrib_setup' )");
    expect(code).toContain("get_option( RV_CONTRIB_OPTION ) !== RV_CONTRIB_VERSION");
  });
  it("uses the app address the current form already uses; its settings: the switch-over and the per-field button switch", () => {
    expect(code).toContain("defined( 'RV_CONTRIBUTION_APP_URL' )");
    expect(code.match(/register_setting\(/g)).toHaveLength(1);
    expect(code).toMatch(/register_setting\(\s*'rv_contrib',\s*RV_CONTRIB_SWITCH,/);
    expect(sb.match(/register_setting\(/g)).toHaveLength(1);
    expect(sb).toMatch(/register_setting\(\s*'rv_contrib',\s*RV_CONTRIB_FIELDS_OFF,/);
  });
  it("no WordPress tables, no WordPress roles or capabilities, no page builder, no theme files", () => {
    expect(code + sb).not.toMatch(/dbDelta|CREATE TABLE|\$wpdb->query|add_role|add_cap|get_template_part|locate_template/i);
    expect(code).not.toMatch(/elementor/i); // (sector-buttons.php only names Elementor's section classes in a comment)
  });
});

describe("loading and caching", () => {
  it("its stylesheet and script load ONLY on pages that contain its shortcodes", () => {
    const hook = code.slice(code.indexOf("'wp_enqueue_scripts'"), code.indexOf("function rv_contrib_container"));
    expect(hook).toMatch(/if \( ! rv_contrib_on_our_page\(\) \) \{\s*return;/);
    expect(code).toContain("has_shortcode( $post->post_content, 'rv_contribution_form' )");
    expect(code).toContain("has_shortcode( $post->post_content, 'rv_community_ideas' )");
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
  it("the new plugin never calls the current form's code or edits its pages; it only names their addresses for the switch-over", () => {
    expect(code + sb).not.toMatch(/rv_c2_/);
    expect(sb.split("\n").filter((l) => /contribute-now/.test(l)).map((l) => l.trim())).toEqual(["return home_url( '/' . ( $slugs ? $slugs[0] : 'contribute-now' ) . '/' );"]);
    const named = code.split("\n").filter((l) => /contribute-now|'contribution'|'contributor'/.test(l)).map((l) => l.trim());
    expect(named).toEqual(["$raw = defined( 'RV_CONTRIBUTION_PAGES' ) ? (string) RV_CONTRIBUTION_PAGES : 'contribute-now,contribution,contributor';"]);
  });
});

describe("the switch-over (one setting, OFF by default; turning it off restores today's behaviour)", () => {
  const tail = code.slice(code.indexOf("function rv_contrib_old_slugs"));
  it("is OFF unless an administrator turned it on; the setting is saved only as '1' or '0'", () => {
    expect(code).toContain("return '1' === (string) get_option( RV_CONTRIB_SWITCH, '0' );");
    expect(code).toContain("const RV_CONTRIB_SWITCH  = 'rv_contrib_switch_over';");
    expect(code).toContain("return '1' === (string) $v ? '1' : '0';");
    expect(code).toContain("add_options_page( 'Contribution workflow', 'Contribution workflow', 'manage_options'");
  });
  it("ON: the current form's pages redirect to Share Your Idea with 301, keeping a cleaned ?sector=, never cached; OFF: nothing", () => {
    const hook = tail.slice(tail.indexOf("'template_redirect'"), tail.indexOf("'the_content'"));
    expect(hook).toMatch(/if \( ! rv_contrib_switched\(\) \|\| is_admin\(\) \|\| wp_doing_ajax\(\) \|\| is_preview\(\) \) \{\s*return;/);
    expect(hook).toContain("! is_page( $slugs )");
    expect(hook).toContain("rv_contrib_sector_arg( wp_unslash( (string) $_GET['sector'] ) )");
    expect(hook).toContain("wp_safe_redirect( $to, 301, 'RoboValley Contribution' );");
    expect(hook).toContain("header( 'Cache-Control: no-store, max-age=0', true );");
    expect(hook).toContain("define( 'DONOTCACHEPAGE', true );");
    expect(code).toContain("return sanitize_title( $first[0] );");
    expect(code).toContain("array( 'contact-us', 'contact', 'share-your-idea', 'community-ideas' )"); // never a contact page, never a loop
  });
  it("ON: the sector page's button points straight at the new form (after the current plugin printed it, priority 1000); OFF: untouched", () => {
    const f = tail.slice(tail.indexOf("'the_content'"), tail.indexOf("'admin_init'"));
    expect(f).toMatch(/if \( ! rv_contrib_switched\(\) \|\| false === strpos\( \(string\) \$content, 'rv-c2-sector-btn' \) \) \{\s*return \$content;/);
    expect(f).toContain("'#(<a class=\"rv-c2-sector-btn\" href=\")([^\"]*)(\")#'");
    expect(f).toMatch(/\},\s*1001\s*\);/);
  });
  it("the pages follow the setting when it is saved; deactivating the plugin makes them private again", () => {
    expect(code).toContain("add_action( 'update_option_' . RV_CONTRIB_SWITCH, 'rv_contrib_apply_visibility_after_save' );");
    expect(code).toContain("add_action( 'add_option_' . RV_CONTRIB_SWITCH, 'rv_contrib_apply_visibility_after_save' );");
    expect(code).toMatch(/register_deactivation_hook\(\s*__FILE__,\s*function \(\) \{\s*rv_contrib_apply_visibility\( false \);/);
  });
});

describe("\"Contribute to this sector\" on every sector page and every field (sector-buttons.php: THE injection hook)", () => {
  it("is loaded by the plugin itself, so it is active whenever the plugin is", () => {
    expect(code).toContain("require_once __DIR__ . '/sector-buttons.php';");
  });
  it("marks the content area at a LATE priority (after other plugins and page builders), on sector pages only", () => {
    const f = sb.slice(sb.indexOf("'the_content'"), sb.indexOf("'wp_enqueue_scripts'"));
    expect(f).toMatch(/'' === rv_contrib_fields_page_slug\(\)/);
    expect(f).toContain('<div class="rv-fields-root" data-rv-sector="');
    expect(f).toMatch(/\},\s*PHP_INT_MAX - 10\s*\);/);
  });
  it("sector pages = every child page of the Robots by Sector page (new ones too), or one named by the rv_contrib_sector_slug filter", () => {
    expect(sb).toContain("defined( 'RV_CONTRIBUTION_SECTOR_PARENT' ) ? sanitize_title( (string) RV_CONTRIBUTION_SECTOR_PARENT ) : 'robots-by-sector'");
    expect(sb).toContain("apply_filters( 'rv_contrib_sector_slug', $slug )");
    expect(sb).toContain("apply_filters( 'rv_contrib_field_selectors', array() )");
  });
  it("loads its script and stylesheet late, on sector pages only, with the version; prints them anyway if another plugin dequeued them", () => {
    const e = sb.slice(sb.indexOf("'wp_enqueue_scripts'"), sb.indexOf("'wp_print_footer_scripts'"));
    expect(e).toMatch(/if \( '' === rv_contrib_fields_page_slug\(\) \) \{\s*return;/);
    expect(e).toContain("plugins_url( 'assets/js/rv-sector.js', __FILE__ ), array(), RV_CONTRIB_VERSION, true");
    expect(e).toMatch(/\},\s*PHP_INT_MAX - 10\s*\);/);
    const fb = sb.slice(sb.indexOf("'wp_print_footer_scripts'"), sb.indexOf("'admin_init'"));
    expect(fb).toContain("wp_script_is( 'rv-sector', 'done' )");
    expect(fb).toMatch(/\},\s*PHP_INT_MAX\s*\);/);
  });
  it("shows to every visitor and role: no role, sign-in or switch check hides it; only the per-field setting does", () => {
    expect(sb).not.toMatch(/current_user_can|is_user_logged_in|RV_CONTRIBUTE_PUBLIC|is_admin\(\)/);
    expect(sb).toContain("'off'        => rv_contrib_fields_off(),");
    expect(sb).toContain("$parts = array_map( 'sanitize_title', explode( '/', trim( (string) $line ), 2 ) );"); // cleaned, at most "<sector>/<field>"
    expect(read(DIR + "uninstall.php")).toContain("'rv_contrib_fields_off'");
  });
  it("leads to the contribute flow that is live: Share Your Idea once switched over, otherwise the current form's page", () => {
    expect(sb).toMatch(/\$new = rv_contrib_switched\(\) \? rv_contrib_form_url\(\) : '';/);
  });
  it("the switch-over redirect keeps a cleaned field, resource and way back (a page cached before the switch-over)", () => {
    const hook = code.slice(code.indexOf("'template_redirect'", code.indexOf("function rv_contrib_old_slugs")), code.indexOf("'the_content'", code.indexOf("function rv_contrib_old_slugs")));
    expect(hook).toContain("sanitize_title( wp_unslash( (string) $_GET['field'] ) )");
    expect(hook).toContain("esc_url_raw( wp_unslash( (string) $_GET[ $arg ] ), array( 'http', 'https' ) )");
    expect(hook).toContain("foreach ( array( 'resource_url', 'return_to' ) as $arg )");
  });
});
