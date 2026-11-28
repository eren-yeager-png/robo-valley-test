// Contribution workflow: "Contribute to this sector" on EVERY field (section) of a Robots by Sector page. THE central injector:
// nothing else adds this button, and no field's own markup contains it. Used by the WordPress plugin (assets/js/rv-field-buttons.js,
// generated from this file and loaded on every sector page by field-buttons.php) and by the standalone demo.
//
// What is a field:
//   1. any element with data-rv-field="<id>" anywhere in the page outside the site's header, footer and navigation (the contract for
//      plugins and for new fields; data-rv-field-label="<name>" optional);
//   2. the page content's top-level sections: Elementor sections and containers, Gutenberg groups and covers, <section> elements, and
//      any selector added with the rv_contrib_field_selectors filter (WordPress) or opts.selectors;
//   3. when the content has none of those, the content itself counts as one field.
// Each field gets ONE button as its last child, sticky INSIDE the field (never fixed to the page). A MutationObserver puts it back
// whenever the page changes: a field added later (an approved "Suggest a field", another plugin, a re-render) gets one, and a button
// that was removed or hidden comes back. Only the administrator's per-field setting (opts.off: "<field id>" or "<sector>/<field id>")
// turns it off for a field. An ancestor with overflow: hidden (which stops sticky from working) is switched to the equivalent
// overflow: clip.

export const LABEL = "Contribute to this sector";
export const WRAP = "rv-contribute-field";
export const BTN = "rv-contribute-btn--field"; // the link has the classes "rv-contribute-btn rv-contribute-btn--field"
export const AUTO_SELECTORS = [".rv-rt", ".elementor-top-section", ".e-con.e-parent", ".wp-block-group", ".wp-block-cover", "section"];
const CHROME = "header, footer, nav, .site-header, .site-footer, #masthead, #colophon, [role=banner], [role=contentinfo], [role=navigation]";
const ROOTS = [".rv-fields-root", ".entry-content", ".elementor-location-single", "main", "#primary", "#content"];

export const slugOf = (s) => String(s ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
const headingText = (el) => { const h = el.querySelector("h1, h2, h3, h4"); return h ? h.textContent.replace(/\s+/g, " ").trim() : ""; };
const MARK = "data-rv-cf"; // our wrapper is found by this attribute too, so a changed class cannot orphan it
const ours = (el) => Boolean(el.closest && el.closest(`[${MARK}], .${WRAP}`));
const inChrome = (el) => Boolean(el.closest && el.closest(CHROME));
const isOff = (opts, id, el) => (opts.off || []).some((x) => x === id || x === `${el ? sectorOf(el, opts) : opts.sector}/${id}`);
/** An empty block (no text and no picture, video or table of its own) is not a field: it would show nothing but a button. */
const blank = (el) => !Array.from(el.childNodes).some((n) => (n.nodeType === 3 && n.textContent.trim()) || (n.nodeType === 1 && !ours(n) && (n.textContent.trim() || n.querySelector?.("img, video, iframe, table, svg") || /^(IMG|VIDEO|IFRAME|TABLE|SVG)$/.test(n.nodeName))));

/** A field's own id (before duplicates are numbered): its data-rv-field, its id, its heading, Elementor's element id, or its place. */
export function fieldId(el, index = 0) {
  const explicit = (el.getAttribute("data-rv-field") || "").trim();
  return slugOf(explicit) || slugOf(el.id) || slugOf(headingText(el)) || slugOf(el.getAttribute("data-id")) || `field-${index + 1}`;
}
export const fieldLabel = (el, id) => (el.getAttribute("data-rv-field-label") || headingText(el) || id).slice(0, 120);

/** The content area to look for sections in (the plugin wraps the page content in .rv-fields-root). `scope`: the document, or the one
 *  element a page was drawn into (the app and the demo draw several sector pages in one document). */
export function contentRoot(scope = document) {
  for (const s of ROOTS) { const r = scope.querySelector(s); if (r && !inChrome(r)) return r; }
  return scope.body || scope;
}
/** The sector of a field: the nearest data-rv-sector around it, else the page's. */
const sectorOf = (el, opts) => (el.closest && el.closest("[data-rv-sector]") ? el.closest("[data-rv-sector]").getAttribute("data-rv-sector") : "") || opts.sector || "";

/** Every field on the page in page order; an explicit field inside an automatic section wins over that section. */
export function findFields(doc = document, opts = {}) {
  const scope = opts.root || doc, root = contentRoot(scope);
  const explicit = Array.from(scope.querySelectorAll("[data-rv-field]")).filter((el) => !ours(el) && !inChrome(el));
  const sel = [...AUTO_SELECTORS, ...(Array.isArray(opts.selectors) ? opts.selectors : [])].filter((s) => typeof s === "string" && s.trim());
  let auto = [];
  for (const s of sel) { try { auto.push(...root.querySelectorAll(s)); } catch { /* a selector a plugin got wrong is skipped */ } }
  auto = Array.from(new Set(auto)).filter((el) => el !== root && !ours(el) && !inChrome(el) && !explicit.includes(el) && !blank(el));
  auto = auto.filter((el) => !auto.some((o) => o !== el && o.contains(el)) && !explicit.some((x) => el.contains(x) || x.contains(el)));
  const fields = [...explicit, ...auto];
  if (!fields.length && root && root !== doc.body && root !== scope && root.children.length) fields.push(root); // plain content: one field
  return fields.sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1));
}

