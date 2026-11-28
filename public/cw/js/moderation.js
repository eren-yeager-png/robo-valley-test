// Contribution Portal: Moderation (Moderators and Admins; the app's /admin/moderation and the demo). The Moderator Workspace is
// merged in: ONE page, top to bottom: the header, the sector grid (each card shows how many wait for review), and the selected sector's
// panel "Contributors for <Sector>" with status tabs and counts (All | Pending review | Approved | Rejected | Published) and one table
// for BOTH kinds of contributions: Title | Contributor | Status | Sent | Actions.
//   Share Your Idea, pending review: [Approve as-is] [Edit & approve] (side drawer: title, description and the rest, with the changes
//     against the original) [Reject] (a reason is required). Approving sends the publishing request to an Admin; a Moderator never
//     publishes. Other rows: [View] (the same review, read-only).
//   Current form, pending review: [Approve as-is] (marks it verified, so it waits for an Admin) [Reject] (reason required)
//     [View form]. These items are only ever edited by their contributor, so there is no Edit.
// Below the table: the sector's fields from Sector Forms, read-only. The server decides every step; this screen only shows it.
import { esc } from "./utils.js";
import { askReason } from "./dialog.js";
import { contributeHref, headerButtonHtml } from "./sector.js";
import { bindSectorGrid, plural, sectorGridHtml } from "./sector-grid.js";
import { bindTabs, fmtSent, matches, noticeHtml, openDrawer, pageHeader, panelHtml, sentHtml, slugHtml, sourceBadge, statusBadge, tableHtml, tabsHtml, toast } from "./portal-ui.js";
import { MODERATION_TABS, inTab, tabCounts } from "./portal-status.js";
import { reviewPanel } from "./moderator.js";
import { PortalRest } from "./portal-api.js";

export const TITLE = "Moderation";
export const DESC = "Review contributions sent by members, by sector and status.";
export const PANEL_SUB = "Contributions sent with the current form, by status.";
export const EMPTY = "No contributions in this sector yet";
export const PAGE_SIZE = 20;
export const DRAWER_LABELS = {
  send: "Approve and send to Admin", save: "Save draft", reset: "Reset to original", decline: "Reject",
  hint: "Approving sends this version to an Admin, who previews it and publishes it. Moderators never publish.",
};
const SOURCE = { workflow: "Share Your Idea", form: "Current form" };

