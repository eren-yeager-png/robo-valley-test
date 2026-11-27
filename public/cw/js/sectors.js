// Contribution workflow: the Member portals' "Sectors" screens (and the demo). Every sector as a card, and one sector's page drawn
// with the SAME shared sector page component as the website (sector.js): the title with "+ Contribute to this sector", the content in
// cards, a button on every field and "+ Suggest a field". Read-only: the only actions are Contribute and Suggest a field. Sectors and
// their fields come from Sector Forms (the app) or the demo's data, so a new sector or field appears by itself.
import { esc } from "./utils.js";
import { RestAdapter } from "./api.js";
import { contributeHref, sectorPageHtml, startSectorPage } from "./sector.js";

const notice = (kind, text) => `<div class="cw-notice cw-n-${kind}" role="${kind === "err" ? "alert" : "status"}">${esc(text)}</div>`;
const about = (s) => s.description || `Robots at work in ${s.name}: share a problem you see, an idea, or a resource that helps others.`;

/** The fields of a sector page: the demo gives them; the app makes them from the sector's robot types (Sector Forms). */
export function fieldsOf(s) {
  if (Array.isArray(s.fields) && s.fields.length) return s.fields;
  return [
    { id: "about-this-sector", title: "About this sector", html: `<p>${esc(about(s))}</p>` },
    ...(s.robots || []).map((r) => ({ id: r.slug, title: r.name, html: `<p>Problems, ideas and resources about ${esc(r.name.toLowerCase())} in ${esc(s.name)}.</p>` })),
  ];
}

export async function mount(el, opts = {}) {
  const adapter = opts.adapter || new RestAdapter(opts.base || "");
  const form = opts.form || "/contribute-now/";
  const here = () => opts.returnTo || (typeof location !== "undefined" ? location.href : "");
  el.classList.add("rv-cw-root");
  let sectors;
  try { sectors = (await adapter.formConfig()).sectors || []; } catch (e) {
    el.innerHTML = notice("err", e && e.status === 503 ? "Sectors are not available yet." : "The sectors could not be loaded. Please try again.");
    return null;
  }
  const s = opts.slug ? sectors.find((x) => x.slug === opts.slug) : null;
  if (!opts.slug) {
    const link = (slug) => (opts.sectorHref ? opts.sectorHref(slug) : `${opts.basePath || "/dashboard/sectors"}/${encodeURIComponent(slug)}`);
    el.innerHTML = `<section class="rv-sectors" aria-labelledby="rv-sectors-h"><h1 id="rv-sectors-h">Sectors</h1>
      <p class="cw-muted">Every RoboValley sector. Open one to contribute to it or to one of its fields.</p>
      ${sectors.length ? `<div class="rv-sector-cards">${sectors.map((x) => `<article class="rv-sector-tile"><h2>${esc(x.name)}</h2><p>${esc(about(x))}</p>
        <p class="cw-muted">${fieldsOf(x).length} fields</p><a class="rv-sector-tile__link" href="${esc(link(x.slug))}" data-sector="${esc(x.slug)}">View sector</a></article>`).join("")}</div>`
        : notice("info", "No sectors yet.")}</section>`;
    if (opts.onOpen) el.querySelectorAll("[data-sector]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); opts.onOpen(a.getAttribute("data-sector")); }));
    return null;
  }
  if (!s) { el.innerHTML = notice("info", "We could not find that sector."); return null; }
  const href = contributeHref(form, { sector: s.slug, returnTo: here() });
  const suggestHref = `${contributeHref(form, { sector: s.slug, resourcePath: `Robots by Sector › ${s.name}`, returnTo: here() })}&kind=Suggestion`;
  el.innerHTML = sectorPageHtml({ sector: s, fields: fieldsOf(s), href, suggestHref, intro: opts.intro || "" });
  return startSectorPage({ sector: s.slug, sectorName: s.name, form, off: opts.off || [], header: false, returnTo: here(), root: el }, el.ownerDocument);
}
