#!/usr/bin/env node
// CONTRIBUTION PORTAL check: every portal page in every role at 1440, 1024 and 390 pixels wide, on the throw-away local stack (rig.mjs
// up: the app on 127.0.0.1 with its own Postgres container) and in the standalone demo, with the checks the brief asks for:
//   no sideways scrolling, no overlapping blocks, no stretched buttons, no word broken in the middle, Sent dates on one line, and the
//   keyboard reaching the page with a visible focus ring;
// and a screenshot of each page, named <phase>-<role>-<page>-<width>-<label>.png. Our own headless browser behind the safety gate
// (lib/browser.mjs: pass your live site's host names in RV_E2E_BLOCK_HOSTS at run time). Exit code 1 if a check failed (--label after).
//   node tools/contribution-e2e/portal.mjs --label before|after [--out <dir>] [--only app|demo] [--demo <file>] [--phase A]
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { APP, OUT, ROOT, USERS, assertLocal, secrets } from "./lib/config.mjs";
import { sql } from "./lib/docker.mjs";
import { seed } from "./lib/seed.mjs";
import { startBrowser } from "./lib/browser.mjs";

const arg = (k, d = "") => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const LABEL = arg("label", "after"), PHASE = arg("phase", "A"), ONLY = arg("only", "");
const OUTDIR = resolve(arg("out", join(OUT, "portal")));
const DEMO = resolve(arg("demo", join(ROOT, "docs", "reference", "contribution_demo.html")));
const WIDTHS = [[1440, 900], [1024, 768], [390, 844]];
const J = JSON.stringify;
mkdirSync(OUTDIR, { recursive: true });
const results = [];
let failed = 0;
const record = (r) => { results.push(r); const bad = problems(r); if (bad.length && LABEL === "after") failed++; console.log(`${bad.length ? "FAIL" : "ok  "} ${r.name} ${r.width}${bad.length ? "  -> " + bad.join("; ") : ""}`); };
const problems = (r) => [
  r.c.hscroll && "scrolls sideways", r.c.overlaps.length && `overlap: ${r.c.overlaps.join(", ")}`, r.c.stretched.length && `stretched: ${r.c.stretched.join(", ")}`,
  r.c.brokenCount && `${r.c.brokenCount} word(s) broken: ${r.c.broken.join(", ")}`, r.c.multiSent && `${r.c.multiSent} Sent date(s) on two lines`,
  r.focus && !r.focus.ok && `keyboard focus: ${r.focus.why}`, r.errors && r.errors.length && `script errors: ${r.errors.join(" | ").slice(0, 200)}`,
].filter(Boolean);

