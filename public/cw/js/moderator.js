// Contribution workflow: the Moderator's review of one idea, and the Moderator Workspace screen built from it. The review (reviewPanel)
// is ALSO the side drawer of Moderation's "Edit & approve" and "View" (public/cw/js/moderation.js), so both show the same thing:
// open (Submitted -> Under Moderator Review), edit the version for publishing, Save Draft, Reset to Original, Submit Publishing Request
// to Admin (= approve, as-is or edited), Decline Idea (a real dialog with a required reason). Moderators never publish. The server
// decides every step; this screen only shows what it says. An idea an Admin reopened shows the Admin's reason; the Earn (18+) path
// cannot be chosen for a minor's idea.
import { $, $$, checkedValues, esc, fmtDate, options, pills, wordDiff } from "./utils.js";
import { CATEGORIES, EARN, LEVELS, MESSAGES, MOD_FILTERS, NOT_SURE, NOT_SURE_LABEL, PATHS, STATUS } from "./lists.js";
import { canModeratorEdit, isModified } from "./rules.js";
import { RestAdapter } from "./api.js";
import { askReason } from "./dialog.js";
import { APPROVED } from "./portal-rules.js";
import { attachmentHtml, badge, decisionHtml, fieldsHtml, historyHtml, lastDecision, lastFeedback, notice, requestHtml } from "./review.js";

const INTRO = "Verify each idea. If it is good as it is, send it to Admin unchanged. If it needs improvement, edit it first, including category, suitable for and path. The original submission is always kept. Moderators cannot publish.";
export const REVIEW_LABELS = {
  save: "Save Draft", reset: "Reset to Original", send: "Submit Publishing Request to Admin", decline: "Decline Idea",
  hint: "If you made no changes, the original idea is sent to Admin as-is. None of these actions publish anything.",
};

/**
 * The review of ONE idea, drawn into `d`. ctx = { adapter, sectors, item, labels?, diff?, approve?, onChanged?(item, action, result) }.
 * `diff`: also show the changes to the title and description against the original while typing (Moderation's drawer).
 * `approve` (migration 030): the main button approves the idea (as-is or edited) instead of sending the publishing request at once; an
 * approved idea then offers "Send publish request to Admin" (and Back to draft, Reject).
 */
