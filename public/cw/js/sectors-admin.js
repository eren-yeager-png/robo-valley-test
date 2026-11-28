// Contribution Portal: the Admin's Sectors page (/admin/sectors and the demo). The header, the sector grid ("n fields · m
// contributions"), and the selected sector's panel: its details, its contributions in every state (each number opens that list in
// Moderation) and the sector's actions; below, every sector's numbers in one table (the former "Sector counts" page). Adding,
// renaming, reordering and archiving a sector need the sector columns of the data update (Phase B); until then those buttons say so.
import { esc } from "./utils.js";
import { bindSectorGrid, plural, sectorGridHtml } from "./sector-grid.js";
import { noticeHtml, pageHeader, panelHtml, slugHtml, tableHtml } from "./portal-ui.js";
import { PortalRest } from "./portal-api.js";

export const TITLE = "Sectors";
export const DESC = "The sectors members contribute to: their fields, their contributions and where each one stands.";
export const LATER = "Adding, renaming, reordering and archiving sectors come with the data update (Phase B).";
// a number -> that sector's list in Moderation, on the matching tab
const COLS = [
  ["submitted", "Submitted", "pending"], ["verified", "Verified", "approved"], ["changesRequested", "Changes requested", "pending"],
  ["published", "Approved / published", "published"], ["rejected", "Rejected", "rejected"], ["unpublished", "Unpublished", "published"], ["total", "Total", ""],
];

export async function mount(el, opts = {}) {
  const adapter = opts.adapter || new PortalRest(opts.base || "");
  const moderation = opts.moderationPath || "/admin/moderation";
  const st = { sector: opts.sector || "", counts: null, sectors: [] };
  el.classList.add("rv-cw-root", "rv-pp");
  try {
    const [c, f] = await Promise.all([adapter.sectorCounts(), adapter.formConfig().catch(() => ({ sectors: [] }))]);
    st.counts = c; st.sectors = f.sectors || [];
  } catch (e) {
    el.innerHTML = pageHeader({ title: TITLE, desc: DESC, id: "rv-sec-h" }) + noticeHtml("err", esc((e && e.message) || "The sectors could not be loaded. Please try again."));
    return null;
  }
  const fieldsOf = (slug) => ((st.sectors.find((s) => s.slug === slug) || {}).robots || []).length;
  const link = (slug, tab, v) => (tab && v > 0 ? `<a href="${esc(`${moderation}?sector=${encodeURIComponent(slug)}&tab=${tab}`)}">${v.toLocaleString("en-IN")}</a>` : v.toLocaleString("en-IN"));
  const later = (label, cls = "") => `<button type="button" class="btn${cls ? " " + cls : ""}" disabled title="${esc(LATER)}">${esc(label)}</button>`;

  function render() {
    const rows = st.counts.sectors || [];
    if (!st.sector && rows[0]) st.sector = rows[0].slug;
    const s = rows.find((x) => x.slug === st.sector) || null;
    const cards = rows.map((x) => ({ slug: x.slug, name: x.name, meta: `${plural(fieldsOf(x.slug), "field")} · ${plural(x.total, "contribution")}`, chip: x.active ? "" : "Not on the form" }));
    el.innerHTML = `${pageHeader({ title: TITLE, desc: DESC, id: "rv-sec-h", actions: later("+ Add sector", "primary") })}
      ${rows.length && st.counts.sum && !st.counts.sum.total ? noticeHtml("info", "<b>No contributions yet.</b> The numbers loaded, and every sector is at 0.") : ""}
      ${rows.length ? sectorGridHtml({ sectors: cards, selected: st.sector, label: "Sectors" }) : noticeHtml("info", "No sectors yet.")}
      ${s ? panelHtml({
        heading: `Sector: ${s.name}`, id: "rv-sec-panel-h", sub: s.active ? "Offered on the Contribute form." : "Not offered on the Contribute form right now.",
        actions: `${later("Rename")}${later("Move up")}${later("Move down")}${later("Archive", "danger")}`,
        body: `<dl class="rv-pp-dl"><dt>Link code</dt><dd>${slugHtml(s.slug)}</dd><dt>Fields</dt><dd>${plural(fieldsOf(s.slug), "field")} <a href="${esc(`${opts.sectorFormsPath || "/admin/sector-forms"}?sector=${encodeURIComponent(s.slug)}`)}">Open in Sector Forms</a></dd></dl>
          <p class="rv-pp-desc">${esc(LATER)}</p>
          <h3 class="rv-pp-section-title">Contributions in ${esc(s.name)}</h3>
          ${tableHtml({ caption: `Contributions in ${s.name} by state`, head: COLS.map(([, l]) => [l, "rv-pp-col-num"]), rows: [`<tr>${COLS.map(([k, , tab]) => `<td class="rv-pp-col-num">${link(s.slug, tab, s[k])}</td>`).join("")}</tr>`] })}`,
      }) : ""}
      <section class="rv-pp-block" aria-labelledby="rv-sec-all"><h2 id="rv-sec-all" class="rv-pp-section-title">Every sector</h2>
      <p class="rv-pp-desc">How many contributions sent with the current form each sector holds in each state. A number opens that list in Moderation. A contribution in several sectors is counted once in each of them, so the sector rows can add up to more than the contributions; drafts are private to their authors, so they are never counted.</p>
      ${tableHtml({ caption: "Contributions by sector", head: [["Sector", "rv-pp-col-title"], ...COLS.map(([, l]) => [l, "rv-pp-col-num"])], empty: "There are no sectors yet.",
        rows: [...rows.map((x) => `<tr><th scope="row">${esc(x.name)}</th>${COLS.map(([k, , tab]) => `<td class="rv-pp-col-num">${link(x.slug, tab, x[k])}</td>`).join("")}</tr>`),
          ...(st.counts.sum ? [`<tr class="rv-pp-sum"><th scope="row">Total of the sector rows</th>${COLS.map(([k]) => `<td class="rv-pp-col-num">${Number(st.counts.sum[k] || 0).toLocaleString("en-IN")}</td>`).join("")}</tr>`] : []),
          ...(st.counts.unique ? [`<tr class="rv-pp-sum"><th scope="row">Unique contributions</th>${COLS.map(([k]) => `<td class="rv-pp-col-num">${Number(st.counts.unique[k] || 0).toLocaleString("en-IN")}</td>`).join("")}</tr>`] : [])] })}</section>`;
    bindSectorGrid(el, (slug) => {
      st.sector = slug;
      if (opts.onSector) opts.onSector(slug);
      else if (typeof history !== "undefined" && opts.basePath) history.replaceState(null, "", `${opts.basePath}?sector=${encodeURIComponent(slug)}`);
      render();
      const c = el.querySelector(`.rv-sg [data-sector="${slug}"]`); if (c) c.focus();
    });
  }
  render();
  return null;
}