// ---- the checks, measured in the page (root: the page column, or the demo's main area)
const CHECKS = (rootSel) => `(function(){
  var root = document.querySelector(${J(rootSel)}) || document.body, vw = window.innerWidth;
  var hscroll = document.scrollingElement.scrollWidth > vw + 1;
  var col = root.querySelector('.rv-pp') || root;
  var kids = Array.prototype.filter.call(col.children, function (e) { var cs = getComputedStyle(e); return e.offsetParent !== null && cs.position !== 'fixed' && cs.position !== 'absolute' && e.getBoundingClientRect().height > 0; });
  var overlaps = [];
  for (var i = 0; i < kids.length; i++) for (var j = i + 1; j < kids.length; j++) {
    var a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
    if (a.bottom > b.top + 1 && b.bottom > a.top + 1 && a.right > b.left + 1 && b.right > a.left + 1) overlaps.push((kids[i].className || kids[i].tagName) + ' / ' + (kids[j].className || kids[j].tagName));
  }
  var stretched = [];
  Array.prototype.forEach.call(root.querySelectorAll('.rv-pp .btn, .rv-pp .rv-contribute-btn, .rv-pp-drawer .btn'), function (btn) {
    if (!btn.offsetParent) return;
    var r = btn.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(btn);
    var c = range.getBoundingClientRect(), cs = getComputedStyle(btn);
    var pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
    if (r.width > c.width + pad + 32 && r.width > 160) stretched.push(btn.textContent.trim().slice(0, 30) + ' (' + Math.round(r.width) + 'px)');
  });
  var broken = [], count = 0, w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), n;
  while ((n = w.nextNode()) && count < 6000) {
    var el = n.parentElement;
    if (!el || !el.offsetParent || el.closest('script,style,textarea,code,.rv-pp-slug,[aria-hidden="true"],.cw-diff,.rv-fields-root,.rv-sector-card,.rvd-wp')) continue;
    var re = /[A-Za-z0-9]{4,}/g, m; // runs of letters and digits: a line may break at a hyphen, a dot or an @, never inside a run
    while ((m = re.exec(n.data))) {
      count++;
      var rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
      var rects = Array.prototype.filter.call(rg.getClientRects(), function (x) { return x.width > 0.5; });
      if (rects.length > 1 && Math.abs(rects[0].top - rects[rects.length - 1].top) > 2) broken.push(m[0].slice(0, 30));
    }
  }
  var multiSent = Array.prototype.filter.call(root.querySelectorAll('.rv-pp-sent'), function (t) { var lh = parseFloat(getComputedStyle(t).lineHeight) || 20; return t.getBoundingClientRect().height > lh * 1.6; }).length;
  return { hscroll: hscroll, overlaps: overlaps, stretched: stretched.slice(0, 6), broken: broken.slice(0, 6), brokenCount: broken.length, multiSent: multiSent };
})()`;
const FOCUS = (rootSel) => `(function(){
  var root = document.querySelector(${J(rootSel)}) || document.body;
  var focusable = root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
  if (!focusable.length) return { ok: true, why: '' }; // nothing on this page takes the keyboard
  var a = document.activeElement;
  if (!a || a === document.body) return { ok: false, why: 'nothing focused after Tab' };
  var cs = getComputedStyle(a), ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
  return { ok: !!ring, why: ring ? '' : 'no visible ring on ' + (a.tagName + '.' + a.className).slice(0, 60) };
})()`;

/** Presses Tab (up to four times) until the keyboard is on something inside the page's own area. */
async function tabIn(b, rootSel) {
  for (let i = 0; i < 4; i++) {
    await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await b.sleep(120);
    if ((await b.ev(`(function(){var r=document.querySelector(${J(rootSel)}),a=document.activeElement;return !!(r&&a&&a!==r&&r.contains(a))})()`)) === true) return;
  }
}
async function measure(b, name, rootSel, w, h, { focus = false } = {}) {
  await b.sleep(250);
  const c = await b.ev(CHECKS(rootSel));
  await b.shot(join(OUTDIR, `${PHASE}-${name}-${w}-${LABEL}.png`), { full: true }); // before the keyboard check, so no focus ring is in the picture
  let f = null;
  if (focus) { await b.ev("document.activeElement && document.activeElement.blur(); window.scrollTo(0,0)"); await b.ev(`(function(){var m=document.querySelector(${J(rootSel)});if(m){m.setAttribute('tabindex','-1');m.focus();m.removeAttribute('tabindex');}})()`); await tabIn(b, rootSel); f = await b.ev(FOCUS(rootSel)); }
  const errors = b.errors.splice(0).filter((e) => !/favicon|rv-header-menu|DevTools/i.test(e));
  record({ name, width: w, c: typeof c === "object" ? c : { hscroll: false, overlaps: [], stretched: [], broken: [String(c)], brokenCount: 1, multiSent: 0 }, focus: f, errors });
}

