#!/usr/bin/env node
// WordPress lifecycle of robovalley-contribution on the throw-away site (rig.mjs up): never a duplicate page, the sector buttons come and
// go with the plugin, the administrator's per-field setting survives, and every way of turning it off (switch OFF, deactivate,
// uninstall) gives today's behaviour back. Run it AFTER e2e.mjs or on a fresh site; it starts from switch OFF.
//   node tools/contribution-e2e/lifecycle.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, WP as W, assertLocal } from "./lib/config.mjs";
import { installPlugin, wp } from "./lib/docker.mjs";

assertLocal(W);
const PLUGIN = join(ROOT, "frontend", "wordpress", "plugins", "robovalley-contribution");
const version = (readFileSync(join(PLUGIN, "robovalley-contribution.php"), "utf8").match(/^\s*\*\s*Version:\s*(\S+)/m) || [])[1];
const SECTOR = `${W}/robots-by-sector/agriculture-dairy/`;
let pass = 0, fail = 0;
const check = (n, got, want) => { if (got === want) { pass++; console.log("PASS " + n); } else { fail++; console.log(`FAIL ${n}  -> got [${got}], want [${want}]`); } };
const pages = () => wp(["post", "list", "--post_type=page", "--post_status=any", "--fields=post_name,post_status", "--format=csv"])
  .split("\n").filter((l) => /^(share-your-idea|community-ideas),/.test(l)).sort().join(" ");
const shortcodes = () => JSON.parse(wp(["post", "list", "--post_type=page", "--post_status=any", "--fields=ID,post_content", "--format=json"]))
  .filter((p) => /\[rv_contribution_form\]|\[rv_community_ideas\]/.test(p.post_content)).length;
const code = async (u) => (await fetch(u, { redirect: "manual" })).status;
const html = async (u) => (await fetch(u)).text();
/** The current form's own sector button (rv-contribution-v2) on the sector page: where it points. */
const v2btn = async () => { const tag = ((await html(SECTOR)).match(/<a\b[^>]*\brv-c2-sector-btn\b[^>]*>/) || [""])[0]; return (tag.match(/href="([^"]*)"/) || [])[1] || null; };
/** Whether the sector page loads the script that adds "Contribute to this sector" (header and fields). */
const buttons = async () => /assets\/js\/rv-sector\.js/.test(await html(SECTOR));
const option = (name) => { try { return wp(["option", "get", name]); } catch { return "(absent)"; } };

try {
  wp(["option", "update", "rv_contrib_switch_over", "0"]);
  check("start: the two pages exist once, private (switch OFF)", pages(), "community-ideas,private share-your-idea,private");
  check("start: the sector page has the contribute buttons' script", await buttons(), true);
  wp(["option", "update", "rv_contrib_switch_over", "1"]);
  check("switch ON: both pages public", pages(), "community-ideas,publish share-your-idea,publish");
  check("switch ON: /contribute-now/ redirects", await code(`${W}/contribute-now/`), 301);
  wp(["option", "update", "rv_contrib_fields_off", "agriculture-dairy/drone-sprayers"]);
  wp(["plugin", "deactivate", "robovalley-contribution"]);
  check("deactivated (switch still ON): both pages private again", pages(), "community-ideas,private share-your-idea,private");
  check("deactivated: /contribute-now/ is the current form again (200)", await code(`${W}/contribute-now/`), 200);
  check("deactivated: the current form's sector button points at the current form", await v2btn(), `${W}/contribute-now/?sector=agriculture-dairy`);
  check("deactivated: no contribute buttons' script on the sector page (the current form's own button is back)", await buttons(), false);
  check("deactivated: a visitor gets 404 on the new form", await code(`${W}/share-your-idea/`), 404);
  wp(["plugin", "activate", "robovalley-contribution"]);
  check("reactivated (switch ON): still exactly two pages, public again, no duplicate", pages(), "community-ideas,publish share-your-idea,publish");
  check("reactivated: one page per shortcode", shortcodes(), 2);
  check("reactivated: redirect back", await code(`${W}/contribute-now/`), 301);
  check("reactivated: the buttons are back", await buttons(), true);
  check("reactivated: the administrator's per-field setting was kept", /agriculture-dairy\\?\/drone-sprayers/.test(await html(SECTOR)) && /drone-sprayers/.test(option("rv_contrib_fields_off")), true);
  wp(["option", "update", "rv_contrib_setup_version", "1.3.1"]);
  await code(`${W}/`); // any request runs the version check (plugins_loaded)
  check("after a version change the setup ran again (this version recorded)", option("rv_contrib_setup_version"), version);
  check("version change: still exactly two pages", pages(), "community-ideas,publish share-your-idea,publish");
  wp(["option", "update", "rv_contrib_switch_over", "0"]);
  check("switch OFF: private again", pages(), "community-ideas,private share-your-idea,private");
  check("switch OFF: no redirect", await code(`${W}/contribute-now/?sector=agriculture-dairy`), 200);
  check("switch OFF: the current form's button is the current form's", await v2btn(), `${W}/contribute-now/?sector=agriculture-dairy`);
  wp(["plugin", "uninstall", "robovalley-contribution", "--deactivate"]);
  check("uninstalled: the plugin's files are gone", /robovalley-contribution/.test(wp(["plugin", "list", "--field=name"])), false);
  check("uninstalled: its pages stay (an administrator decides), private", pages(), "community-ideas,private share-your-idea,private");
  check("uninstalled: its settings stay unless RV_CONTRIB_UNINSTALL_DELETE is set", /drone-sprayers/.test(option("rv_contrib_fields_off")), true);
  check("uninstalled: the sector page is today's page (no buttons' script, the current form's button)", `${await buttons()} ${await v2btn()}`, `false ${W}/contribute-now/?sector=agriculture-dairy`);
  installPlugin("robovalley-contribution", PLUGIN);
  check("installed again: still exactly two pages (no duplicate), one per shortcode", `${pages()} ${shortcodes()}`, "community-ideas,private share-your-idea,private 2");
  check("installed again: the buttons are back", await buttons(), true);
} catch (e) {
  fail++; console.log("FAIL crashed: " + String((e && e.stack) || e).slice(0, 600));
} finally {
  try { wp(["option", "delete", "rv_contrib_fields_off"]); } catch { /* not set */ }
  console.log(`lifecycle: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}
