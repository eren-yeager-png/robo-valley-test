// Contribution Portal: Admin > Sector Forms (/admin/sector-forms and the demo). Single column: the header, the sector grid ("5 fields ·
// 1 suggestion", an amber dot while suggestions wait), and the selected sector's panel "Sector form: <Sector>" with "+ Add field" and
// two tabs with count badges: Fields and Suggested fields (amber while any wait). Questions (up to five per sector) keep their own page.
//   Fields (a table, 64px rows): drag handle | name + slug | where it came from (Admin grey, Suggested by member indigo, Added by plugin
//   amber with the plugin's name) | contributions | Active/Hidden switch | Edit, Rename, Archive, Delete; Move up / Move down by keyboard;
//   every field keeps its Contribute button. Delete is never possible while a contribution uses a field (Archive instead), and a
//   plugin's field is never deleted by anyone (the server and the database refuse too).
//   With the data update (migration 030, data.features.fieldsData): "+ Add field" takes the link code (made from the name, editable),
//   a description, an icon and the status; Edit (a side drawer) changes the name, description and icon; Archive keeps every
//   contribution and takes the field out of every list members see (Restore brings it back); Delete asks first. Before 030 those
//   parts are disabled and say why.
//   Suggested fields: Suggested name | Suggested by | Reason | Sent | [Approve] [Edit & approve] [Reject] (reason required). Approving
//   adds the field at once ("Suggested by member"): it appears on the sector page with its Contribute button.
import { esc } from "./utils.js";
import { askConfirm, askReason, askText } from "./dialog.js";
import { contributeHref, headerButtonHtml } from "./sector.js";
import { bindSectorGrid, plural, sectorGridHtml } from "./sector-grid.js";
import { bindTabs, noticeHtml, openDrawer, pageHeader, panelHtml, sentHtml, slugHtml, sourceBadge, statusBadge, tableHtml, tabsHtml, toast } from "./portal-ui.js";
import { PortalRest } from "./portal-api.js";

export const TITLE = "Sector Forms";
export const DESC = "Manage the fields (robot types) members pick from, and review fields they suggest.";
export const PANEL_SUB = "The fields (robot types) members pick from, and the fields members suggested.";
export const NO_FIELDS = "No fields yet. Add the first field for this sector.";
export const NO_SUGGESTIONS = "No suggestions waiting for this sector. Approved fields appear on the sector page at once, with their Contribute button.";
export const LATER = "This comes with the data update (migration 030).";
const slugOf = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");