// ---- the app: the portal's sample data (once per database), then every page of every role
const sq = (v) => `'${String(v).replace(/'/g, "''")}'`;
function seedSql() {
  sql("INSERT INTO sectors (slug, name, sort_order) VALUES ('manufacturing', 'Manufacturing', 40) ON CONFLICT (slug) DO NOTHING");
  for (const [sector, slug, name, order] of [["healthcare", "pharmacy-robots", "Pharmacy robots", 10], ["healthcare", "delivery-robots", "Delivery robots", 20], ["manufacturing", "cobots", "Cobots", 10], ["manufacturing", "robotic-arms", "Robotic arms", 20]]) {
    sql(`INSERT INTO sector_robot_types (sector_id, slug, name, sort_order) SELECT id, ${sq(slug)}, ${sq(name)}, ${order} FROM sectors WHERE slug = ${sq(sector)} ON CONFLICT DO NOTHING`);
  }
  if (Number(sql("SELECT count(*) FROM contributions WHERE title = 'Robot kit lending library at school'")) > 0) return;
  const first = (out) => String(out).split(/\r?\n/)[0].trim(); // psql -tA prints the value, then the command tag ("INSERT 0 1")
  const id = (email) => first(sql(`SELECT id FROM users WHERE email = ${sq(email)}`));
  const old = (who, title, status, sector, verifiedBy = "") => {
    const cid = first(sql(`INSERT INTO contributions (user_id, type, type_chosen, title, body) VALUES (${id(who)}, 'improve', true, ${sq(title)}, 'Made up for the portal check.') RETURNING id`));
    sql(`INSERT INTO contribution_scopes (contribution_id, sector_id) SELECT ${cid}, id FROM sectors WHERE slug = ${sq(sector)}`);
    sql(`UPDATE contributions SET status = ${sq(status)}, submitted_at = now() - interval '3 days', published_at = CASE WHEN ${sq(status)} = 'published' THEN now() - interval '1 day' END WHERE id = ${cid}`);
    if (verifiedBy) sql(`INSERT INTO contribution_reviews (contribution_id, reviewer_id, action) VALUES (${cid}, ${id(verifiedBy)}, 'verify')`);
  };
  old(USERS.minor.email, "Robot kit lending library at school", "pending_review", "education");
  old(USERS.member.email, "Lab safety checklist for robot kits", "changes_requested", "education");
  old(USERS.minor.email, "Line follower race day", "published", "education");
  old(USERS.parent.email, "Hospital delivery robot visit", "pending_review", "healthcare", USERS.mod.email);
}
const pw = () => secrets().users;
async function signIn(b, who) {
  await b.send("Network.clearBrowserCookies");
  await b.go(APP + "/login");
  return b.ev(`fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(${J({ email: USERS[who].email, password: pw()[who] })})}).then(function(r){return r.status})`);
}
const call = (b, method, path, body) => b.ev(`fetch(${J(path)},{method:${J(method)},credentials:'include',headers:{'content-type':'application/json'},body:${body === undefined ? "undefined" : J(J(body))}}).then(function(r){return r.json()})`);
const submitIdea = (b, data) => b.ev(`(function(){var fd=new FormData();fd.append('data',${J(J({ refers: false, robotType: "not-sure", categories: [], suitableFor: [], learningPath: "", references: [], kind: "New idea", ...data }))});return fetch('/api/cw/contributions',{method:'POST',credentials:'include',body:fd}).then(function(r){return r.json()})})()`);
const step = async (b, id, action, extra = {}) => { const it = (await call(b, "GET", `/api/cw/review/${id}`)).item; return call(b, "POST", `/api/cw/review/${id}`, { action, rowVersion: it.rowVersion, proposed: it.proposed, notes: it.notes || "", ...extra }); };
async function seedIdeas(b) {
  if (Number(sql("SELECT count(*) FROM cw_contributions WHERE original->>'title' = 'Robot club starter pack'")) > 0) return;
  const ids = {};
  const as = async (who, key, data) => { if ((await signIn(b, who)) !== 200) throw new Error(`sign-in failed: ${who}`); const r = await submitIdea(b, data); if (!r.id) throw new Error(`submit failed: ${J(r)}`); ids[key] = r.id; };
  await as("member", "club", { title: "Robot club starter pack", description: "Everything a school needs to start a robot club in one week: kits, a plan and a poster.", sector: "education", categories: ["Robotics"], suitableFor: ["K6–K8", "K9–K10"], learningPath: "Make" });
  await as("parent", "kids", { title: "Line follower kit that is safe for young children", description: "A line follower robot kit with no sharp parts that children can build with a parent.", sector: "education", categories: ["STEAM"], suitableFor: ["K1–K5"], learningPath: "Make" });
  await as("minor", "solar", { title: "Solar sensor for the school garden", description: "A small solar powered sensor that tells us when the school garden needs water.", sector: "education", categories: ["STEAM"] });
  await as("mentor", "weed", { title: "Weeding robot open day for farmers", description: "Farmers watch a weeding robot work on a real field and ask the makers questions.", sector: "agriculture-dairy" });
  await as("mentor", "drone", { title: "Drone battery swap station", description: "A shared station in the village where farmers swap charged batteries for their spraying drones.", sector: "agriculture-dairy", robotType: "drone-sprayers", categories: ["Robotics"] });
  await as("member", "suggest", { kind: "Suggestion", refers: true, resource: { feature: "Robots by Sector", type: "Sector page", path: "Robots by Sector › Education", url: "", change: "Please add this field." }, title: "Coding robots", description: "Small robots that children program to learn coding, for the Education sector page.", sector: "education", categories: ["Robotics"] });
  await as("parent", "hospital", { title: "Hospital robot visit day for families", description: "Families visit a hospital that uses delivery robots and see how they work safely.", sector: "healthcare", categories: ["Robotics"] });
  if ((await signIn(b, "mod")) !== 200) throw new Error("sign-in failed: mod");
  for (const k of ["club", "kids", "drone"]) await step(b, ids[k], "send_request");
  await step(b, ids.solar, "decline", { reason: "This idea is about gardening rather than robots. Please send it with a robot it needs." });
  if ((await signIn(b, "admin")) !== 200) throw new Error("sign-in failed: admin");
  for (const k of ["club", "kids"]) {
    const it = (await call(b, "GET", `/api/cw/review/${ids[k]}`)).item;
    await call(b, "POST", `/api/cw/review/${ids[k]}`, { action: "preview", rowVersion: it.rowVersion, version: it.versions.length });
    const again = (await call(b, "GET", `/api/cw/review/${ids[k]}`)).item;
    const r = await call(b, "POST", `/api/cw/review/${ids[k]}`, { action: "publish", rowVersion: again.rowVersion });
    if (!r.item || r.item.status !== "published") console.log("note: publishing", k, "did not finish:", J(r).slice(0, 200));
  }
  console.log("portal sample data: added");
}

