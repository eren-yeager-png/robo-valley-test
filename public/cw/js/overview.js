// Contribution Portal: the Admin's Overview (the top of the admin portal's Overview page, and the demo's): four numbers (Pending publish
// requests, Published this week, Rejected, Active contributors) and the sector grid with each sector's publish requests. A card opens
// Publish Requests for that sector.
import { esc } from "./utils.js";
import { bindSectorGrid, plural, sectorGridHtml } from "./sector-grid.js";
import { noticeHtml, pageHeader } from "./portal-ui.js";
import { PortalRest } from "./portal-api.js";

export const TITLE = "Overview";
export const DESC = "Contributions at a glance: what waits for you, what went live this week and who is contributing.";
export const STATS = [["requests", "Pending publish requests"], ["publishedThisWeek", "Published this week"], ["rejected", "Rejected"], ["activeContributors", "Active contributors (last 30 days)"]];

export async function mount(el, opts = {}) {
  const adapter = opts.adapter || new PortalRest(opts.base || "");
  el.classList.add("rv-cw-root", "rv-pp");
  let d;
  try { d = await adapter.portal("overview"); } catch (e) {
    el.innerHTML = pageHeader({ title: TITLE, desc: DESC, id: "rv-ov-h" }) + noticeHtml("err", esc(e && e.status === 503 ? "Contributions are not set up on this database yet." : (e && e.message) || "The numbers could not be loaded. Please try again."));
    return null;
  }
  const t = d.totals || {};
  const cards = d.sectors.map((x) => ({ slug: x.slug, name: x.name, meta: `${plural(x.requested, "publish request")} · ${x.published} published`, count: x.requested || undefined, countLabel: `${x.requested} publish requests`, countTone: "purple" }));
  el.innerHTML = `${pageHeader({ title: TITLE, desc: DESC, id: "rv-ov-h", actions: opts.requestsPath ? `<a class="btn primary" href="${esc(opts.requestsPath)}">Open Publish Requests</a>` : "" })}
    <div class="rv-pp-stats" role="list">${STATS.map(([k, l]) => `<div class="rv-pp-stat" role="listitem"><span class="rv-pp-stat__n">${Number(t[k] || 0).toLocaleString("en-IN")}</span><span class="rv-pp-stat__l">${esc(l)}</span></div>`).join("")}</div>
    <section class="rv-pp-block" aria-labelledby="rv-ov-sectors"><h2 id="rv-ov-sectors" class="rv-pp-section-title">Publish requests by sector</h2>
    ${cards.length ? sectorGridHtml({ sectors: cards, label: "Publish requests by sector" }) : noticeHtml("info", "No sectors yet.")}</section>`;
  bindSectorGrid(el, (slug) => {
    if (opts.onSector) return opts.onSector(slug);
    if (opts.requestsPath && typeof location !== "undefined") location.href = new URL(`${opts.requestsPath}?sector=${encodeURIComponent(slug)}`, location.origin).href; // a plain page load: this module runs outside React
  });
  return null;
}
