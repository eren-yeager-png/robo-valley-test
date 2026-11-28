// Contribution Portal: the Admin's Sectors page (/admin/sectors and the demo). The header with "+ Add sector", the sector grid ("n fields ·
// m contributions"), and the selected sector's panel: its details, its contributions in every state (each number opens that list in
// Moderation) and its actions (Rename, Move up, Move down, Card style, Archive or Restore); below, every sector's numbers in one table
// (the former "Sector counts" page). The server checks every change (administrators only) and writes the Audit Log.
// Archiving and the card's style need the data update (migration 030, counts.features.sectorsData): until then those buttons say so.
// An archived sector is out of every list members see; its contributions stay. Archiving waits until nothing in the sector waits for
// a decision. Sectors are never deleted.
import { esc } from "./utils.js";
import { askConfirm, askText } from "./dialog.js";
import { bindSectorGrid, plural, sectorGridHtml } from "./sector-grid.js";
import { noticeHtml, openDrawer, pageHeader, panelHtml, slugHtml, tableHtml, toast } from "./portal-ui.js";
import { PortalRest } from "./portal-api.js";

export const TITLE = "Sectors";
export const DESC = "The sectors members contribute to: their fields, their contributions and where each one stands.";
export const LATER = "Archiving a sector and its card's icon and colour come with the data update (migration 030).";
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
  async function load() {
    try {
      const [c, f] = await Promise.all([adapter.sectorCounts(), adapter.formConfig().catch(() => ({ sectors: [] }))]);
      st.counts = c; st.sectors = f.sectors || [];
      return true;
    } catch (e) {
      el.innerHTML = pageHeader({ title: TITLE, desc: DESC, id: "rv-sec-h" }) + noticeHtml("err", esc((e && e.message) || "The sectors could not be loaded. Please try again."));
      return false;
    }
  }
  if (!(await load())) return null;
  const full = () => Boolean(st.counts && st.counts.features && st.counts.features.sectorsData);
  const fieldsOf = (slug) => ((st.sectors.find((s) => s.slug === slug) || {}).robots || []).length;
  const link = (slug, tab, v) => (tab && v > 0 ? `<a href="${esc(`${moderation}?sector=${encodeURIComponent(slug)}&tab=${tab}`)}">${v.toLocaleString("en-IN")}</a>` : v.toLocaleString("en-IN"));
  const later = (label, cls = "") => `<button type="button" class="btn${cls ? " " + cls : ""}" disabled title="${esc(LATER)}">${esc(label)}</button>`;
  const b = (act, label, cls = "", extra = "") => `<button type="button" class="btn${cls ? " " + cls : ""}" data-sec="${act}"${extra}>${esc(label)}</button>`;

  function render() {
    const rows = st.counts.sectors || [];
    if (!st.sector && rows[0]) st.sector = rows[0].slug;
    const s = rows.find((x) => x.slug === st.sector) || null;
    const editable = rows.filter((x) => !x.demo);
    const at = s ? editable.findIndex((x) => x.slug === s.slug) : -1;
    const cards = rows.map((x) => ({ slug: x.slug, name: x.name, icon: x.icon || undefined, meta: `${plural(fieldsOf(x.slug), "field")} · ${plural(x.total, "contribution")}`,
      chip: x.archived ? "Archived" : x.demo ? "Demo" : x.active ? "" : "Not on the form" }));
    const actions = !s || s.demo ? "" : `${b("rename", "Rename")}${b("up", "Move up", "", at <= 0 ? " disabled" : "")}${b("down", "Move down", "", at < 0 || at >= editable.length - 1 ? " disabled" : "")}`
      + (full() ? `${b("style", "Card style")}${s.archived ? b("restore", "Restore", "primary") : b("archive", "Archive", "danger")}` : `${later("Card style")}${later("Archive", "danger")}`);
    el.innerHTML = `${pageHeader({ title: TITLE, desc: DESC, id: "rv-sec-h", actions: b("add", "+ Add sector", "primary") })}
      ${rows.length && st.counts.sum && !st.counts.sum.total ? noticeHtml("info", "<b>No contributions yet.</b> The numbers loaded, and every sector is at 0.") : ""}
      ${rows.length ? sectorGridHtml({ sectors: cards, selected: st.sector, label: "Sectors" }) : noticeHtml("info", "No sectors yet.")}
      ${s ? panelHtml({
        heading: `Sector: ${s.name}`, id: "rv-sec-panel-h",
        sub: s.archived ? "Archived: members no longer see it. Its contributions stay." : s.active ? "Offered on the Contribute form." : "Not offered on the Contribute form right now.",
        actions,
        body: `<dl class="rv-pp-dl"><dt>Link code</dt><dd>${slugHtml(s.slug)}</dd>${s.icon || s.color ? `<dt>Card</dt><dd>${s.icon ? `<span aria-hidden="true">${esc(s.icon)}</span> ` : ""}${s.color ? `<code class="rv-pp-slug">${esc(s.color)}</code>` : ""}</dd>` : ""}<dt>Fields</dt><dd>${plural(fieldsOf(s.slug), "field")} <a href="${esc(`${opts.sectorFormsPath || "/admin/sector-forms"}?sector=${encodeURIComponent(s.slug)}`)}">Open in Sector Forms</a></dd></dl>
          ${full() ? "" : `<p class="rv-pp-desc">${esc(LATER)}</p>`}
          <h3 class="rv-pp-section-title">Contributions in ${esc(s.name)}</h3>
          ${tableHtml({ caption: `Contributions in ${s.name} by state`, head: COLS.map(([, l]) => [l, "rv-pp-col-num"]), rows: [`<tr>${COLS.map(([k, , tab]) => `<td class="rv-pp-col-num">${link(s.slug, tab, s[k])}</td>`).join("")}</tr>`] })}
          <div data-msg aria-live="polite"></div>`,
      }) : ""}
      <section class="rv-pp-block" aria-labelledby="rv-sec-all"><h2 id="rv-sec-all" class="rv-pp-section-title">Every sector</h2>
      <p class="rv-pp-desc">How many contributions sent with the current form each sector holds in each state. A number opens that list in Moderation. A contribution in several sectors is counted once in each of them, so the sector rows can add up to more than the contributions; drafts are private to their authors, so they are never counted.</p>
      ${tableHtml({ caption: "Contributions by sector", head: [["Sector", "rv-pp-col-title"], ...COLS.map(([, l]) => [l, "rv-pp-col-num"])], empty: "There are no sectors yet.",
        rows: [...rows.map((x) => `<tr><th scope="row">${esc(x.name)}${x.archived ? ' <span class="rv-pp-tag">Archived</span>' : ""}</th>${COLS.map(([k, , tab]) => `<td class="rv-pp-col-num">${link(x.slug, tab, x[k])}</td>`).join("")}</tr>`),
          ...(st.counts.sum ? [`<tr class="rv-pp-sum"><th scope="row">Total of the sector rows</th>${COLS.map(([k]) => `<td class="rv-pp-col-num">${Number(st.counts.sum[k] || 0).toLocaleString("en-IN")}</td>`).join("")}</tr>`] : []),
          ...(st.counts.unique ? [`<tr class="rv-pp-sum"><th scope="row">Unique contributions</th>${COLS.map(([k]) => `<td class="rv-pp-col-num">${Number(st.counts.unique[k] || 0).toLocaleString("en-IN")}</td>`).join("")}</tr>`] : [])] })}</section>`;
    bindSectorGrid(el, (slug) => {
      st.sector = slug;
      if (opts.onSector) opts.onSector(slug);
      else if (typeof history !== "undefined" && opts.basePath) history.replaceState(null, "", `${opts.basePath}?sector=${encodeURIComponent(slug)}`);
      render();
      const c = el.querySelector(`.rv-sg [data-sector="${slug}"]`); if (c) c.focus();
    });
    el.querySelectorAll("[data-sec]").forEach((btn) => btn.addEventListener("click", () => act(btn.getAttribute("data-sec"), btn, s)));
  }

  const say = (html) => { const m = el.querySelector("[data-msg]"); if (m) m.innerHTML = html; };
  async function after(message, slug, focus) {
    if (slug) st.sector = slug;
    if (await load()) { render(); toast(el, message); const f = focus && el.querySelector(focus); if (f) f.focus(); }
  }
  async function act(what, btn, s) {
    if (btn.disabled) return;
    try {
      if (what === "add") return addSector();
      if (!s) return;
      if (what === "rename") {
        const name = await askText({ title: `Rename ${s.name}`, label: "New name", value: s.name, confirmText: "Rename", maxLength: 100, hint: `The link code stays "${s.slug}", so links keep working.` });
        if (!name || name === s.name) return;
        btn.disabled = true;
        const r = await adapter.changeSector(s.slug, { name });
        return after((r && r.message) || `Renamed to ${name}.`, s.slug);
      }
      if (what === "up" || what === "down") {
        btn.disabled = true;
        await adapter.changeSector(s.slug, { move: what });
        return after("Order saved.", s.slug, `[data-sec="${what}"]`);
      }
      if (what === "archive") {
        const yes = await askConfirm({ title: `Archive ${s.name}?`, text: `Members will no longer see "${s.name}" on their sector pages or on the Contribute form. Its contributions and published ideas stay, and you can restore it at any time.`, confirmText: "Archive" });
        if (!yes) return;
        btn.disabled = true;
        const r = await adapter.changeSector(s.slug, { archived: true });
        return after((r && r.message) || `Archived ${s.name}.`, s.slug);
      }
      if (what === "restore") {
        btn.disabled = true;
        const r = await adapter.changeSector(s.slug, { archived: false });
        return after((r && r.message) || `Restored ${s.name}.`, s.slug);
      }
      if (what === "style") return styleSector(s);
    } catch (e) {
      if (btn.isConnected) btn.disabled = false;
      say(noticeHtml("err", esc((e && e.message) || "That did not work. Nothing was changed. Please try again.")));
    }
    return null;
  }
  function formHtml(o) {
    return `<form class="rv-pp-form" data-secform novalidate>
      ${o.add ? `<label>Name<input name="name" maxlength="100" required autocomplete="off"><span class="rv-pp-hint">As members will see it.</span></label>` : ""}
      ${full() ? `<label>Icon<input name="icon" maxlength="8" value="${esc(o.icon || "")}" placeholder="e.g. 🌾"><span class="rv-pp-hint">A short symbol on the sector's card (optional).</span></label>
      <label>Colour<input name="color" maxlength="7" value="${esc(o.color || "")}" placeholder="#1F7A5C" spellcheck="false"><span class="rv-pp-hint">The card's colour as #RRGGBB (optional).</span></label>` : ""}
      <div data-formmsg aria-live="polite"></div></form>`;
  }
  function addSector() {
    const dr = openDrawer({ title: "Add a sector", modal: true, doc: el.ownerDocument, host: el, body: formHtml({ add: true }),
      foot: '<button type="button" class="btn" data-x="cancel">Cancel</button><button type="button" class="btn primary" data-x="save">Add sector</button>' });
    const f = dr.body.querySelector("[data-secform]"), save = dr.foot.querySelector('[data-x="save"]');
    dr.foot.querySelector('[data-x="cancel"]').addEventListener("click", dr.close);
    const go = async () => {
      const name = f.querySelector('[name="name"]').value.trim();
      if (name.length < 2) { f.querySelector("[data-formmsg]").innerHTML = noticeHtml("err", "Please type a name (at least 2 characters)."); return; }
      if (save.disabled) return;
      save.disabled = true;
      const body = { name };
      if (full()) { const i = f.querySelector('[name="icon"]').value.trim(), c = f.querySelector('[name="color"]').value.trim(); if (i) body.icon = i; if (c) body.color = c; }
      try {
        const r = await adapter.addSector(body);
        dr.close();
        await after((r && r.message) || `Added ${name}.`, r && r.sector ? r.sector.slug : "");
      } catch (e) { save.disabled = false; f.querySelector("[data-formmsg]").innerHTML = noticeHtml("err", esc((e && e.message) || "The sector could not be added.")); }
    };
    save.addEventListener("click", go);
    f.addEventListener("submit", (e) => { e.preventDefault(); go(); });
  }
  function styleSector(s) {
    const dr = openDrawer({ title: `Card style: ${s.name}`, modal: true, doc: el.ownerDocument, host: el, body: formHtml({ icon: s.icon, color: s.color }),
      foot: '<button type="button" class="btn" data-x="cancel">Cancel</button><button type="button" class="btn primary" data-x="save">Save</button>' });
    const f = dr.body.querySelector("[data-secform]"), save = dr.foot.querySelector('[data-x="save"]');
    dr.foot.querySelector('[data-x="cancel"]').addEventListener("click", dr.close);
    const go = async () => {
      if (save.disabled) return;
      save.disabled = true;
      try {
        await adapter.changeSector(s.slug, { style: { icon: f.querySelector('[name="icon"]').value.trim(), color: f.querySelector('[name="color"]').value.trim() } });
        dr.close();
        await after(`The card of ${s.name} is updated.`, s.slug);
      } catch (e) { save.disabled = false; f.querySelector("[data-formmsg]").innerHTML = noticeHtml("err", esc((e && e.message) || "Nothing was saved.")); }
    };
    save.addEventListener("click", go);
    f.addEventListener("submit", (e) => { e.preventDefault(); go(); });
  }
  render();
  return null;
}