export function reviewPanel(d, ctx) {
  const adapter = ctx.adapter;
  const labels = { ...REVIEW_LABELS, ...(ctx.labels || {}) };
  const sectors = ctx.sectors || [];
  let it = ctx.item;
  const say = (html) => { const m = $(d, "[data-msg]"); if (m) m.innerHTML = html; };
  const fail = async (e) => {
    if (e && e.status === 409 && e.error === "STALE") {
      try { it = (await adapter.detail(it.id)).item; } catch { /* keep what we have */ }
      draw();
      say(notice("err", esc(MESSAGES.stale), "alert"));
      if (ctx.onChanged) await ctx.onChanged(it, "stale", null);
      return;
    }
    say(notice("err", esc((e && e.message) || MESSAGES.failed), "alert"));
  };
  const readForm = () => ({
    proposed: {
      title: $(d, "#cw-m-title").value, description: $(d, "#cw-m-desc").value, sector: $(d, "#cw-m-sector").value, robotType: $(d, "#cw-m-robot").value,
      categories: checkedValues(d, "cw-m-cat"), suitableFor: checkedValues(d, "cw-m-lvl"), learningPath: $(d, "#cw-m-path").value,
    },
    notes: $(d, "#cw-m-notes").value,
  });
  const diffHtml = () => {
    const t = $(d, "#cw-m-title"), x = $(d, "#cw-m-desc");
    const rows = [["Title", it.original.title, t ? t.value : it.proposed.title], ["Description", it.original.description, x ? x.value : it.proposed.description]];
    const changed = rows.filter((r) => r[1] !== r[2]);
    return changed.length ? changed.map(([k, a, b]) => `<div class="cw-field"><div class="cw-k">${k}</div><div class="cw-v cw-diff">${wordDiff(a, b)}</div></div>`).join("")
      : '<p class="cw-muted">No changes to the title or description: it is approved as the contributor sent it.</p>';
  };

  function draw() {
    const editable = canModeratorEdit(it.status), dis = editable ? "" : " disabled", ro = editable ? "" : " readonly";
    const approved = it.status === APPROVED;
    const fb = lastFeedback(it, "changes"), rej = lastDecision(it), latest = lastFeedback(it);
    const minor = it.contributor.minor === true;
    const p = it.proposed;
    const sectorOptions = [[NOT_SURE, NOT_SURE_LABEL], ...sectors.map((s) => [s.slug, s.name])];
    if (p.sector && !sectorOptions.some((o) => o[0] === p.sector)) sectorOptions.push([p.sector, p.sector]);
    d.innerHTML = `<article class="adm-card cw-detail" aria-labelledby="cw-d-h">
      <div class="cw-head"><h3 id="cw-d-h">${esc(it.code)} – ${esc(it.original.title)}</h3>${badge(it.status)}</div>
      <p class="cw-muted">Submitted by <b>${esc(it.contributor.name)}</b> (${esc(it.contributor.typeLabel)}) on ${esc(fmtDate(it.submittedAt))}${it.attachment ? ` · Attachment: ${attachmentHtml(it, adapter)}` : ""}</p>
      ${it.status === STATUS.CHANGES && fb ? notice("warn", `<b>Admin requested changes:</b> ${esc(fb.text)}<br><span class="cw-muted">${esc(fb.by)} · ${esc(fmtDate(fb.at))}</span>`) : ""}
      ${editable && latest && latest.type === "reopen" ? notice("warn", `<b>Reopened by Admin:</b> ${esc(latest.text)}<br><span class="cw-muted">${esc(latest.by)} · ${esc(fmtDate(latest.at))}</span>`) : ""}
      ${[STATUS.PENDING, STATUS.RESUBMITTED].includes(it.status) ? notice("info", "Publishing request is with Admin. You can't edit it until Admin responds.") : ""}
      ${approved ? notice("info", "Approved by a Moderator. It is not public: send the publishing request to an Admin, or take it back to the draft to change it.") : ""}
      ${it.status === STATUS.PUBLISHED ? notice("ok", `Published by Admin on ${esc(fmtDate(it.publishedAt))}.`) : ""}
      ${it.status === STATUS.UNPUBLISHED ? notice("info", "Unpublished by Admin: it is no longer on the public website.") : ""}
      ${it.status === STATUS.REJECTED ? notice("err", rej ? decisionHtml(rej) : "Rejected.") : ""}
      ${requestHtml(it)}
      <div class="cw-grid2">
        <div class="cw-box"><h4>Original submission (read-only)</h4>${fieldsHtml(it.original, sectors)}</div>
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
          <label for="cw-m-path">Suggested path</label><select id="cw-m-path"${dis}${minor ? ' aria-describedby="cw-m-path-hint"' : ""}>${options([["", "Not set"], ...PATHS], p.learningPath || "", { disabled: minor ? [EARN] : [] })}</select>
          ${minor ? `<p class="cw-muted cw-hint" id="cw-m-path-hint">${esc(MESSAGES.earnMinorHint)}</p>` : ""}
        </div>
      </div>
      ${ctx.diff ? `<div class="cw-box cw-livediff"><h4>Changes against the original</h4><div data-livediff aria-live="polite">${diffHtml()}</div></div>` : ""}
      <label for="cw-m-notes">Internal notes for Admin (never shown publicly)</label>
      <textarea id="cw-m-notes" rows="3" maxlength="2000" placeholder="What did you change and why? Or why it is good as-is."${ro}>${esc(it.notes)}</textarea>
      ${editable ? `<div class="cw-actions">
        <button type="button" class="btn${ctx.diff ? " primary" : ""}" data-act="${ctx.diff ? "send" : "save"}">${esc(ctx.diff ? labels.send : labels.save)}</button>
        <button type="button" class="btn" data-act="${ctx.diff ? "save" : "reset"}">${esc(ctx.diff ? labels.save : labels.reset)}</button>
        <button type="button" class="btn${ctx.diff ? "" : " primary"}" data-act="${ctx.diff ? "reset" : "send"}">${esc(ctx.diff ? labels.reset : labels.send)}</button>
        <button type="button" class="btn danger" data-act="decline">${esc(labels.decline)}</button>
      </div>
      <p class="cw-muted">${esc(labels.hint)}</p>` : ""}
      ${approved ? `<div class="cw-actions">
        <button type="button" class="btn primary" data-act="request">${esc(labels.request || "Send publish request to Admin")}</button>
        <button type="button" class="btn" data-act="redraft">Back to draft</button>
        <button type="button" class="btn danger" data-act="decline">${esc(labels.decline)}</button>
      </div>` : ""}
      <div data-msg aria-live="polite"></div>
      <h4 class="cw-h4">Activity history</h4>${historyHtml(it)}
    </article>`;
    const robots = () => {
      const s = sectors.find((x) => x.slug === $(d, "#cw-m-sector").value);
      const list = [[NOT_SURE, NOT_SURE_LABEL], ...((s && s.robots) || []).map((r) => [r.slug, r.name])];
      const keep = list.some((o) => o[0] === p.robotType) && $(d, "#cw-m-sector").value === (p.sector || NOT_SURE) ? p.robotType : NOT_SURE;
      $(d, "#cw-m-robot").innerHTML = options(list, keep);
    };
    robots();
    $(d, "#cw-m-sector").addEventListener("change", robots);
    if (ctx.diff) ["#cw-m-title", "#cw-m-desc"].forEach((sel) => $(d, sel).addEventListener("input", () => { $(d, "[data-livediff]").innerHTML = diffHtml(); }));
    if (!editable && !approved) return;
    const run = async (action, extra, after) => {
      $$(d, "[data-act]").forEach((b) => { b.disabled = true; });
      try {
        const r = await adapter.act(it.id, action, { rowVersion: it.rowVersion, ...extra });
        it = r.item;
        draw();
        if (after) say(after(r));
        if (ctx.onChanged) await ctx.onChanged(it, action, r);
      } catch (e) {
        $$(d, "[data-act]").forEach((b) => { b.disabled = false; });
        await fail(e);
      }
    };
    const declineBtn = $(d, '[data-act="decline"]');
    declineBtn.addEventListener("click", async () => {
      const reason = await askReason({ title: labels.decline, label: "Reason for declining this idea (recorded in history)", confirmText: labels.decline });
      if (reason) run("decline", approved ? { reason } : { ...readForm(), reason });
    });
    if (approved) {
      $(d, '[data-act="request"]').addEventListener("click", () => run("send_request", { proposed: it.proposed, notes: it.notes }, (r) => notice("ok", `Request sent to Admin. Status: <b>${esc(r.item.statusLabel)}</b>. It is still not public.`)));
      $(d, '[data-act="redraft"]').addEventListener("click", () => run("save_draft", { proposed: it.proposed, notes: it.notes }, () => notice("ok", "Back in the draft: the approval is undone.")));
      return;
    }
    $(d, '[data-act="save"]').addEventListener("click", () => run("save_draft", readForm(), () => notice("ok", esc(MESSAGES.draftSaved))));
    $(d, '[data-act="reset"]').addEventListener("click", () => run("reset", {}));
    $(d, '[data-act="send"]').addEventListener("click", () => (ctx.approve
      ? run("approve", readForm(), () => notice("ok", "Approved. It is not public: send the publishing request to an Admin when it is ready."))
      : run("send_request", readForm(), (r) => notice("ok", `Request sent to Admin. Status: <b>${esc(r.item.statusLabel)}</b>. It is still not public.`))));
  }

  draw();
  return { get item() { return it; }, redraw: draw };
}

