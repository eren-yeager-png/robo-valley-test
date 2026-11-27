// Contribution workflow: the Moderator Workspace (admin portal, /admin/workspace; and the demo). The demo's screen, through the adapter:
// list with filters, open (Submitted -> Under Moderator Review), edit the version for publishing, Save Draft, Reset to Original, Submit
// Publishing Request to Admin, Decline Idea (a real dialog with a required reason). Moderators never publish. The server decides
// every step; this screen only shows what it says.
import { $, $$, checkedValues, esc, fmtDate, options, pills } from "./utils.js";
import { CATEGORIES, LEVELS, MESSAGES, MOD_FILTERS, NOT_SURE, NOT_SURE_LABEL, PATHS, STATUS } from "./lists.js";
import { canModeratorEdit, isModified } from "./rules.js";
import { RestAdapter } from "./api.js";
import { askReason } from "./dialog.js";
import { attachmentHtml, badge, fieldsHtml, historyHtml, lastFeedback, notice, requestHtml } from "./review.js";

const INTRO = "Verify each idea. If it is good as it is, send it to Admin unchanged. If it needs improvement, edit it first, including category, suitable for and path. The original submission is always kept. Moderators cannot publish.";

export async function mount(el, opts = {}) {
  const adapter = opts.adapter || new RestAdapter(opts.base || "");
  const st = { filter: "Open", selected: null, item: null, sectors: [], msg: "" };
  el.classList.add("rv-cw-root");
  el.innerHTML = `<section class="adm-card cw-intro" aria-labelledby="cw-mod-h"><h2 id="cw-mod-h">Moderator Workspace</h2><p class="cw-muted">${esc(INTRO)}</p><p class="cw-earlier" data-earlier hidden></p></section>
  <div class="cw-layout"><div class="cw-listcol"><div class="cw-filters" role="group" aria-label="Filter" data-filters></div><div data-list aria-live="polite"></div></div><div data-detail></div></div>`;
  try { st.sectors = (await adapter.formConfig()).sectors || []; } catch { st.sectors = []; }

  const say = (html) => { const m = $(el, "[data-msg]"); if (m) m.innerHTML = html; };
  const fail = async (e) => {
    if (e && e.status === 409 && e.error === "STALE") { await openItem(st.selected, false); say(notice("err", esc(MESSAGES.stale), "alert")); return; }
    say(notice("err", esc((e && e.message) || MESSAGES.failed), "alert"));
  };

  async function renderList() {
    let r;
    try { r = await adapter.list("workspace", st.filter); } catch (e) { $(el, "[data-list]").innerHTML = notice("err", esc(e.status === 503 ? "The contribution workflow is not set up yet." : MESSAGES.failed), "alert"); return; }
    $(el, "[data-filters]").innerHTML = Object.keys(MOD_FILTERS).map((k) =>
      `<button type="button" class="cw-chip${k === st.filter ? " on" : ""}" aria-pressed="${k === st.filter}" data-filter="${esc(k)}">${esc(k)}${k === "Open" ? ` <span class="cw-count">${r.counts.open}</span>` : ""}</button>`).join("");
    $$(el, "[data-filter]").forEach((b) => b.addEventListener("click", () => { st.filter = b.getAttribute("data-filter"); renderList(); }));
    const earlier = $(el, "[data-earlier]");
    if (typeof r.earlier === "number") {
      earlier.hidden = false;
      earlier.innerHTML = `Earlier contributions (old form): <b>${r.earlier}</b>, <a href="/admin/moderation">open in Moderation</a>`;
    }
    $(el, "[data-list]").innerHTML = r.items.length ? r.items.map((i) => `<button type="button" class="cw-item${i.id === st.selected ? " sel" : ""}" data-id="${i.id}" aria-current="${i.id === st.selected}">
      ${badge(i.status)} <span class="cw-muted">${esc(i.code)}</span>
      <span class="cw-t">${esc(i.title)}</span>
      <span class="cw-muted cw-meta">${esc(i.kind)} · ${esc(i.contributorName)} · ${esc(i.contributorType)} · ${esc(i.sectorName)}</span></button>`).join("")
      : '<div class="cw-empty">Nothing here.</div>';
    $$(el, "[data-id]").forEach((b) => b.addEventListener("click", () => openItem(Number(b.getAttribute("data-id")), true)));
    if (opts.onChange) opts.onChange(r.counts);
  }

  async function openItem(id, markOpened) {
    if (!id) return;
    st.selected = id;
    try {
      st.item = markOpened ? (await adapter.act(id, "open", {})).item : (await adapter.detail(id)).item;
    } catch (e) { $(el, "[data-detail]").innerHTML = notice("err", esc((e && e.message) || MESSAGES.failed), "alert"); return; }
    renderDetail();
    await renderList();
  }

  function readForm() {
    const d = $(el, "[data-detail]");
    return {
      proposed: {
        title: $(d, "#cw-m-title").value, description: $(d, "#cw-m-desc").value, sector: $(d, "#cw-m-sector").value, robotType: $(d, "#cw-m-robot").value,
        categories: checkedValues(d, "cw-m-cat"), suitableFor: checkedValues(d, "cw-m-lvl"), learningPath: $(d, "#cw-m-path").value,
      },
      notes: $(d, "#cw-m-notes").value,
    };
  }

  function renderDetail() {
    const it = st.item, d = $(el, "[data-detail]");
    if (!it) { d.innerHTML = '<div class="adm-card"><div class="cw-empty">Select a contribution to review.</div></div>'; return; }
    const editable = canModeratorEdit(it.status), dis = editable ? "" : " disabled", ro = editable ? "" : " readonly";
    const fb = lastFeedback(it, "changes"), rej = lastFeedback(it);
    const p = it.proposed;
    const sectorOptions = [[NOT_SURE, NOT_SURE_LABEL], ...st.sectors.map((s) => [s.slug, s.name])];
    if (p.sector && !sectorOptions.some((o) => o[0] === p.sector)) sectorOptions.push([p.sector, p.sector]);
    d.innerHTML = `<article class="adm-card cw-detail" aria-labelledby="cw-d-h">
      <div class="cw-head"><h3 id="cw-d-h">${esc(it.code)} – ${esc(it.original.title)}</h3>${badge(it.status)}</div>
      <p class="cw-muted">Submitted by <b>${esc(it.contributor.name)}</b> (${esc(it.contributor.typeLabel)}) on ${esc(fmtDate(it.submittedAt))}${it.attachment ? ` · Attachment: ${attachmentHtml(it, adapter)}` : ""}</p>
      ${it.status === STATUS.CHANGES && fb ? notice("warn", `<b>Admin requested changes:</b> ${esc(fb.text)}<br><span class="cw-muted">${esc(fb.by)} · ${esc(fmtDate(fb.at))}</span>`) : ""}
      ${[STATUS.PENDING, STATUS.RESUBMITTED].includes(it.status) ? notice("info", "Publishing request is with Admin. You can't edit it until Admin responds.") : ""}
      ${it.status === STATUS.PUBLISHED ? notice("ok", `Published by Admin on ${esc(fmtDate(it.publishedAt))}.`) : ""}
      ${it.status === STATUS.REJECTED ? notice("err", `Rejected. Reason: ${esc((rej && rej.text) || "")}`) : ""}
      ${requestHtml(it)}
      <div class="cw-grid2">
        <div class="cw-box"><h4>Original submission (read-only)</h4>${fieldsHtml(it.original, st.sectors)}</div>
        <div>
          <h4 class="cw-h4">Version for publishing <span class="cw-tag">${isModified(it) ? "Edited" : "Unchanged"}</span></h4>
          <label for="cw-m-title">Title</label><input id="cw-m-title" maxlength="150" value="${esc(p.title)}"${ro}>
          <label for="cw-m-desc">Description</label><textarea id="cw-m-desc" rows="5" maxlength="3000"${ro}>${esc(p.description)}</textarea>
          <div class="cw-grid2 cw-tight">
            <div><label for="cw-m-sector">Sector</label><select id="cw-m-sector"${dis}>${options(sectorOptions, p.sector || NOT_SURE)}</select></div>
            <div><label for="cw-m-robot">Robot type</label><select id="cw-m-robot"${dis}></select></div>
          </div>
          <fieldset class="cw-fs"><legend>Category</legend>${pills("cw-m-cat", CATEGORIES, p.categories || [], { disabled: !editable })}</fieldset>
          <fieldset class="cw-fs"><legend>Suitable for</legend>${pills("cw-m-lvl", LEVELS, p.suitableFor || [], { disabled: !editable })}</fieldset>
          <label for="cw-m-path">Suggested path</label><select id="cw-m-path"${dis}>${options([["", "Not set"], ...PATHS], p.learningPath || "")}</select>
        </div>
      </div>
      <label for="cw-m-notes">Internal notes for Admin (never shown publicly)</label>
      <textarea id="cw-m-notes" rows="3" maxlength="2000" placeholder="What did you change and why? Or why it is good as-is."${ro}>${esc(it.notes)}</textarea>
      ${editable ? `<div class="cw-actions">
        <button type="button" class="btn" data-act="save">Save Draft</button>
        <button type="button" class="btn" data-act="reset">Reset to Original</button>
        <button type="button" class="btn primary" data-act="send">Submit Publishing Request to Admin</button>
        <button type="button" class="btn danger" data-act="decline">Decline Idea</button>
      </div>
      <p class="cw-muted">If you made no changes, the original idea is sent to Admin as-is. None of these actions publish anything.</p>` : ""}
      <div data-msg aria-live="polite"></div>
      <h4 class="cw-h4">Activity history</h4>${historyHtml(it)}
    </article>`;
    const robots = () => {
      const s = st.sectors.find((x) => x.slug === $(d, "#cw-m-sector").value);
      const list = [[NOT_SURE, NOT_SURE_LABEL], ...((s && s.robots) || []).map((r) => [r.slug, r.name])];
      const keep = list.some((o) => o[0] === p.robotType) && $(d, "#cw-m-sector").value === (p.sector || NOT_SURE) ? p.robotType : NOT_SURE;
      $(d, "#cw-m-robot").innerHTML = options(list, keep);
    };
    robots();
    $(d, "#cw-m-sector").addEventListener("change", robots);
    if (!editable) return;
    const run = async (action, extra, after) => {
      $$(d, "[data-act]").forEach((b) => { b.disabled = true; });
      try {
        const r = await adapter.act(it.id, action, { rowVersion: it.rowVersion, ...extra });
        st.item = r.item;
        renderDetail();
        await renderList();
        if (after) say(after(r));
      } catch (e) {
        $$(d, "[data-act]").forEach((b) => { b.disabled = false; });
        await fail(e);
      }
    };
    $(d, '[data-act="save"]').addEventListener("click", () => run("save_draft", readForm(), () => notice("ok", esc(MESSAGES.draftSaved))));
    $(d, '[data-act="reset"]').addEventListener("click", () => run("reset", {}));
    $(d, '[data-act="send"]').addEventListener("click", () => run("send_request", readForm(), (r) => notice("ok", `Request sent to Admin. Status: <b>${esc(r.item.statusLabel)}</b>. It is still not public.`)));
    $(d, '[data-act="decline"]').addEventListener("click", async () => {
      const reason = await askReason({ title: "Decline Idea", label: "Reason for declining this idea (recorded in history)", confirmText: "Decline Idea" });
      if (reason) run("decline", { ...readForm(), reason });
    });
  }

  renderDetail();
  await renderList();
}
