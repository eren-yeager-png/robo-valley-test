// Contribution workflow: the Admin's review of one idea (adminPanel), and the Admin Approval Dashboard screen built from it (kept for
// the demo's parity checks; the admin portal shows the same review in Publish Requests' "Details" drawer, public/cw/js/requests.js).
// The Contributor and Moderator boxes, the request, original vs version to publish as a word diff, Moderator notes, Edit Before
// Publishing (title and description), the Publish Preview, Publish (enabled only after the CURRENT version was previewed; "Retry
// Publish" after a failure), Request Changes and Reject (dialogs with a required text), previous versions and history.
// After publishing (spec section 15, decided 27-11-2026): Unpublish (Published only; the card is removed), Edit Before Publishing on
// Published and Unpublished items (a new version that needs a new preview; the live card changes only when published again), and
// Reopen on Rejected items (reason required; back to Under Moderator Review), with who declined or rejected, why and when.
import { $, $$, esc, fmtDate, wordDiff } from "./utils.js";
import { ADM_FILTERS, FIELDS, FIELD_LABELS, MESSAGES, STATUS } from "./lists.js";
import { AFTER_PUBLISHING, canAdminAct, canPublishNext, earnBlocked, history as H, isModified, sameValue } from "./rules.js";
import { RestAdapter } from "./api.js";
import { askConfirm, askReason } from "./dialog.js";
import { openPreview } from "./preview.js";
import { attachmentHtml, badge, decisionHtml, decisionWho, fieldText, fieldsHtml, historyHtml, lastDecision, notice, requestHtml } from "./review.js";

const INTRO = "Review the original idea, the Moderator's changes, notes and history. Open the publish preview to see exactly how it will look on the website, then decide.";