/** The ids of the fields, duplicates numbered (drone-sprayers, drone-sprayers-2) so each field has its own. */
export function fieldIds(fields) {
  const seen = new Map();
  return fields.map((el, i) => {
    const id = fieldId(el, i), n = (seen.get(id) || 0) + 1;
    seen.set(id, n);
    return n === 1 ? id : `${id}-${n}`;
  });
}

/** Where the button leads: the existing contribute flow with the sector and the field filled in. */
export function hrefFor(opts, id, label, el, loc = (typeof location !== "undefined" ? location : null)) {
  const u = new URL(opts.form || "/contribute-now/", loc && /^(https?|file):/.test(loc.href) ? loc.href : "https://example.invalid/");
  const sector = sectorOf(el, opts);
  if (sector) u.searchParams.set("sector", sector);
  u.searchParams.set("field", id);
  u.searchParams.set("resource_path", ["Robots by Sector", (sector === opts.sector && opts.sectorName) || sector, label].filter(Boolean).join(" › "));
  if (loc && /^https?:/.test(loc.href)) u.searchParams.set("resource_url", loc.origin + loc.pathname + (el.id ? `#${el.id}` : ""));
  const back = opts.returnTo || (loc && /^https?:/.test(loc.href) ? loc.href : "");
  if (back) u.searchParams.set("return_to", back); // the contribute flow offers the way back to this page
  return u.toString();
}

/** sticky stops working under an ancestor with overflow: hidden; overflow: clip clips the same way without that side effect. Only
 *  wrappers that do not scroll themselves; never html or body (their overflow belongs to the window, e.g. a scroll lock). */
function keepSticky(el, doc) {
  const view = doc.defaultView;
  if (!view || !view.getComputedStyle) return;
  for (let p = el.parentElement; p && p !== doc.body && p !== doc.documentElement; p = p.parentElement) {
    const cs = view.getComputedStyle(p), ox = cs.overflowX || cs.overflow, oy = cs.overflowY || cs.overflow;
    if (ox !== "hidden" && oy !== "hidden") continue;
    if (p.scrollHeight > p.clientHeight + 1) continue; // a real scroll area (fixed height): leave it
    if (ox === "hidden") p.classList.add("rv-cf-clip-x");
    if (oy === "hidden") p.classList.add("rv-cf-clip-y");
  }
}