/** The Moderator Workspace screen (kept for the old address; Moderation shows the same review in its drawer). */
export async function mount(el, opts = {}) {
  const adapter = opts.adapter || new RestAdapter(opts.base || "");
  const st = { filter: "Open", selected: null, item: null, sectors: [] };
  el.classList.add("rv-cw-root");
  el.innerHTML = `<section class="adm-card cw-intro" aria-labelledby="cw-mod-h"><h2 id="cw-mod-h">Moderator Workspace</h2><p class="cw-muted">${esc(INTRO)}</p><p class="cw-earlier" data-earlier hidden></p></section>
  <div class="cw-layout"><div class="cw-listcol"><div class="cw-filters" role="group" aria-label="Filter" data-filters></div><div data-list aria-live="polite"></div></div><div data-detail></div></div>`;
  try { st.sectors = (await adapter.formConfig()).sectors || []; } catch { st.sectors = []; }

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

  function renderDetail() {
    const d = $(el, "[data-detail]");
    if (!st.item) { d.innerHTML = '<div class="adm-card"><div class="cw-empty">Select a contribution to review.</div></div>'; return; }
    reviewPanel(d, { adapter, sectors: st.sectors, item: st.item, onChanged: async (item) => { st.item = item; await renderList(); } });
  }

  renderDetail();
  await renderList();
}