export async function mount(el, opts = {}) {
  const adapter = opts.adapter || new PortalRest(opts.base || "");
  const form = opts.form || "/contribute-now/";
  const here = () => opts.returnTo || (typeof location !== "undefined" ? location.href : "");
  const st = { sector: opts.sector || "", tab: MODERATION_TABS.some((t) => t[0] === opts.tab) ? opts.tab : "all", q: "", sort: "new", cat: "", page: 1, data: null, sectors: [] };
  el.classList.add("rv-cw-root", "rv-pp");
  try { st.sectors = (await adapter.formConfig()).sectors || []; } catch { st.sectors = []; }

  async function load() {
    try {
      st.data = await adapter.portal("moderation", { sector: st.sector });
    } catch (e) {
      el.innerHTML = pageHeader({ title: TITLE, desc: DESC, id: "rv-mod-h" })
        + noticeHtml("err", esc(e && e.status === 503 ? "Reviewing is not set up on this database yet." : (e && e.message) || "The contributions could not be loaded. Please try again."));
      return false;
    }
    if (st.data.sector) st.sector = st.data.sector.slug; // with no sector asked for, the server opens the one with the most waiting
    return true;
  }

  const rowsOf = () => (st.data && st.data.rows) || [];
  function shown() {
    const rows = rowsOf().filter((r) => inTab(MODERATION_TABS, st.tab, r.display) && matches(st.q, r.title, r.contributor, r.code) && (!st.cat || (r.categories || []).includes(st.cat)));
    return rows.sort((a, b) => (st.sort === "old" ? 1 : -1) * String(a.sentAt || "").localeCompare(String(b.sentAt || "")));
  }

  function actionsHtml(r) {
    const b = (act, label, cls = "") => `<button type="button" class="btn small${cls ? " " + cls : ""}" data-act="${act}" data-key="${esc(r.key)}" aria-label="${esc(`${label}: ${r.title}`)}">${esc(label)}</button>`;
    const a = r.actions || [];
    const out = [];
    if (a.includes("approve")) out.push(b("approve", "Approve as-is", "primary"));
    if (a.includes("edit")) out.push(b("edit", "Edit & approve"));
    if (a.includes("reject")) out.push(b("reject", "Reject", "danger"));
    if (a.includes("send")) out.push(b("send", "Send publish request to Admin", "primary"));
    if (r.source === "workflow" && !a.includes("edit")) out.push(b("view", "View"));
    if (r.source === "form" && r.viewUrl) out.push(`<a class="btn small" href="${esc(r.viewUrl)}" aria-label="${esc(`View form: ${r.title}`)}">View form</a>`);
    return out.join("");
  }
  const rowHtml = (r) => `<tr data-row="${esc(r.key)}">
    <td class="rv-pp-col-title"><b>${esc(r.title)}</b><span class="rv-pp-sub">${esc(r.code)} · ${esc(SOURCE[r.source] || "")}${r.alsoIn && r.alsoIn.length ? ` · Also in: ${esc(r.alsoIn.join(", "))}` : ""}</span></td>
    <td>${esc(r.contributor)}${r.contributorType ? `<span class="rv-pp-sub">${esc(r.contributorType)}</span>` : ""}</td>
    <td>${statusBadge(r.display, r.decision ? `${r.decision.label}${r.decision.at ? ` · ${fmtSent(r.decision.at)}` : ""}` : r.note)}</td>
    <td class="rv-pp-col-sent">${sentHtml(r.sentAt)}</td>
    <td class="rv-pp-col-actions"><div class="rv-pp-rowact">${actionsHtml(r)}</div></td></tr>`;

  function listHtml() {
    const rows = shown();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    st.page = Math.min(Math.max(1, st.page), pages);
    const slice = rows.slice((st.page - 1) * PAGE_SIZE, st.page * PAGE_SIZE);
    const total = rowsOf().length;
    return `${tableHtml({ caption: `Contributions in ${st.data.sector.name}`, head: [["Title", "rv-pp-col-title"], ["Contributor"], ["Status"], ["Sent", "rv-pp-col-sent"], ["", "rv-pp-col-actions"]], rows: slice.map(rowHtml), empty: total ? "Nothing matches these filters." : EMPTY })}
      ${pages > 1 ? `<nav class="rv-pp-pager" aria-label="Pages"><button type="button" class="btn small" data-page="${st.page - 1}"${st.page <= 1 ? " disabled" : ""}>← Previous</button>
        <span>Page ${st.page} of ${pages} · ${rows.length} contributions</span><button type="button" class="btn small" data-page="${st.page + 1}"${st.page >= pages ? " disabled" : ""}>Next →</button></nav>` : ""}`;
  }

  function render() {
    const d = st.data, s = d.sector;
    const cards = d.sectors.map((x) => ({
      slug: x.slug, name: x.name, meta: `${plural(x.total, "contribution")} · ${x.pending} pending`,
      count: x.pending || undefined, countLabel: `${x.pending} waiting for review`, countTone: "amber",
    }));
    const counts = tabCounts(MODERATION_TABS, rowsOf());
    const cats = Array.from(new Set(rowsOf().flatMap((r) => r.categories || []))).sort();
    const actions = s ? `${headerButtonHtml(contributeHref(form, { sector: s.slug, returnTo: here() }))}${d.exportUrl ? `<a class="btn" href="${esc(d.exportUrl)}" download>Export CSV</a>` : ""}` : "";
    const fields = (d.fields || []);
    const body = s ? `${tabsHtml(MODERATION_TABS.map(([k, l]) => [k, l, counts[k], k === "pending" && counts[k] ? "amber" : ""]), st.tab, { label: "Status", controls: "rv-mod-list" })}
      <form class="rv-pp-filters" role="search" aria-label="Filter contributions" data-filters>
        <label>Search title or contributor<input type="search" data-f="q" value="${esc(st.q)}" maxlength="100" placeholder="Search…"></label>
        ${cats.length ? `<label>Directory category<select data-f="cat"><option value="">All categories</option>${cats.map((c) => `<option value="${esc(c)}"${c === st.cat ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></label>` : ""}
        <label>Sort<select data-f="sort"><option value="new"${st.sort === "new" ? " selected" : ""}>Newest first</option><option value="old"${st.sort === "old" ? " selected" : ""}>Oldest first</option></select></label>
      </form>
      <div id="rv-mod-list" role="tabpanel" aria-labelledby="rv-pp-tab-${esc(st.tab)}" data-list>${listHtml()}</div>
      ${fields.length ? `<details class="rv-pp-fieldsro"><summary>Fields in ${esc(s.name)} (read-only, from Sector Forms)</summary><ul class="rv-pp-fieldlist">${fields.map((f) => `<li><span class="rv-pp-fieldname"><b>${esc(f.name)}</b>${slugHtml(f.slug)}</span>${sourceBadge(f.source, f.pluginName)}${f.active ? "" : ' <span class="rv-pp-tag">Hidden</span>'}</li>`).join("")}</ul></details>` : ""}
      <div data-msg aria-live="polite"></div>` : "";
    el.innerHTML = `${pageHeader({ title: TITLE, desc: DESC, id: "rv-mod-h" })}
      ${d.sectors.length ? sectorGridHtml({ sectors: cards, selected: st.sector, label: "Sectors" }) : noticeHtml("info", "No sectors yet.")}
      ${s ? panelHtml({ heading: `Contributors for ${s.name}`, sub: PANEL_SUB, id: "rv-mod-panel-h", actions, body }) : ""}`;
    bindSectorGrid(el, pick);
    bindTabs(el, (k, keyboard) => { st.tab = k; st.page = 1; render(); if (keyboard) { const t = el.querySelector(`[data-tab="${k}"]`); if (t) t.focus(); } });
    bindList();
    const f = el.querySelector("[data-filters]");
    if (f) {
      f.addEventListener("submit", (e) => e.preventDefault());
      f.querySelectorAll("[data-f]").forEach((x) => x.addEventListener(x.tagName === "INPUT" ? "input" : "change", () => {
        st[x.getAttribute("data-f")] = x.value; st.page = 1;
        el.querySelector("[data-list]").innerHTML = listHtml();
        bindList();
      }));
    }
  }

  function bindList() {
    el.querySelectorAll("[data-page]").forEach((b) => b.addEventListener("click", () => { st.page = Number(b.getAttribute("data-page")); el.querySelector("[data-list]").innerHTML = listHtml(); bindList(); }));
    el.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => act(b.getAttribute("data-act"), b.getAttribute("data-key"), b)));
  }

  async function pick(slug) {
    if (!slug || slug === st.sector) return;
    st.sector = slug; st.tab = "all"; st.q = ""; st.cat = ""; st.page = 1;
    if (opts.onSector) opts.onSector(slug);
    else if (typeof history !== "undefined" && opts.basePath) history.replaceState(null, "", `${opts.basePath}?sector=${encodeURIComponent(slug)}`);
    if (await load()) { render(); const c = el.querySelector(`.rv-sg [data-sector="${slug}"]`); if (c) c.focus(); }
  }
  const say = (html) => { const m = el.querySelector("[data-msg]"); if (m) m.innerHTML = html; };
  async function refresh() { if (await load()) render(); }

  // ---- the actions
  async function act(what, key, btn) {
    const r = rowsOf().find((x) => x.key === key);
    if (!r) return;
    const busy = (on) => { if (btn && btn.isConnected) btn.disabled = on; };
    try {
      if (r.source === "form") {
        if (what === "approve") {
          busy(true);
          await adapter.formDecision(r.id, "verify", "");
          toast(el, `Approved: "${r.title}" now waits for an Admin to publish it.`);
          return refresh();
        }
        if (what === "reject") {
          const reason = await askReason({ title: "Reject", label: `Why is "${r.title}" not accepted? The contributor sees this reason.`, confirmText: "Reject" });
          if (!reason) return;
          busy(true);
          await adapter.formDecision(r.id, "reject", reason);
          toast(el, `Rejected: "${r.title}".`);
          return refresh();
        }
        return;
      }
      if (what === "approve") {
        busy(true);
        const it = (await adapter.detail(r.id)).item;
        try {
          await adapter.act(r.id, "send_request", { rowVersion: it.rowVersion, proposed: it.proposed, notes: it.notes });
        } catch (e) {
          if (e && e.status === 400) { busy(false); return openReview(r, e.message); } // e.g. a category is needed first: open the editor with the reason
          throw e;
        }
        toast(el, `Approved and sent to an Admin: "${r.title}". It is not public yet.`);
        return refresh();
      }
      if (what === "reject") {
        const reason = await askReason({ title: "Reject", label: `Reason for rejecting "${r.title}" (recorded in history)`, confirmText: "Reject" });
        if (!reason) return;
        busy(true);
        const it = (await adapter.detail(r.id)).item;
        await adapter.act(r.id, "decline", { rowVersion: it.rowVersion, reason });
        toast(el, `Rejected: "${r.title}".`);
        return refresh();
      }
      if (what === "edit" || what === "view") return openReview(r);
    } catch (e) {
      busy(false);
      say(noticeHtml("err", esc((e && e.message) || "That did not work. Nothing was changed. Please try again.")));
      if (e && e.status === 409) await refresh();
    }
  }

  async function openReview(r, problem = "") {
    const editing = (r.actions || []).includes("edit");
    const dr = openDrawer({ title: `${editing ? "Edit & approve" : "View"}: ${r.code}`, body: '<p class="cw-muted">Loading…</p>', doc: el.ownerDocument, host: el, wide: true, onClose: () => { refresh(); } });
    let item;
    try {
      item = editing ? (await adapter.act(r.id, "open", {})).item : (await adapter.detail(r.id)).item;
    } catch (e) { dr.body.innerHTML = noticeHtml("err", esc((e && e.message) || "This contribution could not be opened.")); return; }
    reviewPanel(dr.body, {
      adapter, sectors: st.sectors, item, labels: DRAWER_LABELS, diff: editing,
      onChanged: async (it2, action) => {
        if (action === "send_request") { toast(el, `Approved and sent to an Admin: "${it2.proposed.title}". It is not public yet.`); dr.close(); }
        if (action === "decline") { toast(el, `Rejected: "${it2.original.title}".`); dr.close(); }
      },
    });
    if (problem) { const m = dr.body.querySelector("[data-msg]"); if (m) m.innerHTML = noticeHtml("err", esc(problem)); }
  }

  if (await load()) render();
  return { refresh };
}