/** Gives one field its button, or takes it away when the administrator turned it off. Returns the link, or null. */
export function ensureButton(el, id, opts, doc = document, watch = () => {}) {
  let wrap = Array.from(el.children).find((c) => c.hasAttribute(MARK) || (c.classList && c.classList.contains(WRAP))) || null;
  if (isOff(opts, id, el)) { if (wrap) wrap.remove(); return null; }
  const label = fieldLabel(el, id);
  if (el.getAttribute("data-rv-field-id") !== id) el.setAttribute("data-rv-field-id", id);
  el.classList.add("rv-has-contribute-field");
  const cs = doc.defaultView && doc.defaultView.getComputedStyle ? doc.defaultView.getComputedStyle(el) : null;
  const row = Boolean(cs && /flex/.test(cs.display) && !/column/.test(cs.flexDirection || ""));
  if (el.classList.contains("rv-has-contribute-field--row") !== row) el.classList.toggle("rv-has-contribute-field--row", row);
  if (!wrap) {
    wrap = doc.createElement("div");
    wrap.className = WRAP;
    wrap.setAttribute(MARK, "");
    wrap.innerHTML = `<a class="rv-contribute-btn ${BTN}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"></path></svg><span>${LABEL}</span></a>`;
  }
  if (!wrap.hasAttribute(MARK)) wrap.setAttribute(MARK, "");
  // always the last child, so it sticks to the bottom of its own field (a script that keeps appending after it cannot make it loop)
  const now = Date.now(), moves = (wrap.__rvMoves || []).filter((t) => now - t < 5000);
  if (el.lastElementChild !== wrap && moves.length < 20) { el.appendChild(wrap); moves.push(now); }
  wrap.__rvMoves = moves;
  const a = wrap.querySelector(`.${BTN}`) || wrap.appendChild(doc.createElement("a"));
  if (a.className !== `rv-contribute-btn ${BTN}`) a.className = `rv-contribute-btn ${BTN}`;
  if (!a.textContent.includes(LABEL)) a.textContent = LABEL;
  const href = hrefFor(opts, id, label, el), aria = `${LABEL}: ${label}`;
  if (a.getAttribute("href") !== href) a.setAttribute("href", href);
  if (a.getAttribute("aria-label") !== aria) a.setAttribute("aria-label", aria);
  if (wrap.className !== WRAP) wrap.className = WRAP;
  for (const n of [wrap, a]) { if (n.hasAttribute("hidden")) n.removeAttribute("hidden"); if (n.hasAttribute("style")) n.removeAttribute("style"); watch(n); }
  keepSticky(el, doc);
  return a;
}

/** One pass: every field gets its button. Returns the fields. */
export function apply(doc = document, opts = {}, watch) {
  const fields = findFields(doc, opts), ids = fieldIds(fields);
  fields.forEach((el, i) => ensureButton(el, ids[i], opts, doc, watch));
  return fields;
}

/** For tests and checks: the fields that should show a button but do not (a working link inside the field's own wrapper). */
export function missingButtons(doc = document, opts = {}) {
  const fields = findFields(doc, opts), ids = fieldIds(fields);
  return fields.filter((el, i) => !isOff(opts, ids[i], el)
    && !Array.from(el.children).some((c) => c.classList && c.classList.contains(WRAP) && c.querySelector(`.${BTN}[href]`)));
}

/** Starts the injector: one pass now, then again (debounced) after every change to the page. Returns { refresh, stop }. */
export function start(opts = {}, doc = document) {
  const view = doc.defaultView || globalThis;
  let queued = false;
  const watched = new WeakSet();
  const run = () => { queued = false; apply(doc, opts, watch); if (typeof opts.onPass === "function") opts.onPass(); };
  const queue = () => { if (!queued) { queued = true; view.setTimeout(run, 30); } };
  const Obs = view.MutationObserver;
  const page = Obs ? new Obs((records) => { if (records.some((r) => !ours(r.target) || r.removedNodes.length)) queue(); }) : null;
  const mine = Obs ? new Obs(queue) : null; // our own nodes: a style, hidden or class change puts them back
  function watch(n) { if (mine && !watched.has(n)) { watched.add(n); mine.observe(n, { attributes: true, attributeFilter: ["style", "hidden", "class"] }); } }
  run();
  if (page) page.observe(opts.root || doc.body, { childList: true, subtree: true });
  doc.addEventListener("rv:fields-changed", queue);
  return { refresh: run, stop: () => { if (page) page.disconnect(); if (mine) mine.disconnect(); doc.removeEventListener("rv:fields-changed", queue); } };
}