const BOTH = "before,after";
// [role (who signs in), page, address, ready, labels it applies to]
const APP_PAGES = () => {
  const parentId = String(sql(`SELECT id FROM users WHERE email = ${sq(USERS.parent.email)}`)).split(/\r?\n/)[0].trim();
  return [
    ["admin", "admin", "overview", "/admin/dashboard", "!!document.querySelector('.adm-main h1, .adm-main h2')", BOTH],
    ["admin", "admin", "publish-requests", "/admin/approvals", "!!document.querySelector('.rv-pp-table, .rv-pp-empty, .cw-item, .cw-empty')", BOTH],
    ["admin", "admin", "moderation", "/admin/moderation?sector=education", "!!document.querySelector('.rv-pp-table, .rv-pp-empty, .mod-sector')", BOTH],
    ["admin", "admin", "sector-forms", "/admin/sector-forms?sector=education", "!!document.querySelector('.rv-pp-table, .rv-pp-empty, .adm-table')", BOTH],
    ["admin", "admin", "sector-forms-suggested", "/admin/sector-forms?sector=education&tab=suggested", "!!document.querySelector('.rv-pp-table, .rv-pp-empty')", "after"],
    ["admin", "admin", "sector-form-education", "/admin/sector-forms/education", "!!document.querySelector('.adm-main section, .adm-main .rv-sector-headbar')", BOTH],
    ["admin", "admin", "sectors", "/admin/sectors?sector=education", "!!document.querySelector('.rv-pp-table, .adm-table')", BOTH],
    ["admin", "admin", "users-roles", "/admin/users", "!!document.querySelector('.adm-main table')", BOTH],
    ["admin", "admin", "view-as", `/admin/users/${parentId}/view`, "!!document.querySelector('.rv-pp-table, .rv-pp-empty, .cw-notice')", "after"],
    ["admin", "admin", "community-ideas", "/admin/community-ideas", "!!document.querySelector('.rv-site-body *')", "after"],
    ["admin", "admin", "audit-log", "/admin/audit-log", "!!document.querySelector('.rv-pp-table, .rv-pp-empty')", "after"],
    ["mod", "moderator", "moderation", "/admin/moderation?sector=education", "!!document.querySelector('.rv-pp-table, .rv-pp-empty, .mod-sector')", BOTH],
    ["mod", "moderator", "moderation-sector-list", "/admin/moderation/sector/education", "!!document.querySelector('.rv-pp-table, .mod-table, .adm-note, .rv-pp-empty')", BOTH],
    ["mod", "moderator", "workspace", "/admin/workspace", "!!document.querySelector('.rv-pp-table, .cw-item, .cw-empty, .rv-pp-empty')", BOTH],
    ["mod", "moderator", "my-contributions", "/my-contributions", "!!document.querySelector('.rv-pp-table, .rv-mine-table, .cw-notice')", BOTH],
    ["minor", "student", "sectors", "/dashboard/sectors?sector=education", "!!document.querySelector('.rv-sg, .rv-sector-cards')", BOTH],
    ["minor", "student", "my-contributions", "/my-contributions", "!!document.querySelector('.rv-pp-table, .rv-mine-table, .cw-notice')", BOTH],
    ["member", "teacher", "sectors", "/dashboard/sectors?sector=education", "!!document.querySelector('.rv-sg, .rv-sector-cards')", BOTH],
    ["member", "teacher", "sector-page", "/dashboard/sectors/education", "!!document.querySelector('.rv-sector-page')", BOTH],
    ["parent", "parent", "sectors", "/dashboard/sectors?sector=education", "!!document.querySelector('.rv-sg, .rv-sector-cards')", BOTH],
    ["parent", "parent", "my-contributions", "/my-contributions", "!!document.querySelector('.rv-pp-table, .rv-mine-table, .cw-notice')", BOTH],
    ["mentor", "contributor", "sectors", "/dashboard/sectors?sector=agriculture-dairy", "!!document.querySelector('.rv-sg, .rv-sector-cards')", BOTH],
    ["mentor", "contributor", "my-contributions", "/my-contributions", "!!document.querySelector('.rv-pp-table, .rv-mine-table, .cw-notice')", BOTH],
  ];
};
// a few pages in a state worth seeing: after opening a drawer or a tab (after only; the screens did not exist before)
const INTERACTIONS = [
  ["mod", "moderator", "moderation-edit-approve", "/admin/moderation?sector=agriculture-dairy", "!!document.querySelector('[data-act=\"edit\"]')", "document.querySelector('[data-act=\"edit\"]').click()", "!!document.querySelector('.rv-pp-drawer .cw-detail')"],
  ["admin", "admin", "publish-preview", "/admin/approvals", "!!document.querySelector('[data-act=\"preview\"]')", "document.querySelector('[data-act=\"preview\"]').click()", "!!document.querySelector('.cw-modal [data-pv-act]')"],
  ["admin", "admin", "add-field", "/admin/sector-forms?sector=healthcare", "!!document.querySelector('[data-add]')", "document.querySelector('[data-add]').click()", "!!document.querySelector('.rv-pp-modal')"],
  ["parent", "parent", "sectors-my-contributions-tab", "/dashboard/sectors?sector=education", "!!document.querySelector('[data-tab=\"mine\"]')", "document.querySelector('[data-tab=\"mine\"]').click()", "!!document.querySelector('[data-mine] .rv-pp-table, [data-mine] .rv-pp-empty')"],
  ["mentor", "contributor", "contribute-dialog", "/dashboard/sectors?sector=agriculture-dairy", "!!document.querySelector('[data-quick]')", "(document.querySelector('[data-quick=\"drone-sprayers\"]') || document.querySelector('[data-quick]')).click()", "!!document.querySelector('.rv-pp-modal')"],
];

