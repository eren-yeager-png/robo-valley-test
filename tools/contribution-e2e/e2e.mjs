#!/usr/bin/env node
// END-TO-END check of the contribution workflow on the throw-away local stack (rig.mjs up): the app (next start) on 127.0.0.1 with its
// own Postgres container, and a throw-away WordPress with Astra, rv-contribution-v2 (the current form, exactly as in the repo),
// robovalley-contribution (this checkout) and the test-only rv-e2e-dummy-fields plugin. Our own headless Chrome or Edge behind the
// safety gate (lib/browser.mjs). Prints PASS/FAIL per check; exit code 1 if any check failed. Screenshots go to tools/contribution-e2e/out/.
//   node tools/contribution-e2e/e2e.mjs [out dir]
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { APP, OUT, STATE, USERS, WP as W, assertLocal, secrets } from "./lib/config.mjs";
import { sql, wp } from "./lib/docker.mjs";
import { startBrowser } from "./lib/browser.mjs";

const out = resolve(process.argv[2] || OUT);
assertLocal(APP); assertLocal(W);
mkdirSync(out, { recursive: true }); mkdirSync(STATE, { recursive: true });
const PNG = join(STATE, "sketch.png"); // a real 1x1 PNG for the attachment
writeFileSync(PNG, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
const pw = secrets().users;
const RUN = Date.now().toString(36).slice(-4).toUpperCase(); // titles of this run (the same database can be checked again)
const OLD_TITLE = `Old form still works: robot weeder trial ${RUN}`, SENT_TITLE = `Milking robot that sends a text when a cow looks unwell ${RUN}`, PUB_TITLE = `Milking robot that texts the farmer when a cow looks unwell ${RUN}`;
// Each run has its own member account (a copy of the made-up member, same password), so the app's limit of 10 ideas per member per
// day and its duplicate check never depend on earlier runs against the same throw-away database.
const WHO = { ...USERS, member: { ...USERS.member, email: `e2e-member-${RUN.toLowerCase()}@example.com` } };
const SECTOR = `${W}/robots-by-sector/agriculture-dairy/`;
const head = async (u) => { const r = await fetch(u, { redirect: "manual" }); return { status: r.status, location: r.headers.get("location"), cache: r.headers.get("cache-control") }; };
const J = JSON.stringify;
let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n + (!ok && d !== undefined ? "  -> " + J(d).slice(0, 500) : "")); };

// Everything about the sector page's buttons, measured in the page.
const SECTOR_INFO = `(function(){
  function r(e){if(!e)return null;var b=e.getBoundingClientRect();return {top:Math.round(b.top),bottom:Math.round(b.bottom),left:Math.round(b.left),right:Math.round(b.right),width:Math.round(b.width),height:Math.round(b.height)};}
  function vis(a){if(!a)return false;var c=getComputedStyle(a);return a.offsetWidth>0&&a.offsetHeight>0&&c.visibility==='visible'&&c.opacity==='1'&&c.display!=='none';}
  var hb=document.querySelectorAll('.rv-contribute-btn--header'),h=hb[0],cs=h?getComputedStyle(h):null;
  var t=document.querySelector('.entry-header .entry-title, h1.entry-title');
  var fields=Array.from(document.querySelectorAll('[data-rv-field-id]')).map(function(f){var a=f.querySelector(':scope > .rv-contribute-field .rv-contribute-btn--field[href]'),fc=getComputedStyle(f);return {id:f.getAttribute('data-rv-field-id'),href:a?a.getAttribute('href'):null,box:r(f),inner:Math.round(f.clientWidth-parseFloat(fc.paddingLeft)-parseFloat(fc.paddingRight)),btn:r(a),visible:vis(a)};});
  var tables=Array.from(document.querySelectorAll('.rv-fields-root table')).map(function(t){var w=t.closest('.rv-table-scroll'),tc=getComputedStyle(t);return {wrapped:!!w,scrolls:!!(w&&w.scrollWidth>w.clientWidth+1)||(t.scrollWidth>t.clientWidth+1&&/auto|scroll/.test(tc.overflowX)),inside:((w&&w.scrollWidth>w.clientWidth+1)?w:t).getBoundingClientRect().right<=window.innerWidth+1};});
  return {headers:hb.length,href:h?h.getAttribute('href'):null,text:h?h.textContent.trim():'',head:r(h),title:r(t),visible:vis(h),
    style:cs?{border:cs.borderTopColor,bg:cs.backgroundColor,color:cs.color,radius:cs.borderTopLeftRadius,weight:cs.fontWeight}:null,
    fields:fields,hscroll:document.documentElement.scrollWidth>window.innerWidth+1,vw:window.innerWidth,vh:window.innerHeight,
    tables:tables};
})()`;
const overlap = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
// The lowest text contrast (WCAG ratio) among the elements matching a selector, against the background actually behind each one.
const CONTRAST = (sel) => `(function(){function rgb(c){return (c.match(/[0-9.]+/g)||[]).map(Number)}
  function lum(c){var a=rgb(c).slice(0,3).map(function(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});return 0.2126*a[0]+0.7152*a[1]+0.0722*a[2]}
  function bg(e){for(;e;e=e.parentElement){var b=getComputedStyle(e).backgroundColor,m=rgb(b);if(m.length<4||m[3]>0)return b}return 'rgb(255, 255, 255)'}
  var r=Array.from(document.querySelectorAll(${JSON.stringify(sel)})).filter(function(e){return e.offsetWidth>0&&e.textContent.trim()}).map(function(e){var a=lum(getComputedStyle(e).color),b=lum(bg(e));return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)});
  return r.length?Math.round(Math.min.apply(null,r)*100)/100:0})()`;
const scheme = (value) => send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });

const b = await startBrowser({ appGate: APP });
const { ev, go, viewport, shot, send, sleep, waitFor } = b;
const signIn = async (who) => { await send("Network.clearBrowserCookies"); await go(APP + "/login"); return ev(`fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(${J({ email: WHO[who].email, password: pw[who] })})}).then(function(r){return r.status})`); };
const visitor = () => send("Network.clearBrowserCookies");
const text = () => ev("document.body.innerText");
const click = async (sel) => { await ev(`(function(){var e=document.querySelector(${J(sel)});if(e)e.click();return !!e})()`); await sleep(400); };
// works for plain inputs and for React-controlled ones (the native setter, then the events React listens to)
const setVal = (sel, v) => ev(`(function(){var e=document.querySelector(${J(sel)});var p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${J(v)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
const is404 = () => ev("document.body.classList.contains('error404')");
const badge = () => ev("(document.querySelector('.rv-pp-drawer .cw-detail .rv-badge, .cw-detail .rv-badge')||{}).textContent||''");
// the Contribution Portal's tables (Moderation, Publish Requests): a row by its code, and one of its buttons
const rowAct = (code, act) => ev(`(function(){var r=Array.from(document.querySelectorAll('tr[data-row]')).find(function(x){return x.textContent.indexOf(${J(code)})>-1});var b=r&&r.querySelector('[data-act="'+${J(act)}+'"]');if(b)b.click();return !!b})()`);
const rowText = (code) => ev(`(function(){var r=Array.from(document.querySelectorAll('tr[data-row]')).find(function(x){return x.textContent.indexOf(${J(code)})>-1});return r?r.textContent:''})()`);
const D = (sel) => `.rv-pp-drawer ${sel}`; // inside the side drawer (the table rows have buttons with the same names)
const drawerIs = (label) => `(document.querySelector('.rv-pp-drawer .cw-detail .rv-badge')||{}).textContent === ${J(label)}`;
const answerDialog = async (reason) => { await waitFor("!!document.querySelector('.rv-dlg [data-x=\"ok\"]')"); if (reason !== undefined) await setVal(".rv-dlg textarea", reason); await sleep(150); await click('.rv-dlg [data-x="ok"]'); };
const sectorPage = async (url = SECTOR) => { await go(url, "!!document.querySelector('.rv-contribute-btn--header')"); await waitFor("!!document.querySelector('[data-rv-field=\"js-feed-planner\"] .rv-contribute-btn--field')", 8000); await sleep(200); return ev(SECTOR_INFO); };
const fieldOf = (info, id) => info.fields.find((f) => f.id === id);
const untilSql = async (q, want, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (sql(q) === want) return true; await sleep(250); } return false; };
const navCurrent = () => ev("(document.querySelector('#dash-nav a[aria-current=\"page\"], nav a[aria-current=\"page\"]')||{}).textContent||''");

try {
  sql(`INSERT INTO users (full_name, email, mobile, role, district, preferred_language, age_category, password_hash, email_verification, must_change_password, is_moderator)
       SELECT full_name, '${WHO.member.email}', mobile, role, district, preferred_language, age_category, password_hash, email_verification, false, false FROM users WHERE email = '${USERS.member.email}'`);
  await viewport(1366, 900);
  await scheme("light"); // screenshots do not depend on this computer's light or dark setting; the dark theme is checked in M
  wp(["option", "update", "rv_contrib_switch_over", "0"]);
  for (const o of ["rv_contrib_fields_off", "rv_e2e_hostile_css", "rv_e2e_suggested_fields"]) { try { wp(["option", "delete", o]); } catch { /* not set */ } }

  // ---------------------------------------------------------------- A. the current form (switch OFF) still works, unchanged
  const oldBefore = Number(sql("SELECT count(*) FROM contributions"));
  check("app sign-in (member)", (await signIn("member")) === 200);
  await go(W + "/contribute-now/?sector=agriculture-dairy", "(function(){var f=document.getElementById('robot-field');return !!document.getElementById('rv-c2') && !!f && !f.hidden})()");
  check("A1 the current form renders on /contribute-now/ (rv-contribution-v2), with the sector's robot question", await ev("!!document.getElementById('rv-c2') && !!document.querySelector('#robot-choices select')"));
  await ev("document.querySelector('input[name=\"type\"]').click()");
  await setVal('input[name="title"]', OLD_TITLE);
  await setVal('textarea[name="description"]', `Submitted through the current Contribute form during the end-to-end check ${RUN}.`);
  await ev("document.querySelector('input[name=\"category\"]').click()");
  await sleep(300);
  await ev("document.querySelector('#contribute button[type=\"submit\"]').click()");
  await waitFor("(function(){var m=document.getElementById('message');return !!m && !m.hidden && m.textContent.length>5})()", 15000);
  const oldAfter = Number(sql("SELECT count(*) FROM contributions"));
  check("A2 a submission through the current form is saved by the old API (one new row in contributions)", oldAfter === oldBefore + 1, { oldBefore, oldAfter, msg: await ev("document.getElementById('message').textContent") });
  await shot(join(out, "a-old-form.png"));
  await visitor();
  await go(W + "/share-your-idea/");
  check("A3 switch OFF: the new form's page is private (a visitor gets 404)", await is404());
  await go(W + "/community-ideas/");
  check("A4 switch OFF: Community Ideas is private too", await is404());

  // ---------------------------------------------------------------- S. the sector page: the header button and a button on every field
  wp(["option", "update", "rv_e2e_suggested_fields", J([{ id: "inspection-cameras", label: "Inspection cameras", status: "pending" }]), "--format=json"]);
  let info = await sectorPage();
  check("S1 one '+ Contribute to this sector' in the header, visible, to the current form with the sector (switch OFF)",
    info.headers === 1 && info.text === "Contribute to this sector" && info.visible && String(info.href).startsWith(`${W}/contribute-now/?sector=agriculture-dairy`), { headers: info.headers, text: info.text, href: info.href, visible: info.visible });
  check("S2 title on the left, the button on the right of the same header row", info.title && info.head && info.title.right <= info.head.left && Math.abs(info.head.top - info.title.top) < 80, { title: info.title, head: info.head });
  check("S3 white with a green border, green bold text, 8px corners", info.style && info.style.border === "rgb(35, 122, 51)" && info.style.bg === "rgb(255, 255, 255)" && info.style.color === "rgb(35, 122, 51)" && info.style.radius === "8px" && Number(info.style.weight) >= 700, info.style);
  const ids = info.fields.map((f) => f.id);
  check("S4 every field has its own visible button: the page's fields, the plugin's field and the field added by JavaScript after loading",
    ["about-this-sector", "milking-robots", "drone-sprayers", "plugin-weather-station", "js-feed-planner"].every((x) => ids.includes(x)) && info.fields.every((f) => f.href && f.visible), info.fields.map((f) => [f.id, !!f.href, f.visible]));
  check("S5 an empty block gets no button (nothing to contribute to)", info.fields.length === 5, ids);
  const mh = new URL(fieldOf(info, "milking-robots").href);
  check("S6 a field's button: the contribute flow with the sector, the field, the resource path and the way back",
    mh.origin + mh.pathname === `${W}/contribute-now/` && mh.searchParams.get("sector") === "agriculture-dairy" && mh.searchParams.get("field") === "milking-robots"
    && mh.searchParams.get("resource_path") === "Robots by Sector › Agriculture and Dairy › Milking robots" && mh.searchParams.get("return_to") === SECTOR, mh.toString());
  check("S7 the header button never covers a card", info.fields.every((f) => !overlap(info.head, f.box)), { head: info.head, boxes: info.fields.map((f) => f.box) });
  check("S8 long addresses wrap (no sideways scrolling); every table sits in its own scroll box", !info.hscroll && info.tables.length >= 2 && info.tables.every((t) => t.wrapped && t.inside)
    && (await ev("Array.from(document.querySelectorAll('.rv-fields-root p')).every(function(p){return p.scrollWidth<=p.clientWidth+1})")), { hscroll: info.hscroll, tables: info.tables });
  await shot(join(out, "s-sector-desktop.png"));
  await ev("window.scrollTo(0, 900)"); await sleep(300);
  const scrolled = await ev(SECTOR_INFO);
  check("S9 the header button stays in the top-right while the page scrolls (sticky)", scrolled.head && scrolled.head.top >= 0 && scrolled.head.top < 150 && scrolled.visible, scrolled.head);
  await viewport(1366, 560); await ev("window.scrollTo(0, 0)"); await sleep(200);
  const about = fieldOf(await ev(SECTOR_INFO), "about-this-sector");
  await ev(`window.scrollTo(0, ${about.box.top + 120})`); await sleep(300);
  const inField = fieldOf(await ev(SECTOR_INFO), "about-this-sector");
  check("S10 a field's button sticks to the bottom of the screen while you are inside that field (and stays inside the field)",
    inField.box.height > 560 && inField.box.bottom > 560 && Math.abs(inField.btn.bottom - (560 - 12)) <= 6 && inField.btn.top >= inField.box.top, { box: inField.box, btn: inField.btn });
  await viewport(1366, 900); await ev("window.scrollTo(0, 0)");
  check("S11 a suggested field that is still pending is not on the page", !ids.includes("inspection-cameras"));
  wp(["option", "update", "rv_e2e_suggested_fields", J([{ id: "inspection-cameras", label: "Inspection cameras", status: "approved" }]), "--format=json"]);
  info = await sectorPage();
  const cam = fieldOf(info, "inspection-cameras");
  check("S12 once approved, the suggested field appears with its own button (no code for that field)", cam && cam.visible && new URL(cam.href).searchParams.get("field") === "inspection-cameras", cam);
  wp(["option", "update", "rv_contrib_fields_off", "agriculture-dairy/drone-sprayers"]);
  info = await sectorPage();
  const edu = await sectorPage(`${W}/robots-by-sector/education/`);
  check("S13 the administrator's per-field setting turns off exactly that field's button (other fields and other sectors keep theirs)",
    fieldOf(info, "drone-sprayers") === undefined && info.fields.length >= 5 && info.fields.every((f) => f.visible) && fieldOf(edu, "drone-sprayers")?.visible === true,
    { agri: info.fields.map((f) => f.id), edu: edu.fields.map((f) => f.id) });
  wp(["option", "delete", "rv_contrib_fields_off"]);
  wp(["option", "update", "rv_e2e_hostile_css", "1"]);
  info = await sectorPage();
  check("S14 CSS that tries to hide the buttons (display/visibility/opacity, without !important) cannot", (await ev("!!document.getElementById('rv-e2e-hostile')")) && info.visible && info.fields.length >= 6 && info.fields.every((f) => f.visible), { header: info.visible, fields: info.fields.map((f) => [f.id, f.visible]) });
  wp(["option", "delete", "rv_e2e_hostile_css"]);
  info = await sectorPage();
  await ev("document.querySelectorAll('.rv-contribute-field').forEach(function(w){w.remove()}); var h=document.querySelector('.rv-contribute-btn--header'); h.style.display='none'; h.setAttribute('hidden','');");
  await sleep(700);
  const back = await ev(SECTOR_INFO);
  check("S15 removed or hidden by a script, the buttons come straight back", back.visible && back.fields.length === info.fields.length && back.fields.every((f) => f.visible), { header: back.visible, fields: back.fields.map((f) => [f.id, f.visible]) });
  check("S16 a sector page with its title switched off still has the header button", (await sectorPage(`${W}/robots-by-sector/healthcare/`)).headers === 1 && (await ev(SECTOR_INFO)).visible);
  for (const p of ["/about-us/", "/news/", "/robots-by-sector/"]) {
    await go(W + p);
    check(`S17 not a sector page (${p}): no contribute buttons and no button script`, (await ev("document.querySelectorAll('.rv-contribute-btn').length === 0 && !document.querySelector('script[src*=\"rv-sector.js\"]')")));
  }
  await viewport(390, 844);
  info = await sectorPage();
  check("S18 phone: the header button is below the title at full width", info.head.top >= info.title.bottom - 1 && info.head.width >= info.vw * 0.8, { title: info.title, head: info.head, vw: info.vw });
  check("S19 phone: every field's button spans the field's full inner width at the bottom of its field; no sideways scrolling; the wide table scrolls inside its card",
    info.fields.every((f) => f.visible && f.btn.width >= f.inner - 2) && !info.hscroll && info.tables.length >= 2 && info.tables.every((t) => t.scrolls && t.inside), { fields: info.fields.map((f) => [f.id, f.btn && f.btn.width, f.inner]), hscroll: info.hscroll, tables: info.tables });
  await shot(join(out, "s-sector-mobile.png"));
  await viewport(1366, 900);

  // ---------------------------------------------------------------- B. switch ON
  wp(["option", "update", "rv_contrib_switch_over", "1"]);
  const h = await head(W + "/contribute-now/?sector=agriculture-dairy");
  check("B1 switch ON: /contribute-now/?sector=... answers 301 to /share-your-idea/?sector=... and is never cached", h.status === 301 && h.location === `${W}/share-your-idea/?sector=agriculture-dairy` && /no-store/.test(h.cache || ""), h);
  check("B2 nothing else redirects (the sector page answers 200)", (await head(SECTOR)).status === 200);
  info = await sectorPage();
  const v2btn = await ev("(function(){var a=document.querySelector('.rv-c2-sector-btn');return a?a.getAttribute('href'):null})()");
  check("B3 the current form's own sector button (hidden under ours) also points at the new form", v2btn === `${W}/share-your-idea/?sector=agriculture-dairy`, v2btn);
  check("B4 switch ON: the header button and every field's button open Share Your Idea with the sector (and the field)",
    String(info.href).startsWith(`${W}/share-your-idea/?sector=agriculture-dairy`) && info.fields.every((f) => f.href.startsWith(`${W}/share-your-idea/?sector=agriculture-dairy&field=${f.id}&`)), { header: info.href, fields: info.fields.map((f) => f.href) });
  await go(W + "/community-ideas/", "!!document.querySelector('.rv-site-head')");
  check("B5 switch ON: both pages are public", !(await is404()) && /RoboValley – Community Ideas/.test(await text()));
  // signed out: the button, the sign-in page, and back to the form with everything filled in
  await visitor();
  info = await sectorPage();
  await go(fieldOf(info, "milking-robots").href, "!!document.querySelector('.rv-app a.rv-btn')");
  const signInHref = await ev("document.querySelector('.rv-app a.rv-btn').getAttribute('href')");
  check("B6 signed out: the form asks to sign in; the link returns to an address the app accepts (only ?sector= and ?robot=)", signInHref === `${APP}/login?returnTo=${encodeURIComponent(`${W}/share-your-idea/?sector=agriculture-dairy&robot=milking-robots`)}`, signInHref);
  await go(signInHref, "!!document.querySelector('#login-email')");
  await setVal("#login-email", WHO.member.email); await setVal("#login-password", pw.member);
  await click('button[type="submit"]');
  await waitFor(`location.href.indexOf(${J(`${W}/share-your-idea/`)}) === 0 && !!document.querySelector('#rv-f-title')`, 25000);
  const came = await ev("(function(){function v(s){var e=document.querySelector(s);return e?(e.type==='checkbox'?e.checked:e.value):null}return {href:location.href,sector:v('#rv-f-sector'),robot:v('#rv-f-robot'),refers:v('input[name=\"rv-refers\"]'),path:v('#rv-f-rpath')}})()");
  check("B7 after signing in the visitor is back on the form: sector, robot type, 'refers' and the resource path are filled in",
    came.sector === "agriculture-dairy" && came.robot === "milking-robots" && came.refers === true && came.path === "Robots by Sector › Agriculture and Dairy › Milking robots", came);

  // ---------------------------------------------------------------- C. a member shares an idea on WordPress
  check("app sign-in (member)", (await signIn("member")) === 200);
  await go(W + "/share-your-idea/?sector=agriculture-dairy", "!!document.querySelector('#rv-f-title')");
  const form = await ev("({name:document.querySelector('#rv-f-name').value,nameRo:document.querySelector('#rv-f-name').readOnly,type:document.querySelector('#rv-f-type').value,sector:document.querySelector('#rv-f-sector').value,robots:Array.from(document.querySelectorAll('#rv-f-robot option')).map(function(o){return o.textContent})})");
  check("C1 name and type come from the profile, read-only; ?sector= preselects the sector; the robot list follows it", form.nameRo && form.name.length > 0 && form.type.length > 0 && form.sector === "agriculture-dairy" && form.robots.includes("Milking robots"), form);
  await setVal("#rv-f-title", SENT_TITLE);
  await setVal("#rv-f-desc", "A camera on the milking robot spots a limping or tired cow and sends the farmer a text message straight away.");
  await ev("document.querySelector('input[name=\"rv-cat\"][value=\"Robotics\"]').click()");
  await setVal("#rv-f-robot", "milking-robots");
  const fileObj = await send("Runtime.evaluate", { expression: "document.querySelector('#rv-f-file')" });
  await send("DOM.setFileInputFiles", { files: [PNG], objectId: fileObj.result.result.objectId });
  await ev("document.querySelector('.rv-form button[type=\"submit\"]').click()");
  await waitFor("!!document.querySelector('.rv-n-ok, .rv-n-err')", 15000);
  const ok = await ev("(document.querySelector('.rv-n-ok')||{}).textContent || (document.querySelector('.rv-n-err')||{}).textContent");
  const code = (ok.match(/RV-\d+/) || [])[0];
  check("C2 submitted: 'Thank you! Your new idea RV-xxxx has been submitted for review. It is not public ...'", /^Thank you! Your new idea RV-\d+ has been submitted for review\. It is not public until an Admin publishes it\.$/.test(ok), ok);
  const id = Number(String(code).replace("RV-", ""));
  check("C3 saved as Submitted with the PNG (type read from the file) and one history line", sql(`SELECT status FROM cw_contributions WHERE id = ${id}`) === "submitted" && sql(`SELECT mime FROM cw_contribution_attachments WHERE contribution_id = ${id}`) === "image/png" && sql(`SELECT count(*) FROM cw_contribution_history WHERE contribution_id = ${id}`) === "1");
  await shot(join(out, "c-form-sent.png"));

  // ---------------------------------------------------------------- D. the moderator (admin portal)
  check("app sign-in (moderator)", (await signIn("mod")) === 200);
  await go(APP + "/admin/workspace", "!!document.querySelector('tr[data-row]')"); // the old address opens Moderation (the Workspace is merged in)
  check("D0 /admin/workspace opens Moderation", (await ev("location.pathname")) === "/admin/moderation");
  await go(APP + "/admin/moderation?sector=agriculture-dairy", "!!document.querySelector('tr[data-row]')");
  check("D1 Moderation lists the idea in its sector, in ONE table with the current form's items", (await rowText(code)).includes("Share Your Idea") && (await ev("Array.from(document.querySelectorAll('tr[data-row]')).some(function(r){return r.textContent.indexOf('Current form')>-1})")) === true);
  await rowAct(code, "edit");
  await waitFor(`!!document.querySelector(${J(D("#cw-m-title"))})`);
  check("D2 Edit & approve opens the review in a side drawer; opening it moves the idea to Under Moderator Review", (await badge()) === "Under Moderator Review");
  await setVal(D("#cw-m-title"), PUB_TITLE);
  check("D3a the drawer shows the change against the original while typing", (await ev(`!!document.querySelector(${J(D("[data-livediff] ins"))})`)) === true);
  await shot(join(out, "d-edit-approve.png"));
  const lastToast = () => ev("(Array.from(document.querySelectorAll('.rv-pp-toast')).pop()||{}).textContent||''");
  await click(D('[data-act="send"]')); // the drawer's main button: "Approve" (migration 030: approving is its own step)
  await untilSql(`SELECT status FROM cw_contributions WHERE id = ${id}`, "approved");
  check("D3 Approve (its own step, migration 030): Approved by Moderator, who and when are stored, a toast says so, still not public",
    sql(`SELECT status FROM cw_contributions WHERE id = ${id}`) === "approved" && sql(`SELECT approved_by IS NOT NULL AND approved_at IS NOT NULL FROM cw_contributions WHERE id = ${id}`) === "t"
    && /^Approved: /.test(await lastToast()) && sql(`SELECT count(*) FROM cw_public_contributions WHERE contribution_id = ${id}`) === "0");
  await waitFor(`!!document.querySelector('tr[data-row="w-${id}"] [data-act="send"]')`);
  await shot(join(out, "d-moderation-approved.png"), { full: true });
  await rowAct(code, "send");
  await untilSql(`SELECT status FROM cw_contributions WHERE id = ${id}`, "pending");
  check("D4 Send publish request to Admin: Pending Admin Approval, a toast says so, still not public",
    sql(`SELECT status FROM cw_contributions WHERE id = ${id}`) === "pending" && sql(`SELECT publish_requested_at IS NOT NULL FROM cw_contributions WHERE id = ${id}`) === "t"
    && /Publishing request sent to an Admin/.test(await lastToast()) && sql(`SELECT count(*) FROM cw_public_contributions WHERE contribution_id = ${id}`) === "0");
  check("D5 the Audit Log has the approval and the request (migration 030)",
    sql(`SELECT string_agg(action, ',' ORDER BY id) FROM audit_log WHERE target_type = 'idea' AND target_id = ${id}`) === "approve,send_request");
  await shot(join(out, "d-moderation.png"), { full: true });

  // ---------------------------------------------------------------- E. the admin: preview, then publish
  check("app sign-in (admin)", (await signIn("admin")) === 200);
  await go(APP + "/admin/approvals", "!!document.querySelector('tr[data-row]')");
  check("E0 Publish Requests (the Approval Dashboard merged in) lists the request with who approved it", (await rowText(code)).includes(USERS.mod.name));
  await rowAct(code, "details");
  await waitFor(`!!document.querySelector(${J(D('[data-act="publish"]'))})`);
  check("E1 the word diff shows the Moderator's change; Publish is disabled until the preview", (await ev(`document.querySelector(${J(D(".cw-diff ins"))}) !== null`)) && (await ev(`document.querySelector(${J(D('[data-act="publish"]'))}).disabled`)));
  await click(D('[data-act="preview"]'));
  await waitFor("!!document.querySelector('.cw-modal iframe')");
  const src = await ev("document.querySelector('.cw-modal iframe').srcdoc");
  check("E2 the Publish Preview shows the shared card with the approved title, and nothing internal", src.includes("PREVIEW ONLY") && src.includes(PUB_TITLE) && !src.includes(WHO.member.email));
  await click('.cw-modal [data-x="done"]');
  check("E3 after the preview, Publish is enabled", !(await ev(`document.querySelector(${J(D('[data-act="publish"]'))}).disabled`)));
  await click(D('[data-act="publish"]'));
  await waitFor(drawerIs("Published"), 20000);
  check("E4 Published, and verified in its section", /Published successfully on .+\. Verified on the public website in the Agriculture & Dairy section\./.test(await text()));
  await shot(join(out, "e-published.png"), { full: true });

  // ---------------------------------------------------------------- F. the public page
  await visitor();
  await go(W + "/community-ideas/", "!!document.querySelector('.rv-sector')");
  const site = await text();
  check("F1 Community Ideas shows the card under its sector, with the first name and type", site.includes("Agriculture & Dairy") && site.includes(PUB_TITLE) && /Idea by \S+ \(.+\)/.test(site), site.slice(0, 300));
  await shot(join(out, "f-community-ideas.png"), { full: true });

  // ---------------------------------------------------------------- J. Unpublish (Admin only), then publish again
  check("app sign-in (admin)", (await signIn("admin")) === 200);
  await go(APP + "/admin/approvals", "!!document.querySelector('[data-tab]')");
  await click('[data-tab="published"]');
  await rowAct(code, "details");
  await waitFor(`!!document.querySelector(${J(D('[data-act="unpublish"]'))})`);
  await click(D('[data-act="unpublish"]'));
  await answerDialog();
  await waitFor(drawerIs("Unpublished"), 15000);
  check("J1 Unpublish (after a confirmation): status Unpublished, and the card is gone from the public table in the same step",
    sql(`SELECT status FROM cw_contributions WHERE id = ${id}`) === "unpublished" && sql(`SELECT count(*) FROM cw_public_contributions WHERE contribution_id = ${id}`) === "0");
  await visitor();
  await go(W + "/community-ideas/");
  check("J2 Community Ideas no longer shows it", !(await text()).includes(PUB_TITLE));
  check("app sign-in (admin)", (await signIn("admin")) === 200);
  await go(APP + "/admin/approvals", "!!document.querySelector('[data-tab]')");
  await click('[data-tab="unpublished"]');
  await rowAct(code, "details");
  await waitFor(`!!document.querySelector(${J(D('[data-act="preview"]'))})`);
  check("J3 publishing it again needs a new preview first", await ev(`document.querySelector(${J(D('[data-act="publish"]'))}).disabled`));
  await click(D('[data-act="preview"]')); await waitFor("!!document.querySelector('.cw-modal')"); await click('.cw-modal [data-x="done"]');
  await click(D('[data-act="publish"]'));
  await waitFor(drawerIs("Published"), 20000);
  check("J4 published again: exactly one card", sql(`SELECT status FROM cw_contributions WHERE id = ${id}`) === "published" && sql(`SELECT count(*) FROM cw_public_contributions WHERE contribution_id = ${id}`) === "1");

  // ---------------------------------------------------------------- G. a failed publish, then a retry (exactly one card each)
  check("app sign-in (member)", (await signIn("member")) === 200);
  await go(W + "/share-your-idea/", "!!document.querySelector('#rv-f-title')");
  const newIdea = (title, extra = {}) => ev(`(function(){var fd=new FormData();fd.append('data',JSON.stringify(${J({ kind: "New idea", refers: false, title, description: "Made up for the end-to-end check, long enough to pass.", sector: "agriculture-dairy", robotType: "not-sure", categories: ["Robotics"], suitableFor: [], learningPath: "", references: [], resource: {}, ...extra })}));return fetch('${APP}/api/cw/contributions',{method:'POST',credentials:'include',body:fd}).then(function(r){return r.json().then(function(j){j.status=r.status;return j})})})()`);
  const second = await newIdea(`Solar weeding robot for small farms ${RUN}`), id2 = second.id;
  if (!id2) throw new Error("the second idea was not accepted: " + J(second));
  check("app sign-in (moderator)", (await signIn("mod")) === 200);
  await go(APP + "/admin/moderation?sector=agriculture-dairy", "!!document.querySelector('tr[data-row]')");
  const sendReq = (n) => ev(`fetch('/api/cw/review/${n}').then(function(r){return r.json()}).then(function(d){var it=d.item;return fetch('/api/cw/review/${n}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'send_request',rowVersion:it.rowVersion,proposed:it.proposed,notes:''})}).then(function(r){return r.status})})`);
  check("G1 a second idea is sent to Admin", (await sendReq(id2)) === 200);
  check("app sign-in (admin)", (await signIn("admin")) === 200);
  await go(APP + "/admin/approvals", "!!document.querySelector('tr[data-row]')");
  await rowAct(`RV-${id2}`, "preview"); // the row's own publish preview: Publish, Send back to moderator, Reject
  await waitFor("!!document.querySelector('.cw-modal [data-pv-act]')");
  check("G0 a request's \"Open publish preview\" shows the card with Publish, Send back to moderator and Reject",
    J(await ev("Array.from(document.querySelectorAll('.cw-modal [data-pv-act]')).map(function(b){return b.textContent})")) === J(["Publish", "Send back to moderator", "Reject"]));
  await click('.cw-modal [data-x="close"]');
  await rowAct(`RV-${id2}`, "details");
  await waitFor(`!!document.querySelector(${J(D('[data-act="preview"]'))})`);
  await click(D('[data-act="preview"]')); await waitFor("!!document.querySelector('.cw-modal')"); await click('.cw-modal [data-x="done"]');
  const pubBefore = Number(sql("SELECT count(*) FROM cw_public_contributions"));
  sql("ALTER TABLE cw_public_contributions RENAME TO cw_public_contributions_offline");
  let failedText = "";
  try {
    await click(D('[data-act="publish"]'));
    await waitFor(drawerIs("Publication Failed"), 20000);
    failedText = String(await ev("document.querySelector('.rv-pp-drawer').innerText")).replace(/\s+/g, " ");
  } finally {
    sql("ALTER TABLE cw_public_contributions_offline RENAME TO cw_public_contributions"); // always back, whatever happened
  }
  check("G2 the public table is unreachable: Publication Failed, a plain message, safe-retry note, Retry Publish offered",
    failedText.includes("Publication failed: The public website could not be updated. Nothing was changed on the public website. You can safely retry; it will not create a duplicate.") && (failedText.match(/Nothing was changed/g) || []).length === 1 && (await ev("document.querySelector('[data-act=\"publish\"]').textContent")) === "Retry Publish", failedText.slice(0, 400));
  check("G3 the public website is unchanged (no card added or lost)", Number(sql("SELECT count(*) FROM cw_public_contributions")) === pubBefore && sql(`SELECT count(*) FROM cw_public_contributions WHERE contribution_id = ${id2}`) === "0");
  await click(D('[data-act="publish"]'));
  await waitFor(drawerIs("Published"), 20000);
  check("G4 Retry Publish succeeds; exactly one card for the idea", Number(sql("SELECT count(*) FROM cw_public_contributions")) === pubBefore + 1 && sql(`SELECT count(*) FROM cw_public_contributions WHERE contribution_id = ${id2}`) === "1");
  check("G5 history: attempt 1 failed, attempt 2 published", /Publication FAILED: The public website could not be updated/.test(sql(`SELECT string_agg(text, ' | ' ORDER BY id) FROM cw_contribution_history WHERE contribution_id = ${id2}`)) && sql(`SELECT publish_attempts FROM cw_contributions WHERE id = ${id2}`) === "2");

  // ---------------------------------------------------------------- K. a Moderator declines; the Admin sees who, why and when, and reopens it
  check("app sign-in (member)", (await signIn("member")) === 200);
  await go(W + "/share-your-idea/", "!!document.querySelector('#rv-f-title')");
  const third = await newIdea(`Robot that counts eggs ${RUN}`), id3 = third.id;
  if (!id3) throw new Error("the third idea was not accepted: " + J(third));
  check("app sign-in (moderator)", (await signIn("mod")) === 200);
  await go(APP + "/admin/moderation?sector=agriculture-dairy", "!!document.querySelector('tr[data-row]')");
  await rowAct(`RV-${id3}`, "reject"); // Reject from the table: a reason is required
  await answerDialog("Already covered by the poultry robots idea.");
  await untilSql(`SELECT status FROM cw_contributions WHERE id = ${id3}`, "rejected");
  check("K1 the Moderator declines with a reason: Rejected, the reason kept as feedback", sql(`SELECT status FROM cw_contributions WHERE id = ${id3}`) === "rejected" && sql(`SELECT count(*) FROM cw_contribution_feedback WHERE contribution_id = ${id3} AND type = 'decline'`) === "1");
  check("app sign-in (admin)", (await signIn("admin")) === 200);
  await go(APP + "/admin/approvals", "!!document.querySelector('[data-tab]')");
  await click('[data-tab="rejected"]');
  const row = await rowText(`RV-${id3}`);
  check("K2 the Admin's Rejected tab shows who declined it (Moderator) and when", row.includes(`Declined by ${USERS.mod.name} (Moderator)`) && /\d{4}, \d{1,2}:\d{2} [ap]m/.test(row), row);
  await rowAct(`RV-${id3}`, "details");
  await waitFor(`!!document.querySelector(${J(D('[data-act="reopen"]'))})`);
  check("K3 ...and why", String(await ev("document.querySelector('.rv-pp-drawer').innerText")).includes("Already covered by the poultry robots idea."));
  await click(D('[data-act="reopen"]'));
  await answerDialog("Different enough: it counts eggs, not birds.");
  await waitFor(drawerIs("Under Moderator Review"), 15000);
  check("K4 Reopen (reason required): back to the Moderator, Under Moderator Review, the reason recorded", sql(`SELECT status FROM cw_contributions WHERE id = ${id3}`) === "under_review" && sql(`SELECT count(*) FROM cw_contribution_feedback WHERE contribution_id = ${id3} AND type = 'reopen'`) === "1");

  // ---------------------------------------------------------------- L. Earn (18+) is never offered to someone under 18
  check("app sign-in (member under 18)", (await signIn("minor")) === 200);
  await go(W + "/share-your-idea/", "!!document.querySelector('#rv-f-title')");
  const paths = await ev("Array.from(document.querySelectorAll('input[name=\"rv-path\"]')).map(function(i){return i.value})");
  check("L1 the form does not offer the Earn (18+) path to a learner under 18", Array.isArray(paths) && paths.length > 0 && !paths.includes("Earn (18+)"), paths);
  const earn = await newIdea("Robot repair job for teens", { learningPath: "Earn (18+)" });
  check("L2 and the app refuses it if it is sent anyway", earn.status === 400 && /18 and above/.test(J(earn)), earn);
  const minorIdea = await newIdea(`Line-following robot kit for my school ${RUN}`, { learningPath: "Make" });
  check("L3 the same learner's idea with another path is accepted", minorIdea.status === 201 || minorIdea.status === 200, minorIdea);
  check("app sign-in (member)", (await signIn("member")) === 200);
  await go(W + "/share-your-idea/", "!!document.querySelector('#rv-f-title')");
  check("L4 an adult is offered Earn (18+)", (await ev("Array.from(document.querySelectorAll('input[name=\"rv-path\"]')).map(function(i){return i.value})")).includes("Earn (18+)"));

  // ---------------------------------------------------------------- M. the Member portal: Sectors and My Contributions
  await go(APP + "/dashboard/sectors", "!!document.querySelector('[data-sector]')");
  check("M1 Sectors (Member portal): the sector grid (a button card for each sector) and the selected sector's panel, the nav item highlighted",
    (await ev("document.querySelectorAll('.rv-sg button.rv-sg-card[data-sector]').length")) >= 3 && (await ev("!!document.querySelector('.rv-pp-panel .rv-contribute-btn--header')")) === true && (await navCurrent()).includes("Sectors"));
  await go(APP + "/dashboard/sectors/agriculture-dairy", "!!document.querySelector('.rv-contribute-btn--header')");
  await sleep(300);
  const portal = await ev("({header:document.querySelectorAll('.rv-contribute-btn--header').length,fields:document.querySelectorAll('[data-rv-field-id]').length,missing:Array.from(document.querySelectorAll('[data-rv-field-id]')).filter(function(f){return !f.querySelector(':scope > .rv-contribute-field .rv-contribute-btn--field[href]')}).length})");
  check("M2 a sector's page in the Member portal: the same header button and a button on every field", portal.header === 1 && portal.fields >= 3 && portal.missing === 0, portal);
  await shot(join(out, "m-member-sector-desktop.png"));
  await go(APP + "/my-contributions", "!!document.querySelector('table, [data-empty]')");
  const mine = { text: await text(), current: await navCurrent() };
  check("M3 My Contributions: only the member's own items, ideas and current-form ones, with the status; the nav item highlighted",
    mine.text.includes(code) && mine.text.includes(OLD_TITLE) && !mine.text.includes(`Line-following robot kit for my school ${RUN}`) && mine.current.includes("My Contributions"), mine.text.slice(0, 400));
  await shot(join(out, "m-my-contributions-desktop.png"));
  await viewport(390, 844);
  await go(APP + "/dashboard/sectors/agriculture-dairy", "!!document.querySelector('.rv-contribute-btn--header')");
  await shot(join(out, "m-member-sector-mobile.png"));
  await go(APP + "/my-contributions", "!!document.querySelector('table, [data-empty]')");
  await shot(join(out, "m-my-contributions-mobile.png"));
  await viewport(1366, 900);
  // the Member portal follows the device's light or dark setting: every text stays readable in both (WCAG AA, 4.5:1)
  const readable = {};
  for (const mode of ["light", "dark"]) {
    await scheme(mode);
    await go(APP + "/dashboard/sectors/agriculture-dairy", "!!document.querySelector('.rv-sector-card')");
    readable[`sector-${mode}`] = await ev(CONTRAST(".rv-sector-card > h2, .rv-sector-card p, .rv-sector-suggest span, .rv-sector-suggest__link"));
    if (mode === "dark") await shot(join(out, "m-member-sector-dark.png"));
    await go(APP + "/dashboard/sectors", "!!document.querySelector('.rv-sg-card')");
    readable[`grid-${mode}`] = await ev(CONTRAST(".rv-sg-name, .rv-sg-meta, .rv-pp-title, .rv-pp-desc, .rv-pp-panel__title, .rv-pp-fieldcard__name, .rv-pp-section-title"));
    if (mode === "dark") await shot(join(out, "m-member-sectors-dark.png"));
    await go(APP + "/my-contributions", "!!document.querySelector('.rv-pp-table, .rv-pp-empty, .cw-notice')");
    await ev("(function(){var b=document.querySelector('.rv-pp-table [data-view]');if(b)b.click();return true})()"); await sleep(300); // open one row's details
    readable[`mine-${mode}`] = await ev(CONTRAST(".rv-pp-table td b, .rv-pp-table td .rv-pp-sub, .rv-pp-note, .rv-mine-detail td p, .rv-pp-title"));
    if (mode === "dark") await shot(join(out, "m-my-contributions-dark.png"));
  }
  await scheme("light");
  check("M4 the Sectors pages and My Contributions are readable in the light and the dark theme (every text at least 4.5:1)", Object.values(readable).every((x) => x >= 4.5), readable);

  // ---------------------------------------------------------------- N. the reviewer screens use the same sector header
  check("app sign-in (moderator)", (await signIn("mod")) === 200);
  await go(APP + "/admin/moderation/sector/agriculture-dairy", "!!document.querySelector('.rv-pp-panel__head .rv-contribute-btn--header')"); // the old address: that sector's panel
  check("N1 Moderation by sector: the sector's panel has its header row with the button", (await ev("document.querySelectorAll('.rv-pp-panel__head .rv-contribute-btn--header').length")) === 1 && (await ev("location.search")) === "?sector=agriculture-dairy");
  await shot(join(out, "n-moderator-sector-desktop.png"));
  check("app sign-in (admin)", (await signIn("admin")) === 200);
  await go(APP + "/admin/sector-forms/agriculture-dairy", "!!document.querySelector('.rv-sector-headbar .rv-contribute-btn--header')");
  check("N2 Sector Forms: the same sector header with its button", (await ev("document.querySelectorAll('.rv-sector-headbar .rv-contribute-btn--header').length")) === 1);
  await shot(join(out, "n-admin-sector-forms-desktop.png"));

  // ---------------------------------------------------------------- H. switch OFF again: exactly today's behaviour
  wp(["option", "update", "rv_contrib_switch_over", "0"]);
  check("H1 switch OFF: /contribute-now/ answers 200 again (no redirect)", (await head(W + "/contribute-now/?sector=agriculture-dairy")).status === 200);
  await visitor();
  info = await sectorPage();
  const v2back = await ev("(function(){var a=document.querySelector('.rv-c2-sector-btn');return a?a.getAttribute('href'):null})()");
  check("H2 the sector buttons point at the current form again", v2back === `${W}/contribute-now/?sector=agriculture-dairy` && String(info.href).startsWith(`${W}/contribute-now/?sector=agriculture-dairy`), { v2back, header: info.href });
  await go(W + "/share-your-idea/");
  check("H3 the new pages are private again", await is404());
  check("app sign-in (member)", (await signIn("member")) === 200);
  await go(W + "/contribute-now/", "!!document.getElementById('rv-c2')");
  check("H4 the current form renders again", await ev("!!document.getElementById('rv-c2')"));

  const errs = b.errors.filter((e) => !/favicon|ERR_NAME|ERR_INTERNET|ERR_FAILED|Failed to load resource|404|gate-check/.test(e));
  check("no console errors", errs.length === 0, errs.slice(0, 5));
} catch (e) {
  fail++; console.log("FAIL crashed: " + String((e && e.stack) || e).slice(0, 600));
} finally {
  console.log(`e2e: ${pass} passed, ${fail} failed (screenshots in ${out})`);
  b.close();
  process.exitCode = fail ? 1 : 0;
}