export async function mount(el, opts = {}) {
  const adapter = opts.adapter || new PortalRest(opts.base || "");
  const form = opts.form || "/contribute-now/";
  const here = () => opts.returnTo || (typeof location !== "undefined" ? location.href : "");
  const st = { sector: opts.sector || "", tab: opts.tab === "suggested" ? "suggested" : "fields", data: null, drag: null };
  el.classList.add("rv-cw-root", "rv-pp");

  async function load() {
    try { st.data = await adapter.sectorForms(st.sector); } catch (e) {
      el.innerHTML = pageHeader({ title: TITLE, desc: DESC, id: "rv-sf-h" }) + noticeHtml("err", esc(e && e.status === 503 ? "Sectors are not set up on this database yet." : (e && e.message) || "Sector forms could not be loaded. Please try again."));
      return false;
    }
    if (st.data.sector) st.sector = st.data.sector.slug;
    return true;
  }
  const fields = () => (st.data && st.data.fields) || [];
  const liveFields = () => fields().filter((f) => f.status !== "archived");
  const suggestions = () => (st.data && st.data.suggestions) || [];
  const full = () => Boolean(st.data && st.data.features && st.data.features.fieldsData);

  function fieldRow(f, i, n) {
    const archived = f.status === "archived";
    const usedBy = f.contributions > 0 ? `Can't delete: ${plural(f.contributions, "contribution")} use${f.contributions === 1 ? "s" : ""} this field. Archive it instead.` : "";
    const delTip = full() ? f.deleteBlock || "" : f.source === "plugin" ? `Managed by ${f.pluginName || "a plugin"}: it can only be hidden or archived.` : usedBy || LATER;
    const canDelete = full() && f.deletable === true;
    const status = archived ? '<span class="rv-pp-tag">Archived</span>'
      : `<button type="button" class="rv-sf-switch${f.active ? " is-on" : ""}" role="switch" aria-checked="${f.active}" data-toggle="${f.id}" aria-label="${esc(`${f.name}: ${f.active ? "Active" : "Hidden"}`)}"><span class="rv-sf-knob" aria-hidden="true"></span>${f.active ? "Active" : "Hidden"}</button>`;
    const archiveBtn = !full() ? `<button type="button" class="btn small" disabled title="${esc(`Archiving keeps every contribution. ${LATER}`)}">Archive</button>`
      : archived ? `<button type="button" class="btn small" data-restore="${f.id}" aria-label="${esc(`Restore ${f.name}`)}">Restore</button>`
        : `<button type="button" class="btn small" data-archive="${f.id}" aria-label="${esc(`Archive ${f.name} (its contributions stay)`)}">Archive</button>`;
    return `<tr data-field="${f.id}" draggable="true"${archived ? ' class="is-archived"' : ""}>
      <td class="rv-sf-handle"><span class="rv-sf-grip" aria-hidden="true" title="Drag to reorder">⠿</span><span class="rv-sf-move">
        <button type="button" class="btn small" data-move="up" data-id="${f.id}" aria-label="${esc(`Move ${f.name} up`)}"${i === 0 ? " disabled" : ""}>↑</button>
        <button type="button" class="btn small" data-move="down" data-id="${f.id}" aria-label="${esc(`Move ${f.name} down`)}"${i === n - 1 ? " disabled" : ""}>↓</button></span></td>
      <td class="rv-pp-col-title"><b>${f.icon ? `<span aria-hidden="true">${esc(f.icon)}</span> ` : ""}${esc(f.name)}</b>${slugHtml(f.slug)}${f.description ? `<span class="rv-pp-sub">${esc(f.description)}</span>` : ""}</td>
      <td>${sourceBadge(f.source, f.pluginName)}</td>
      <td class="rv-pp-col-num">${f.contributions.toLocaleString("en-IN")}</td>
      <td>${status}</td>
      <td class="rv-pp-col-actions"><div class="rv-pp-rowact">
        <a class="btn small rv-field-contribute" href="${esc(contributeHref(form, { sector: st.sector, field: f.slug, returnTo: here() }))}" aria-label="${esc(`Contribute to ${f.name}`)}">Contribute</a>
        <button type="button" class="btn small" data-edit="${f.id}">Edit</button>
        <button type="button" class="btn small" data-rename="${f.id}">Rename</button>
        ${archiveBtn}
        <button type="button" class="btn small danger"${canDelete ? ` data-delete="${f.id}" aria-label="${esc(`Delete ${f.name}`)}"` : ` disabled title="${esc(delTip)}" aria-label="${esc(`Delete ${f.name} (${delTip})`)}"`}>Delete</button></div></td></tr>`;
  }
  function fieldsHtml() {
    const list = fields();
    if (st.data && st.data.robotsReady === false) return noticeHtml("info", "Fields are not set up on this database yet (migration 024). The sectors are read-only until then.");
    return tableHtml({ caption: `Fields of ${st.data.sector.name}`, cls: "rv-pp-table--fields", empty: NO_FIELDS,
      head: [["", "rv-sf-handle"], ["Field", "rv-pp-col-title"], ["Source"], ["Contributions", "rv-pp-col-num"], ["Status"], ["", "rv-pp-col-actions"]],
      rows: list.map((f, i) => fieldRow(f, i, list.length)) });
  }
  function suggestionsHtml() {
    return tableHtml({ caption: `Fields members suggested for ${st.data.sector.name}`, empty: NO_SUGGESTIONS,
      head: [["Suggested name", "rv-pp-col-title"], ["Suggested by"], ["Reason"], ["Sent", "rv-pp-col-sent"], ["", "rv-pp-col-actions"]],
      rows: suggestions().map((x) => `<tr><td class="rv-pp-col-title"><b>${esc(x.name)}</b><span class="rv-pp-sub">${esc(x.code)} · ${statusBadge(x.display)}</span></td>
        <td>${esc(x.by)}</td><td class="rv-sf-reason">${esc(x.reason)}</td><td class="rv-pp-col-sent">${sentHtml(x.sentAt)}</td>
        <td class="rv-pp-col-actions"><div class="rv-pp-rowact"><button type="button" class="btn small primary" data-approve="${x.id}">Approve</button>
          <button type="button" class="btn small" data-edit-approve="${x.id}">Edit &amp; approve</button>
          <button type="button" class="btn small danger" data-reject="${x.id}">Reject</button></div></td></tr>`) });
  }

  function render() {
    const d = st.data, s = d.sector;
    const cards = d.sectors.map((x) => ({
      slug: x.slug, name: x.name, icon: x.icon || undefined, meta: `${plural(x.fields, "field")} · ${plural(x.suggestions, "suggestion")}`,
      dot: x.suggestions > 0, dotLabel: `${plural(x.suggestions, "suggestion")} waiting`, chip: x.archived ? "Archived" : x.active ? "" : "Not on the form",
    }));
    const nS = suggestions().length;
    el.innerHTML = `${pageHeader({ title: TITLE, desc: DESC, id: "rv-sf-h" })}
      ${d.sectors.length ? sectorGridHtml({ sectors: cards, selected: st.sector, label: "Sectors" }) : noticeHtml("info", "There are no sectors yet.")}
      ${s ? panelHtml({
        heading: `Sector form: ${s.name}`, sub: PANEL_SUB, id: "rv-sf-panel-h",
        actions: `${headerButtonHtml(contributeHref(form, { sector: s.slug, returnTo: here() }))}<button type="button" class="btn primary" data-add${d.robotsReady === false ? " disabled" : ""}>+ Add field</button>`,
        body: `${s.active ? "" : noticeHtml("info", "This sector is not offered on the Contribute form right now. You can still prepare its fields.")}
          ${tabsHtml([["fields", "Fields", liveFields().length], ["suggested", "Suggested fields", nS, nS ? "amber" : ""]], st.tab, { label: "Sector form", controls: "rv-sf-tab" })}
          <div id="rv-sf-tab" role="tabpanel" aria-labelledby="rv-pp-tab-${st.tab}" data-tabpanel>${st.tab === "fields" ? fieldsHtml() : suggestionsHtml()}</div>
          ${d.questionsOn !== null && d.questionsOn !== undefined && opts.questionsPath ? `<p class="rv-pp-desc">Questions on this sector's form: ${d.questionsOn} of 5. <a href="${esc(`${opts.questionsPath}/${encodeURIComponent(s.slug)}`)}">Edit the questions</a></p>` : ""}
          <div data-msg aria-live="polite"></div>`,
      }) : ""}`;
    bindSectorGrid(el, pick);
    bindTabs(el, (k, keyboard) => { st.tab = k; render(); if (keyboard) { const t = el.querySelector(`[data-tab="${k}"]`); if (t) t.focus(); } });
    bindPanel();
  }
  async function pick(slug) {
    if (!slug || slug === st.sector) return;
    st.sector = slug;
    if (opts.onSector) opts.onSector(slug);
    else if (typeof history !== "undefined" && opts.basePath) history.replaceState(null, "", `${opts.basePath}?sector=${encodeURIComponent(slug)}`);
    if (await load()) { render(); const c = el.querySelector(`.rv-sg [data-sector="${slug}"]`); if (c) c.focus(); }
  }
  async function refresh(focusSel) { if (await load()) { render(); const f = focusSel && el.querySelector(focusSel); if (f) f.focus(); } }
  const say = (html) => { const m = el.querySelector("[data-msg]"); if (m) m.innerHTML = html; };
  const failed = (e) => say(noticeHtml("err", esc((e && e.message) || "That did not work. Nothing was changed. Please try again.")));
  const byId = (id) => fields().find((f) => String(f.id) === String(id));
  /** One request at a time per button: a second click while it is saving sends nothing. */
  const once = async (btn, fn) => {
    if (btn.disabled) return;
    btn.disabled = true;
    try { await fn(); } catch (e) { failed(e); } finally { if (btn.isConnected) btn.disabled = false; }
  };

  function bindPanel() {
    const add = el.querySelector("[data-add]");
    if (add) add.addEventListener("click", addField);
    el.querySelectorAll("[data-move]").forEach((b) => b.addEventListener("click", () => once(b, async () => {
      await adapter.changeField(st.sector, b.getAttribute("data-id"), { move: b.getAttribute("data-move") });
      await refresh(`[data-move="${b.getAttribute("data-move")}"][data-id="${b.getAttribute("data-id")}"]`);
    })));
    el.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => once(b, async () => {
      const f = byId(b.getAttribute("data-toggle"));
      await adapter.changeField(st.sector, f.id, { active: !f.active });
      toast(el, `${f.name} is now ${f.active ? "hidden from" : "shown on"} the form.`);
      await refresh(`[data-toggle="${f.id}"]`);
    })));
    el.querySelectorAll("[data-rename]").forEach((b) => b.addEventListener("click", async () => {
      const f = byId(b.getAttribute("data-rename"));
      const name = await askText({ title: `Rename ${f.name}`, label: "New name (as on the robot card on the sector page)", value: f.name, confirmText: "Rename", hint: "The link code stays the same." });
      if (!name || name === f.name) return;
      await once(b, async () => { await adapter.changeField(st.sector, f.id, { name }); toast(el, `Renamed to ${name}.`); await refresh(); });
    }));
    el.querySelectorAll("[data-archive]").forEach((b) => b.addEventListener("click", async () => {
      const f = byId(b.getAttribute("data-archive"));
      const yes = await askConfirm({ title: `Archive ${f.name}?`, text: `Members no longer see "${f.name}" on the form or the sector page. ${plural(f.contributions, "contribution")} that chose it keep it, and you can restore it at any time.`, confirmText: "Archive", tone: "primary" });
      if (!yes) return;
      await once(b, async () => { await adapter.changeField(st.sector, f.id, { status: "archived" }); toast(el, `Archived ${f.name}. Its contributions stay.`); await refresh(); });
    }));
    el.querySelectorAll("[data-restore]").forEach((b) => b.addEventListener("click", () => once(b, async () => {
      const f = byId(b.getAttribute("data-restore"));
      await adapter.changeField(st.sector, f.id, { status: "active" });
      toast(el, `Restored ${f.name}: members can pick it again.`); await refresh();
    })));
    el.querySelectorAll("[data-delete]").forEach((b) => b.addEventListener("click", async () => {
      const f = byId(b.getAttribute("data-delete"));
      const yes = await askConfirm({ title: `Delete ${f.name}?`, text: `No contribution uses "${f.name}", so it can be deleted. This cannot be undone: its link code "${f.slug}" stops working.`, confirmText: "Delete" });
      if (!yes) return;
      await once(b, async () => { await adapter.deleteField(st.sector, f.id); toast(el, `Deleted ${f.name}.`); await refresh(); });
    }));
    el.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => editField(byId(b.getAttribute("data-edit")))));
    el.querySelectorAll("[data-approve], [data-edit-approve]").forEach((b) => b.addEventListener("click", () => approve(b.getAttribute("data-approve") || b.getAttribute("data-edit-approve"), b.hasAttribute("data-edit-approve"), b)));
    el.querySelectorAll("[data-reject]").forEach((b) => b.addEventListener("click", () => reject(b.getAttribute("data-reject"), b)));
    // drag to reorder: the row moves one place at a time through the same "move up / down" the buttons use
    el.querySelectorAll("tr[data-field]").forEach((tr) => {
      tr.addEventListener("dragstart", (e) => { st.drag = tr.getAttribute("data-field"); tr.classList.add("is-dragging"); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; });
      tr.addEventListener("dragend", () => { st.drag = null; tr.classList.remove("is-dragging"); });
      tr.addEventListener("dragover", (e) => { if (st.drag) e.preventDefault(); });
      tr.addEventListener("drop", async (e) => {
        e.preventDefault();
        const list = fields().map((f) => String(f.id)), from = list.indexOf(st.drag), to = list.indexOf(tr.getAttribute("data-field"));
        if (from < 0 || to < 0 || from === to) return;
        try {
          for (let k = 0; k < Math.abs(to - from); k += 1) await adapter.changeField(st.sector, st.drag, { move: to < from ? "up" : "down" });
          toast(el, "Order saved."); await refresh();
        } catch (err) { failed(err); await refresh(); }
      });
    });
  }

  /** The field form: Add (f = null) or Edit. With 030: an editable link code when adding, a description, an icon and the status. */
  function fieldFormHtml(f) {
    const on = full();
    const later = on ? "" : ' disabled aria-describedby="rv-sf-later"';
    return `<form class="rv-pp-form" data-fieldform novalidate>
      <label>Name<input name="name" maxlength="80" required value="${esc(f ? f.name : "")}" autocomplete="off"><span class="rv-pp-hint">As on the robot card on the sector page.</span></label>
      <label>Link code (slug)<input name="slug" maxlength="60" value="${esc(f ? f.slug : "")}"${f || !on ? " readonly" : ""} aria-describedby="rv-sf-slug-h" autocomplete="off" spellcheck="false"><span class="rv-pp-hint" id="rv-sf-slug-h">${f ? "Never changes, so links keep working." : on ? "Made from the name; you can change it now. Unique in this sector, and it never changes once added." : `Made from the name; unique in this sector. Editing it ${LATER.toLowerCase()}`}</span></label>
      <label>Description<textarea name="description" rows="3" maxlength="500"${later}>${esc(f ? f.description || "" : "")}</textarea></label>
      <label>Icon<input name="icon" maxlength="8" value="${esc(f ? f.icon || "" : "")}" placeholder="e.g. 🤖"${later}><span class="rv-pp-hint">A short symbol shown next to the name (optional).</span></label>
      <fieldset class="rv-sf-status"><legend>Status</legend>
        <label class="rv-sf-radio"><input type="radio" name="active" value="1"${!f || f.active ? " checked" : ""}> Active (members can pick it)</label>
        <label class="rv-sf-radio"><input type="radio" name="active" value="0"${f && !f.active && f.status !== "archived" ? " checked" : ""}> Hidden</label></fieldset>
      ${on ? "" : `<p class="rv-pp-hint" id="rv-sf-later">Descriptions and icons are stored from the data update (migration 030).</p>`}
      <div data-formmsg aria-live="polite"></div></form>`;
  }
  function addField() {
    const dr = openDrawer({ title: `Add a field to ${st.data.sector.name}`, modal: true, doc: el.ownerDocument, host: el, body: fieldFormHtml(null),
      foot: '<button type="button" class="btn" data-x="cancel">Cancel</button><button type="button" class="btn primary" data-x="save">Add field</button>' });
    const f = dr.body.querySelector("[data-fieldform]"), name = f.querySelector('[name="name"]'), slug = f.querySelector('[name="slug"]');
    let slugTyped = false;
    slug.addEventListener("input", () => { slugTyped = true; });
    name.addEventListener("input", () => { if (!slugTyped) slug.value = slugOf(name.value); });
    dr.foot.querySelector('[data-x="cancel"]').addEventListener("click", dr.close);
    const saveBtn = dr.foot.querySelector('[data-x="save"]');
    const msg = (t) => { f.querySelector("[data-formmsg]").innerHTML = noticeHtml("err", esc(t)); };
    const save = async () => {
      const v = name.value.trim(), active = f.querySelector('[name="active"]:checked').value === "1";
      if (v.length < 2) { msg("Please type a name (at least 2 characters)."); name.focus(); return; }
      if (saveBtn.disabled) return; // already saving
      saveBtn.disabled = true;
      try {
        if (full()) {
          const body = { name: v, status: active ? "active" : "hidden" };
          const s = slug.value.trim(), dsc = f.querySelector('[name="description"]').value.trim(), icon = f.querySelector('[name="icon"]').value.trim();
          if (slugTyped && s) body.slug = s;
          if (dsc) body.description = dsc;
          if (icon) body.icon = icon;
          await adapter.addField(st.sector, body);
        } else {
          const r = await adapter.addField(st.sector, { name: v });
          if (!active && r && r.robot) await adapter.changeField(st.sector, r.robot.id, { active: false });
        }
        dr.close(); toast(el, `Added ${v}. It is on the sector page at once, with its Contribute button.`); st.tab = "fields"; await refresh();
      } catch (e) { saveBtn.disabled = false; msg((e && e.message) || "The field could not be added."); }
    };
    saveBtn.addEventListener("click", save);
    f.addEventListener("submit", (e) => { e.preventDefault(); save(); });
  }
  function editField(fld) {
    const dr = openDrawer({ title: `Edit ${fld.name}`, doc: el.ownerDocument, host: el, body: `${fieldFormHtml(fld)}<p class="rv-pp-desc">${sourceBadge(fld.source, fld.pluginName)} · used by ${plural(fld.contributions, "contribution")}${fld.status === "archived" ? " · Archived" : ""}</p>`,
      foot: '<button type="button" class="btn" data-x="cancel">Cancel</button><button type="button" class="btn primary" data-x="save">Save</button>' });
    const f = dr.body.querySelector("[data-fieldform]");
    dr.foot.querySelector('[data-x="cancel"]').addEventListener("click", dr.close);
    const saveBtn = dr.foot.querySelector('[data-x="save"]');
    saveBtn.addEventListener("click", async () => {
      if (saveBtn.disabled) return;
      const name = f.querySelector('[name="name"]').value.trim(), active = f.querySelector('[name="active"]:checked').value === "1";
      saveBtn.disabled = true;
      try {
        if (full()) {
          const edit = {};
          const dsc = f.querySelector('[name="description"]').value.trim(), icon = f.querySelector('[name="icon"]').value.trim();
          if (name && name !== fld.name) edit.name = name;
          if (dsc !== (fld.description || "")) edit.description = dsc;
          if (icon !== (fld.icon || "")) edit.icon = icon;
          if (Object.keys(edit).length) await adapter.changeField(st.sector, fld.id, { edit });
          if (fld.status !== "archived" && active !== fld.active) await adapter.changeField(st.sector, fld.id, { status: active ? "active" : "hidden" });
        } else {
          if (name && name !== fld.name) await adapter.changeField(st.sector, fld.id, { name });
          if (active !== fld.active) await adapter.changeField(st.sector, fld.id, { active });
        }
        dr.close(); toast(el, `Saved ${name || fld.name}.`); await refresh();
      } catch (e) { saveBtn.disabled = false; f.querySelector("[data-formmsg]").innerHTML = noticeHtml("err", esc((e && e.message) || "Nothing was saved.")); }
    });
  }
  /** Edit & approve of a stored suggestion (030): the name, the link code and the description, then Approve. Resolves with the body or null. */
  function editSuggestion(x) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const dr = openDrawer({ title: `Edit & approve "${x.name}"`, modal: true, doc: el.ownerDocument, host: el, onClose: () => finish(null),
        body: `<form class="rv-pp-form" data-sugform novalidate>
          <label>Field name<input name="name" maxlength="80" required value="${esc(x.name)}" autocomplete="off"><span class="rv-pp-hint">As it will appear on the sector page.</span></label>
          <label>Link code (slug)<input name="slug" maxlength="60" value="${esc(slugOf(x.name))}" autocomplete="off" spellcheck="false"><span class="rv-pp-hint">Unique in this sector; it never changes once added.</span></label>
          <label>Description<textarea name="description" rows="3" maxlength="500">${esc(x.reason || "")}</textarea></label>
          <div data-formmsg aria-live="polite"></div></form>`,
        foot: '<button type="button" class="btn" data-x="cancel">Cancel</button><button type="button" class="btn primary" data-x="save">Approve</button>' });
      const f = dr.body.querySelector("[data-sugform]");
      const name = f.querySelector('[name="name"]'), slug = f.querySelector('[name="slug"]');
      let slugTyped = false;
      slug.addEventListener("input", () => { slugTyped = true; });
      name.addEventListener("input", () => { if (!slugTyped) slug.value = slugOf(name.value); });
      dr.foot.querySelector('[data-x="cancel"]').addEventListener("click", () => { finish(null); dr.close(); });
      const go = () => {
        const v = name.value.trim();
        if (v.length < 2) { f.querySelector("[data-formmsg]").innerHTML = noticeHtml("err", "Please type a name (at least 2 characters)."); name.focus(); return; }
        finish({ name: v, slug: slug.value.trim(), description: f.querySelector('[name="description"]').value.trim().slice(0, 500) });
        dr.close();
      };
      dr.foot.querySelector('[data-x="save"]').addEventListener("click", go);
      f.addEventListener("submit", (e) => { e.preventDefault(); go(); });
    });
  }
  async function approve(id, edit, btn) {
    const x = suggestions().find((s) => String(s.id) === String(id));
    if (!x) return;
    if (x.record) {
      const body = edit ? await editSuggestion(x) : {};
      if (!body) return;
      await once(btn, async () => {
        const r = await adapter.decideSuggestion(x.id, { action: "approve", ...body });
        toast(el, (r && r.message) || `Approved: ${body.name || x.name} is a field of ${st.data.sector.name} now.`);
        await refresh();
      });
      return;
    }
    const name = edit ? await askText({ title: "Edit & approve", label: "Field name (as it will appear on the sector page)", value: x.name, confirmText: "Approve" }) : x.name;
    if (!name) return;
    try {
      await adapter.addField(st.sector, { name });
      toast(el, `Approved: ${name} is a field of ${st.data.sector.name} now, on the sector page with its Contribute button.`);
      await refresh();
    } catch (e) { failed(e); }
  }
  async function reject(id, btn) {
    const x = suggestions().find((s) => String(s.id) === String(id));
    if (!x) return;
    const reason = await askReason({ title: `Reject "${x.name}"`, label: "Reason (required; recorded in the suggestion's history)", confirmText: "Reject" });
    if (!reason) return;
    if (x.record) {
      await once(btn, async () => { await adapter.decideSuggestion(x.id, { action: "reject", reason }); toast(el, `Rejected the suggestion "${x.name}".`); await refresh(); });
      return;
    }
    try {
      const it = (await adapter.detail(x.id)).item;
      const action = ["pending", "resubmitted", "failed"].includes(it.status) ? "reject" : "decline";
      await adapter.act(x.id, action, { rowVersion: it.rowVersion, reason });
      toast(el, `Rejected the suggestion "${x.name}".`);
      await refresh();
    } catch (e) { failed(e); }
  }

  if (await load()) render();
  return { refresh };
}