/** The Admin's review of ONE idea, drawn into `d`. ctx = { adapter, sectors, item, onChanged?(item, action) }. */
export function adminPanel(d, ctx) {
  const adapter = ctx.adapter, sectors = ctx.sectors || [];
  const st = { item: ctx.item, editing: false, publishing: false };
  const say = (html) => { const m = $(d, "[data-msg]"); if (m) m.innerHTML = html; };
  const changed = async (action) => { if (ctx.onChanged) await ctx.onChanged(st.item, action); };
  const fail = async (e) => {
    if (e && e.status === 409 && e.error === "STALE") {
      try { st.item = (await adapter.detail(st.item.id)).item; } catch { /* keep what we have */ }
      draw(); say(notice("err", esc(MESSAGES.stale), "alert")); await changed("stale"); return;
    }
    say(notice("err", esc((e && e.message) || MESSAGES.failed), "alert"));
  };

  function draw() {
    const it = st.item;
    const n = it.versions.length, last = it.versions[n - 1];
    const status = st.publishing ? STATUS.PUBLISHING : it.status;
    const decidable = canAdminAct(status) && n > 0;                         // a request: Pending, Resubmitted or Publication Failed
    const after = AFTER_PUBLISHING.includes(status) && n > 0;               // Published or Unpublished
    const canPublish = n > 0 && canPublishNext(status, n, it.publishedVersion); // preview, then publish
    const previewOk = n > 0 && it.previewedVersion === n;
    const earn = earnBlocked(it.contributor.minor, it.proposed.learningPath);
    const sectorName = fieldText("sector", it.proposed.sector, it.proposed, sectors);
    const unpub = status === STATUS.UNPUBLISHED ? (it.history || []).filter((h) => h.text === H.unpublished()).slice(-1)[0] : null;
    const decision = status === STATUS.REJECTED ? lastDecision(it) : null;
    const retry = status === STATUS.FAILED || (status === STATUS.PUBLISHED && Boolean(it.publishError) && canPublish);
    const diff = FIELDS.map((f) => {
      const a = fieldText(f, it.original[f], it.original, sectors), b = fieldText(f, it.proposed[f], it.proposed, sectors);
      const ch = !sameValue(it.original[f], it.proposed[f]);
      return `<div class="cw-field"><div class="cw-k">${FIELD_LABELS[f]}${ch ? ' <span class="cw-tag">changed</span>' : ""}</div><div class="cw-v cw-diff">${wordDiff(a, b) || '<span class="cw-muted">Not set</span>'}</div></div>`;
    }).join("");
    d.innerHTML = `<article class="adm-card cw-detail" aria-labelledby="cw-a-h">
      <div class="cw-head"><h3 id="cw-a-h">${esc(it.code)} – ${esc(it.proposed.title)}</h3>${badge(status)}</div>
      <div class="cw-grid2 cw-boxes">
        <div class="cw-box"><h4>Contributor</h4>${esc(it.contributor.name)} · ${esc(it.contributor.typeLabel)}${it.contributor.minor ? ' <span class="cw-tag">Under 18</span>' : ""}<br><span class="cw-muted">Submitted ${esc(fmtDate(it.submittedAt))}</span>${it.attachment ? `<br>${attachmentHtml(it, adapter)}` : ""}</div>
        <div class="cw-box"><h4>Moderator</h4>${esc(it.moderator || "Not yet assigned")}${last ? `<br><span class="cw-muted">Request v${last.v} sent ${esc(fmtDate(last.at))}</span>` : ""}<br><span class="cw-tag">${isModified(it) ? "Edited by Moderator" : "Approved as-is"}</span></div>
      </div>
      ${status === STATUS.FAILED ? notice("err", `<b>Publication failed:</b> ${esc(it.publishError || "")}<br>Nothing was changed on the public website. You can safely retry; it will not create a duplicate.`) : ""}
      ${status === STATUS.PUBLISHED ? notice("ok", `<b>Published successfully</b> on ${esc(fmtDate(it.publishedAt))}${it.publishedVersion ? ` (version ${it.publishedVersion})` : ""}. Verified on the public website in the <b>${esc(sectorName)}</b> section.`) : ""}
      ${status === STATUS.PUBLISHED && it.publishError && canPublish ? notice("err", `<b>The last update failed:</b> ${esc(it.publishError)}<br>The public website still shows version ${esc(String(it.publishedVersion))}. You can safely retry; it will not create a duplicate.`) : ""}
      ${status === STATUS.PUBLISHED && canPublish ? notice("warn", `Version ${n} has changes that are not on the public website yet. Open the publish preview, then publish to update the live card.`) : ""}
      ${status === STATUS.UNPUBLISHED ? notice("info", `<b>Unpublished</b>${unpub ? ` on ${esc(fmtDate(unpub.at))} by ${esc(unpub.actor)}` : ""}. The card is no longer on the Community Ideas page. To publish it again: open the publish preview, then publish.`) : ""}
      ${decision ? notice("err", `${decisionHtml(decision)}<br><span class="cw-muted">Reopen sends it back to the Moderator (Under Moderator Review). The contributor can always share a new idea.</span>`) : ""}
      ${requestHtml(it)}
      <h4 class="cw-h4">Original vs. version to publish</h4>
      <div class="cw-grid2">
        <div class="cw-box"><h4>Original (from contributor)</h4>${fieldsHtml(it.original, sectors)}</div>
        <div class="cw-box"><h4>Changes highlighted</h4>${diff}</div>
      </div>
      <p><b>Moderator notes:</b> ${it.notes ? esc(it.notes) : '<span class="cw-muted">No notes.</span>'}</p>
      ${st.editing && (decidable || after) ? `<div class="cw-box cw-edit"><h4>Admin edit (Moderator's version is kept in history)</h4>
          ${after ? `<p class="cw-muted">This makes a new version. The public card changes only when you open the preview and publish again.</p>` : ""}
          <label for="cw-a-title">Title</label><input id="cw-a-title" maxlength="150" value="${esc(it.proposed.title)}">
          <label for="cw-a-desc">Description</label><textarea id="cw-a-desc" rows="5" maxlength="3000">${esc(it.proposed.description)}</textarea>
          <div class="cw-actions"><button type="button" class="btn primary" data-act="save-edit">Save Admin Edit</button><button type="button" class="btn" data-act="cancel-edit">Cancel</button></div></div>` : ""}
      ${canPublish && earn ? notice("err", esc(MESSAGES.earnMinorPublish), "alert") : ""}
      ${canPublish ? notice(previewOk ? "ok" : "warn", esc(previewOk ? MESSAGES.previewDone : MESSAGES.previewNotice)) : ""}
      ${canPublish || decidable || after || status === STATUS.REJECTED ? `<div class="cw-actions">
          ${canPublish ? `<button type="button" class="btn" data-act="preview">👁 Open Publish Preview</button>
          <button type="button" class="btn success" data-act="publish"${previewOk && !earn ? "" : " disabled"}>${retry ? "Retry Publish" : "Publish to Website"}</button>` : ""}
          ${decidable || after ? `<button type="button" class="btn" data-act="edit">Edit Before Publishing</button>` : ""}
          ${decidable ? `<button type="button" class="btn warn" data-act="changes">Request Changes</button>
          <button type="button" class="btn danger" data-act="reject">Reject</button>` : ""}
          ${status === STATUS.PUBLISHED ? `<button type="button" class="btn danger" data-act="unpublish">Unpublish</button>` : ""}
          ${status === STATUS.REJECTED ? `<button type="button" class="btn primary" data-act="reopen">Reopen</button>` : ""}
        </div>` : ""}
      ${status === STATUS.PUBLISHING ? notice("info", `<span class="cw-spin" aria-hidden="true"></span>⏳ Publishing to the website and refreshing the page… Status will change only after the website confirms.`) : ""}
      ${!decidable && ![STATUS.PUBLISHING, STATUS.PUBLISHED, STATUS.REJECTED, STATUS.UNPUBLISHED].includes(status) ? notice("info", "This contribution is still with the Moderator. No publishing request yet.") : ""}
      <div data-msg aria-live="polite"></div>
      ${n > 1 ? `<h4 class="cw-h4">Previous versions</h4>${it.versions.slice(0, -1).reverse().map((v) => `<div class="cw-history"><b>v${v.v}</b> by ${esc(v.by)} (${esc(v.role)}) · <span class="cw-when">${esc(fmtDate(v.at))}</span><br>${esc(v.data.title)}</div>`).join("")}` : ""}
      <h4 class="cw-h4">Activity history</h4>${historyHtml(it)}
    </article>`;
    const run = async (action, extra, after2) => {
      $$(d, "[data-act]").forEach((b) => { b.disabled = true; });
      try {
        const r = await adapter.act(it.id, action, { rowVersion: it.rowVersion, ...extra });
        st.item = r.item; st.editing = false;
        draw();
        if (after2) say(after2(r));
        await changed(action);
        return r;
      } catch (e) { draw(); await fail(e); return null; }
    };
    const on = (sel, fn) => { const b = $(d, sel); if (b) b.addEventListener("click", fn); };
    on('[data-act="preview"]', async () => {
      const r = await run("preview", { version: n });
      if (r && r.record) {
        await openPreview(r.record, { meta: `${it.code} · version ${n} · ${r.record.sectorName} section` });
        draw();
      }
    });
    on('[data-act="publish"]', async () => {
      st.publishing = true; draw();
      try {
        const r = await adapter.publish(it.id, { rowVersion: it.rowVersion });
        st.item = r.item;
      } catch (e) { st.publishing = false; draw(); await fail(e); await changed("publish_failed"); return; }
      st.publishing = false; draw(); await changed("publish");
    });
    on('[data-act="edit"]', () => { st.editing = true; draw(); const t = $(d, "#cw-a-title"); if (t) t.focus(); });
    on('[data-act="save-edit"]', () => run("admin_edit", { title: $(d, "#cw-a-title").value, description: $(d, "#cw-a-desc").value }));
    on('[data-act="cancel-edit"]', () => { st.editing = false; draw(); });
    on('[data-act="changes"]', async () => {
      const text = await askReason({ title: "Request Changes", label: "What should the Moderator change? (required)", confirmText: "Request Changes", tone: "primary" });
      if (text) run("request_changes", { feedback: text });
    });
    on('[data-act="reject"]', async () => {
      const text = await askReason({ title: "Reject", label: "Reason for rejection (required)", confirmText: "Reject" });
      if (text) run("reject", { reason: text });
    });
    on('[data-act="unpublish"]', async () => {
      if (await askConfirm({ title: `Unpublish ${it.code}?`, text: MESSAGES.unpublishText, confirmText: "Unpublish" })) run("unpublish", {}, () => notice("ok", esc(MESSAGES.unpublished)));
    });
    on('[data-act="reopen"]', async () => {
      const text = await askReason({ title: `Reopen ${it.code}`, label: MESSAGES.reopenLabel, confirmText: "Reopen", tone: "primary" });
      if (text) run("reopen", { reason: text }, () => notice("ok", "Reopened. It is back with the Moderator (Under Moderator Review)."));
    });
  }

  draw();
  return { get item() { return st.item; }, redraw: draw };
}

/** The Admin Approval Dashboard screen (the demo's parity build; the admin portal uses Publish Requests). */
export async function mount(el, opts = {}) {
  const adapter = opts.adapter || new RestAdapter(opts.base || "");
  const st = { filter: "Awaiting me", selected: null, item: null, sectors: [] };
  el.classList.add("rv-cw-root");
  const demo = opts.demoFailToggle ? `<label class="cw-demo-toggle"><input type="checkbox" data-demo-fail> Demo only: make the next publish attempt fail (to test error handling and safe retry)</label>` : "";
  el.innerHTML = `<section class="adm-card cw-intro" aria-labelledby="cw-adm-h"><h2 id="cw-adm-h">Admin Approval Dashboard</h2><p class="cw-muted">${esc(INTRO)}</p>${demo}</section>
  <div class="cw-layout"><div class="cw-listcol"><div class="cw-filters" role="group" aria-label="Filter" data-filters></div><div data-list aria-live="polite"></div></div><div data-detail></div></div>`;
  if (opts.demoFailToggle) $(el, "[data-demo-fail]").addEventListener("change", (e) => { opts.demoFailToggle.failNext = e.target.checked; });
  try { st.sectors = (await adapter.formConfig()).sectors || []; } catch { st.sectors = []; }

  async function renderList() {
    let r;
    try { r = await adapter.list("approvals", st.filter); } catch (e) { $(el, "[data-list]").innerHTML = notice("err", esc(e.status === 503 ? "The contribution workflow is not set up yet." : (e.message || MESSAGES.failed)), "alert"); return; }
    $(el, "[data-filters]").innerHTML = Object.keys(ADM_FILTERS).map((k) =>
      `<button type="button" class="cw-chip${k === st.filter ? " on" : ""}" aria-pressed="${k === st.filter}" data-filter="${esc(k)}">${esc(k)}${k === "Awaiting me" ? ` <span class="cw-count">${r.counts.awaiting}</span>` : ""}</button>`).join("");
    $$(el, "[data-filter]").forEach((b) => b.addEventListener("click", () => { st.filter = b.getAttribute("data-filter"); renderList(); }));
    $(el, "[data-list]").innerHTML = r.items.length ? r.items.map((i) => `<button type="button" class="cw-item${i.id === st.selected ? " sel" : ""}" data-id="${i.id}" aria-current="${i.id === st.selected}">
      ${badge(i.status)} <span class="cw-muted">${esc(i.code)}</span>
      <span class="cw-t">${esc(i.title)}</span>
      <span class="cw-muted cw-meta">${esc(i.kind)} · ${esc(i.contributorName)} · ${esc(i.sectorName)}${i.moderator ? " · by " + esc(i.moderator) : ""}</span>
      ${i.decision ? `<span class="cw-muted cw-meta cw-decision">${esc(decisionWho(i.decision))} · ${esc(fmtDate(i.decision.at))}</span>` : ""}</button>`).join("")
      : '<div class="cw-empty">Nothing here.</div>';
    $$(el, "[data-id]").forEach((b) => b.addEventListener("click", () => load(Number(b.getAttribute("data-id")))));
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
    const d = $(el, "[data-detail]");
    if (!st.item) { d.innerHTML = '<div class="adm-card"><div class="cw-empty">Select a contribution to review.</div></div>'; return; }
    adminPanel(d, { adapter, sectors: st.sectors, item: st.item, onChanged: async (item) => { st.item = item; await renderList(); } });
  }

  renderDetail();
  await renderList();
}