async function appRun(b) {
  seedSql();
  await seed(); // the people (idempotent)
  await seedIdeas(b);
  for (const [who, role, page, path, ready, labels] of APP_PAGES()) {
    if (!labels.split(",").includes(LABEL)) continue;
    if ((await signIn(b, who)) !== 200) throw new Error(`sign-in failed: ${who}`);
    for (const [w, h] of WIDTHS) {
      await b.viewport(w, h);
      await b.go(APP + path, ready);
      await b.ev("document.fonts && document.fonts.ready");
      await measure(b, `${role}-${page}`, ".adm-main, main", w, h, { focus: w === 1440 });
    }
  }
  if (LABEL !== "after") return;
  for (const [who, role, page, path, ready, doIt, done] of INTERACTIONS) {
    if ((await signIn(b, who)) !== 200) throw new Error(`sign-in failed: ${who}`);
    for (const [w, h] of WIDTHS) {
      await b.viewport(w, h);
      await b.go(APP + path, ready);
      await b.ev(doIt); await b.waitFor(done, 8000);
      await measure(b, `${role}-${page}`, ".rv-pp-drawer, .cw-modal, .rv-pp-modal, .adm-main, main", w, h);
    }
  }
}

// ---- the standalone demo: every role, every page of its navigation
async function demoRun(b) {
  if (!existsSync(DEMO)) throw new Error(`no demo file at ${DEMO}`);
  const url = pathToFileURL(DEMO).href;
  for (const [w, h] of WIDTHS) {
    await b.viewport(w, h);
    await b.go(url, "!!document.querySelector('[data-role]')");
    await b.sleep(800);
    const roles = await b.ev("Array.prototype.map.call(document.querySelectorAll('[data-role]'), function (x) { return x.getAttribute('data-role'); })");
    for (const role of roles) {
      await b.ev(`document.querySelector('[data-role=${J(role)}]').click()`); await b.sleep(400);
      const pages = await b.ev("Array.prototype.map.call(document.querySelectorAll('.rvd-nav [data-page]'), function (x) { return x.getAttribute('data-page'); })");
      for (const page of pages) {
        await b.ev(`document.querySelector('.rvd-nav [data-page=${J(page)}]').click()`); await b.sleep(500);
        await b.ev("window.scrollTo(0, 0)");
        await measure(b, `demo-${role}-${page}`, "[data-main]", w, h, { focus: w === 1440 });
      }
    }
  }
}

const b = await startBrowser({ appGate: ONLY === "demo" ? undefined : APP });
try {
  await b.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] }); // the computer's dark mode must not decide the colours
  if (ONLY !== "demo") { assertLocal(APP); await appRun(b); }
  if (ONLY !== "app") await demoRun(b);
} finally {
  b.close();
}
writeFileSync(join(OUTDIR, `${PHASE}-checks-${LABEL}.json`), J(results.map((r) => ({ name: r.name, width: r.width, problems: problems(r) })), null, 1));
console.log(`\n${results.length} page views, ${results.filter((r) => problems(r).length).length} with a problem${LABEL === "after" ? "" : " (before: recorded, not failed)"}. Screenshots in ${OUTDIR}`);
process.exit(failed ? 1 : 0);
