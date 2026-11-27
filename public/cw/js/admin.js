// Contribution workflow: the Admin Approval Dashboard (admin portal, /admin/approvals; and the demo). The demo's screen, through the
// adapter: filters, the Contributor and Moderator boxes, the request, original vs version to publish as a word diff, Moderator notes,
// Edit Before Publishing (title and description), the Publish Preview, Publish (enabled only after the CURRENT version was previewed;
// "Retry Publish" after a failure), Request Changes and Reject (dialogs with a required text), previous versions and history.
import { $, $$, esc, fmtDate, wordDiff } from "./utils.js";
import { ADM_FILTERS, FIELDS, FIELD_LABELS, MESSAGES, STATUS } from "./lists.js";
import { canAdminAct, isModified, sameValue } from "./rules.js";
import { RestAdapter } from "./api.js";
import { askReason } from "./dialog.js";
import { openPreview } from "./preview.js";
import { attachmentHtml, badge, fieldText, fieldsHtml, historyHtml, notice, requestHtml } from "./review.js";

const INTRO = "Review the original idea, the Moderator's changes, notes and history. Open the publish preview to see exactly how it will look on the website, then decide.";

export async function mount(el, opts = {}) {
  const adapter = opts.adapter || new RestAdapter(opts.base || "");
  const st = { filter: "Awaiting me", selected: null, item: null, sectors: [], editing: false, publishing: false };
  el.classList.add("rv-cw-root");
  const demo = opts.demoFailToggle ? `<label class="cw-demo-toggle"><input type="checkbox" data-demo-fail> Demo only: make the next publish attempt fail (to test error handling and safe retry)</label>` : "";
  el.innerHTML = `<section class="adm-card cw-intro" aria-labelledby="cw-adm-h"><h2 id="cw-adm-h">Admin Approval Dashboard</h2><p class="cw-muted">${esc(INTRO)}</p>${demo}</section>
  <div class="cw-layout"><div class="cw-listcol"><div class="cw-filters" role="group" aria-label="Filter" data-filters></div><div data-list aria-live="polite"></div></div><div data-detail></div></div>`;
  if (opts.demoFailToggle) $(el, "[data-demo-fail]").addEventListener("change", (e) => { opts.demoFailToggle.failNext = e.target.checked; });
  try { st.sectors = (await adapter.formConfig()).sectors || []; } catch { st.sectors = []; }

  const say = (html) => { const m = $(el, "[data-msg]"); if (m) m.innerHTML = html; };
  const fail = async (e) => {
    if (e && e.status === 409 && e.error === "STALE") { await load(st.selected); say(notice("err", esc(MESSAGES.stale), "alert")); return; }
    say(notice("err", esc((e && e.message) || MESSAGES.failed), "alert"));
  };

  async function renderList() {
    let r;
    try { r = await adapter.list("approvals", st.filter); } catch (e) { $(el, "[data-list]").innerHTML = notice("err", esc(e.status === 503 ? "The contribution workflow is not set up yet." : (e.message || MESSAGES.failed)), "alert"); return; }
    $(el, "[data-filters]").innerHTML = Object.keys(ADM_FILTERS).map((k) =>
      `<button type="button" class="cw-chip${k === st.filter ? " on" : ""}" aria-pressed="${k === st.filter}" data-filter="${esc(k)}">${esc(k)}${k === "Awaiting me" ? ` <span class="cw-count">${r.counts.awaiting}</span>` : ""}</button>`).join("");
    $$(el, "[data-filter]").forEach((b) => b.addEventListener("click", () => { st.filter = b.getAttribute("data-filter"); renderList(); }));
    $(el, "[data-list]").innerHTML = r.items.length ? r.items.map((i) => `<button type="button" class="cw-item${i.id === st.selected ? " sel" : ""}" data-id="${i.id}" aria-current="${i.id === st.selected}">
      ${badge(i.status)} <span class="cw-muted">${esc(i.code)}</span>
      <span class="cw-t">${esc(i.title)}</span>
      <span class="cw-muted cw-meta">${esc(i.kind)} · ${esc(i.contributorName)} · ${esc(i.sectorName)}${i.moderator ? " · by " + esc(i.moderator) : ""}</span></button>`).join("")
      : '<div class="cw-empty">Nothing here.</div>';
    $$(el, "[data-id]").forEach((b) => b.addEventListener("click", () => { st.editing = false; load(Number(b.getAttribute("data-id"))); }));
    if (opts.onChange) opts.onChange(r.counts);
  }

  async function load(id) {
    if (!id) return;
    st.selected = id;
    try { st.item = (await adapter.detail(id)).item; } catch (e) { $(el, "[data-detail]").innerHTML = notice("err", esc((e && e.message) || MESSAGES.failed), "alert"); return; }
    renderDetail();
    await renderList();
  }

  function renderDetail() {
    const it = st.item, d = $(el, "[data-detail]");
    if (!it) { d.innerHTML = '<div class="adm-card"><div class="cw-empty">Select a contribution to review.</div></div>'; return; }
    const n = it.versions.length, last = it.versions[n - 1];
    const status = st.publishing ? STATUS.PUBLISHING : it.status;
    const decidable = canAdminAct(status) && n > 0;
    const previewOk = n > 0 && it.previewedVersion === n;
    const diff = FIELDS.map((f) => {
      const a = fieldText(f, it.original[f], it.original, st.sectors), b = fieldText(f, it.proposed[f], it.proposed, st.sectors);
      const changed = !sameValue(it.original[f], it.proposed[f]);
      return `<div class="cw-field"><div class="cw-k">${FIELD_LABELS[f]}${changed ? ' <span class="cw-tag">changed</span>' : ""}</div><div class="cw-v cw-diff">${wordDiff(a, b) || '<span class="cw-muted">Not set</span>'}</div></div>`;
    }).join("");
    d.innerHTML = `<article class="adm-card cw-detail" aria-labelledby="cw-a-h">
      <div class="cw-head"><h3 id="cw-a-h">${esc(it.code)} – ${esc(it.proposed.title)}</h3>${badge(status)}</div>
      <div class="cw-grid2 cw-boxes">
        <div class="cw-box"><h4>Contributor</h4>${esc(it.contributor.name)} · ${esc(it.contributor.typeLabel)}<br><span class="cw-muted">Submitted ${esc(fmtDate(it.submittedAt))}</span>${it.attachment ? `<br>${attachmentHtml(it, adapter)}` : ""}</div>
        <div class="cw-box"><h4>Moderator</h4>${esc(it.moderator || "Not yet assigned")}${last ? `<br><span class="cw-muted">Request v${last.v} sent ${esc(fmtDate(last.at))}</span>` : ""}<br><span class="cw-tag">${isModified(it) ? "Edited by Moderator" : "Approved as-is"}</span></div>
      </div>
      ${status === STATUS.FAILED ? notice("err", `<b>Publication failed:</b> ${esc(it.publishError || "")}<br>Nothing was changed on the public website. You can safely retry; it will not create a duplicate.`) : ""}
      ${status === STATUS.PUBLISHED ? notice("ok", `<b>Published successfully</b> on ${esc(fmtDate(it.publishedAt))}. Verified on the public website in the <b>${esc(fieldText("sector", it.proposed.sector, it.proposed, st.sectors))}</b> section.`) : ""}
      ${requestHtml(it)}
      <h4 class="cw-h4">Original vs. version to publish</h4>
      <div class="cw-grid2">
        <div class="cw-box"><h4>Original (from contributor)</h4>${fieldsHtml(it.original, st.sectors)}</div>
        <div class="cw-box"><h4>Changes highlighted</h4>${diff}</div>
      </div>
      <p><b>Moderator notes:</b> ${it.notes ? esc(it.notes) : '<span class="cw-muted">No notes.</span>'}</p>
      ${st.editing && decidable ? `<div class="cw-box cw-edit"><h4>Admin edit (Moderator's version is kept in history)</h4>
          <label for="cw-a-title">Title</label><input id="cw-a-title" maxlength="150" value="${esc(it.proposed.title)}">
          <label for="cw-a-desc">Description</label><textarea id="cw-a-desc" rows="5" maxlength="3000">${esc(it.proposed.description)}</textarea>
          <div class="cw-actions"><button type="button" class="btn primary" data-act="save-edit">Save Admin Edit</button><button type="button" class="btn" data-act="cancel-edit">Cancel</button></div></div>` : ""}
      ${decidable ? `${notice(previewOk ? "ok" : "warn", esc(previewOk ? MESSAGES.previewDone : MESSAGES.previewNotice))}
        <div class="cw-actions">
          <button type="button" class="btn" data-act="preview">👁 Open Publish Preview</button>
          <button type="button" class="btn success" data-act="publish"${previewOk ? "" : " disabled"}>${status === STATUS.FAILED ? "Retry Publish" : "Publish to Website"}</button>
          <button type="button" class="btn" data-act="edit">Edit Before Publishing</button>
          <button type="button" class="btn warn" data-act="changes">Request Changes</button>
          <button type="button" class="btn danger" data-act="reject">Reject</button>
        </div>` : ""}
      ${status === STATUS.PUBLISHING ? notice("info", `<span class="cw-spin" aria-hidden="true"></span>⏳ Publishing to the website and refreshing the page… Status will change only after the website confirms.`) : ""}
      ${!decidable && ![STATUS.PUBLISHING, STATUS.PUBLISHED, STATUS.REJECTED].includes(status) ? notice("info", "This contribution is still with the Moderator. No publishing request yet.") : ""}
      <div data-msg aria-live="polite"></div>
      ${n > 1 ? `<h4 class="cw-h4">Previous versions</h4>${it.versions.slice(0, -1).reverse().map((v) => `<div class="cw-history"><b>v${v.v}</b> by ${esc(v.by)} (${esc(v.role)}) · <span class="cw-when">${esc(fmtDate(v.at))}</span><br>${esc(v.data.title)}</div>`).join("")}` : ""}
      <h4 class="cw-h4">Activity history</h4>${historyHtml(it)}
    </article>`;
    if (!decidable) return;
    const run = async (action, extra) => {
      $$(d, "[data-act]").forEach((b) => { b.disabled = true; });
      try {
        const r = await adapter.act(it.id, action, { rowVersion: it.rowVersion, ...extra });
        st.item = r.item; st.editing = false;
        renderDetail(); await renderList();
        return r;
      } catch (e) { renderDetail(); await fail(e); return null; }
    };
    $(d, '[data-act="preview"]').addEventListener("click", async () => {
      const r = await run("preview", { version: n });
      if (r && r.record) {
        await openPreview(r.record, { meta: `${it.code} · version ${n} · ${r.record.sectorName} section` });
        renderDetail();
      }
    });
    $(d, '[data-act="publish"]').addEventListener("click", async () => {
      st.publishing = true; renderDetail();
      try {
        const r = await adapter.publish(it.id, { rowVersion: it.rowVersion });
        st.item = r.item;
      } catch (e) { st.publishing = false; renderDetail(); await fail(e); await renderList(); return; }
      st.publishing = false; renderDetail(); await renderList();
    });
    $(d, '[data-act="edit"]').addEventListener("click", () => { st.editing = true; renderDetail(); const t = $(d, "#cw-a-title"); if (t) t.focus(); });
    const save = $(d, '[data-act="save-edit"]');
    if (save) {
      save.addEventListener("click", () => run("admin_edit", { title: $(d, "#cw-a-title").value, description: $(d, "#cw-a-desc").value }));
      $(d, '[data-act="cancel-edit"]').addEventListener("click", () => { st.editing = false; renderDetail(); });
    }
    $(d, '[data-act="changes"]').addEventListener("click", async () => {
      const text = await askReason({ title: "Request Changes", label: "What should the Moderator change? (required)", confirmText: "Request Changes", tone: "primary" });
      if (text) run("request_changes", { feedback: text });
    });
    $(d, '[data-act="reject"]').addEventListener("click", async () => {
      const text = await askReason({ title: "Reject", label: "Reason for rejection (required)", confirmText: "Reject" });
      if (text) run("reject", { reason: text });
    });
  }

  renderDetail();
  await renderList();
}
