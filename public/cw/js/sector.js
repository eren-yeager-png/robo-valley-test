// Contribution workflow: THE shared sector page component (one copy). The title on the left and "+ Contribute to this sector" on the
// right, sticky in the top-right while the page scrolls; the content in white rounded cards in the left column; a "Contribute to this
// sector" button on every field (fields.js). Used by:
//   * the website: the plugin's sector script (field-buttons.php loads it on every Robots by Sector page) puts the header button next
//     to the theme's page title and keeps it there (startSectorPage);
//   * the app: the Member portals' Sectors pages, Moderation by sector and Sector forms render the SAME html on the server
//     (sectorPageHtml / sectorHeaderHtml) and start the same field buttons in the browser;
//   * the standalone demo.
// The button opens the contribute flow with the sector (and the field) filled in and the page to come back to.
import { esc } from "./utils.js";
import { start as startFields } from "./fields.js";

export const HEADER_LABEL = "Contribute to this sector";
export const PLUS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"></path></svg>';
const RAIL = "data-rv-sector-rail";

/** The contribute flow's address with the sector (and field) filled in and the page to come back to (return_to). */
export function contributeHref(form, { sector = "", field = "", resourcePath = "", resourceUrl = "", returnTo = "" } = {}) {
  const base = form || "/contribute-now/";
  const u = new URL(base, "https://rv.invalid/");
  if (sector) u.searchParams.set("sector", sector);
  if (field) u.searchParams.set("field", field);
  if (resourcePath) u.searchParams.set("resource_path", resourcePath);
  if (resourceUrl) u.searchParams.set("resource_url", resourceUrl);
  if (returnTo) u.searchParams.set("return_to", returnTo);
  return /^https?:|^\/\//i.test(base) ? u.toString() : u.toString().replace("https://rv.invalid", "");
}

/** The header button. */
export const headerButtonHtml = (href, label = HEADER_LABEL) =>
  `<a class="rv-contribute-btn rv-contribute-btn--header" href="${esc(href)}">${PLUS}<span>${esc(label)}</span></a>`;

/** A header row for a page that has no sector-page layout of its own (the app's reviewer screens): the bar sticks to the top. */
export const sectorHeaderHtml = ({ title, href, sub = "" }) => `<div class="rv-sector-headbar" data-rv-sector-header>
  <div class="rv-sector-headbar__text"><h1 class="rv-sector-title">${esc(title)}</h1>${sub ? `<p class="rv-sector-sub">${esc(sub)}</p>` : ""}</div>
  <div class="rv-sector-cta">${headerButtonHtml(href)}</div></div>`;

/**
 * A whole sector page: the title, the cards (fields) in the left column, the sticky button on the right. `fields`:
 * [{ id, title, html, source? }] (html is trusted markup made by the caller; source "suggested" or "plugin" only labels the demo).
 */
export function sectorPageHtml({ sector, fields = [], href, suggestHref = "", intro = "" }) {
  const cards = fields.map((f) => `<section class="rv-sector-card" data-rv-field="${esc(f.id)}" data-rv-field-label="${esc(f.title)}"${f.source ? ` data-rv-field-source="${esc(f.source)}"` : ""}>
      <h2>${esc(f.title)}</h2>${f.html || ""}</section>`).join("");
  return `<div class="rv-sector-page" data-rv-sector="${esc(sector.slug)}">
  <div class="rv-sector-grid">
    <div class="rv-sector-main">
      <div class="rv-sector-head"><h1 class="rv-sector-title">${esc(sector.name)}</h1>${intro ? `<p class="rv-sector-sub">${esc(intro)}</p>` : ""}</div>
      <div class="rv-fields-root" data-rv-sector="${esc(sector.slug)}">${cards}</div>
      ${suggestHref ? `<p class="rv-sector-suggest"><a class="rv-sector-suggest__link" href="${esc(suggestHref)}">+ Suggest a field</a> <span>Missing something? Suggest a new field for this sector; it appears here once it is approved.</span></p>` : ""}
    </div>
    <aside class="rv-sector-aside" aria-label="Contribute"><div class="rv-sector-cta">${headerButtonHtml(href)}</div></aside>
  </div>
</div>`;
}

/** Wide tables scroll sideways inside their card instead of stretching the page. */
export function wrapTables(root) {
  for (const t of root.querySelectorAll("table")) {
    if (t.parentElement && t.parentElement.classList.contains("rv-table-scroll")) continue;
    const w = root.ownerDocument.createElement("div");
    w.className = "rv-table-scroll";
    t.parentNode.insertBefore(w, t);
    w.appendChild(t);
  }
}

/** On a page whose layout is the theme's (the website): the button next to the page title, sticky top-right; returns the rail. */
export function attachHeader(doc, opts) {
  const href = contributeHref(opts.form, { sector: opts.sector, returnTo: opts.returnTo || (doc.defaultView ? doc.defaultView.location.href : "") });
  const title = doc.querySelector(".entry-header .entry-title, h1.entry-title, .elementor-widget-theme-post-title .elementor-heading-title, main h1:not(.rv-sector-title)");
  const host = (title && (title.closest("article") || title.closest("main"))) || doc.querySelector(".rv-fields-root")?.parentElement || doc.querySelector("main");
  if (!host) return null;
  let rail = host.querySelector(`:scope > [${RAIL}]`);
  if (!rail) {
    rail = doc.createElement("div");
    rail.className = "rv-sector-rail";
    rail.setAttribute(RAIL, "");
    rail.innerHTML = `<div class="rv-sector-cta">${headerButtonHtml(href)}</div>`;
  }
  if (host.firstElementChild !== rail) host.insertBefore(rail, host.firstElementChild);
  const a = rail.querySelector(".rv-contribute-btn--header");
  if (a && a.getAttribute("href") !== href) a.setAttribute("href", href);
  for (const n of [rail, rail.firstElementChild, a]) if (n) { n.removeAttribute("hidden"); n.removeAttribute("style"); }
  host.classList.add("rv-has-sector-rail");
  const row = title ? (title.closest(".entry-header") || title.parentElement) : null;
  if (row) row.classList.add("rv-sector-head");
  const w = a ? a.getBoundingClientRect().width : 0;
  if (w > 0) host.style.setProperty("--rv-cta-width", `${Math.ceil(w)}px`);
  return rail;
}

/**
 * Starts everything on a sector page: the header button (unless the page already has one), wide tables, and the button on every
 * field; all of it is put back after any change to the page. Returns { refresh, stop }.
 */
export function startSectorPage(opts = {}, doc = document) {
  const extra = () => {
    if (opts.header !== false) attachHeader(doc, opts);
    for (const r of (opts.root || doc).querySelectorAll(".rv-fields-root")) wrapTables(r);
  };
  extra();
  const fields = startFields({ ...opts, onPass: extra }, doc);
  return fields;
}
