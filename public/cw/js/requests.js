// Contribution Portal: Publish Requests (Admins only; the app's /admin/approvals and the demo). The Admin Approval Dashboard merged
// in: the header, a compact sector grid as the filter (publish requests on each card), and one panel with tabs (Awaiting me |
// Published | Rejected | Unpublished | All) and the table Title | Sector | Contributor | Approved by | Sent | Actions.
//   [Open publish preview]: exactly how the idea will look in Community Ideas (the SAME card), with [Publish] (green), [Send back to
//   moderator] and [Reject] (a reason is required for both). Publishing sets it Published; Community Ideas shows it at once (the
//   server reads the public record back before it says so), with a toast and a line in the history (the audit trail).
//   [Details]: the full review (versions, changes against the original, notes, Edit before publishing, Unpublish, Reopen, history).
//   Items sent with the current form that a reviewer verified wait here too: [Open form] publishes them on their own page.
// Only an Admin can publish; the server checks every step again.
import { esc } from "./utils.js";
import { canPublishNext, earnBlocked } from "./rules.js";
import { MESSAGES } from "./lists.js";
import { askReason } from "./dialog.js";
import { openPreview } from "./preview.js";
import { adminPanel } from "./admin.js";
import { bindSectorGrid, plural, sectorGridHtml } from "./sector-grid.js";
import { bindTabs, fmtSent, matches, noticeHtml, openDrawer, pageHeader, panelHtml, sentHtml, statusBadge, tableHtml, tabsHtml, toast } from "./portal-ui.js";
import { REQUEST_TABS, inTab, tabCounts } from "./portal-status.js";
import { PortalRest } from "./portal-api.js";

export const TITLE = "Publish Requests";
export const DESC = "Contributions a Moderator approved, waiting for you to publish them. Open the publish preview to see exactly how each one will look in Community Ideas.";
const EMPTY = { awaiting: "No publish requests waiting. Approved contributions appear here.", published: "Nothing published yet.", rejected: "Nothing rejected.", unpublished: "Nothing unpublished.", all: "No contributions here yet." };

export async function mount(el, opts = {}) {
  const adapter = opts.adapter || new PortalRest(opts.base || "");
  const st = { sector: opts.sector || "", tab: REQUEST_TABS.some((t) => t[0] === opts.tab) ? opts.tab : "awaiting", q: "", data: null, sectors: [] };
  el.classList.add("rv-cw-root", "rv-pp");
  try { st.sectors = (await adapter.formConfig()).sectors || []; } catch { st.sectors = []; }

  async function load() {
    try { st.data = await adapter.portal("requests", { sector: st.sector }); } catch (e) {
      el.innerHTML = pageHeader({ title: TITLE, desc: DESC, id: "rv-req-h" }) + noticeHtml("err", esc(e && e.status === 503 ? "The contribution workflow is not set up yet." : (e && e.message) || MESSAGES.failed));
      return false;
    }
    return true;
  }
  const rowsOf = () => (st.data && st.data.rows) || [];
  const shown = () => rowsOf().filter((r) => inTab(REQUEST_TABS, st.tab, r.display) && matches(st.q, r.title, r.contributor, r.code, r.sectorName));

  function actionsHtml(r) {
    const b = (act, label, cls = "") => `<button type="button" class="btn small${cls ? " " + cls : ""}" data-act="${act}" data-key="${esc(r.key)}" aria-label="${esc(`${label}: ${r.title}`)}">${esc(label)}</button>`;
    if (r.source === "form") return `<a class="btn small primary" href="${esc(r.viewUrl)}" aria-label="${esc(`Open form: ${r.title}`)}">Open form</a>`;
    const out = [];
    if (r.status === "publishing") out.push('<span class="rv-pp-note">Publishing…</span>');
    else if (["pending", "resubmitted", "failed", "unpublished"].includes(r.status)) out.push(b("preview", r.status === "failed" ? "Retry: open preview" : "Open publish preview", "primary"));
    out.push(b("details", "Details"));
    return out.join("");
  }
  const rowHtml = (r) => `<tr data-row="${esc(r.key)}">
    <td class="rv-pp-col-title"><b>${esc(r.title)}</b><span class="rv-pp-sub">${esc(r.code)}${r.source === "form" ? " · Current form" : ""}</span></td>
    <td>${esc(r.sectorName || "Not sure")}</td>
    <td>${esc(r.contributor)}${r.contributorType ? `<span class="rv-pp-sub">${esc(r.contributorType)}</span>` : ""}</td>
    <td>${r.approvedBy ? esc(r.approvedBy) : '<span class="rv-pp-muted">—</span>'}<span class="rv-pp-sub">${statusBadge(r.display, r.decision ? `${r.decision.label}${r.decision.at ? ` · ${fmtSent(r.decision.at)}` : ""}` : r.note)}</span></td>
    <td class="rv-pp-col-sent">${sentHtml(r.sentAt)}</td>
    <td class="rv-pp-col-actions"><div class="rv-pp-rowact">${actionsHtml(r)}</div></td></tr>`;

  function listHtml() {
    return tableHtml({ caption: "Publish requests", head: [["Title", "rv-pp-col-title"], ["Sector"], ["Contributor"], ["Approved by"], ["Sent", "rv-pp-col-sent"], ["", "rv-pp-col-actions"]], rows: shown().map(rowHtml), empty: st.q ? "Nothing matches this search." : EMPTY[st.tab] });
  }

  function render() {
    const d = st.data;
    const cards = d.sectors.map((x) => ({ slug: x.slug, name: x.name, meta: plural(x.requested, "request"), count: x.requested || undefined, countLabel: `${x.requested} publish requests`, countTone: "purple" }));
    const total = d.sectors.reduce((n, x) => n + x.requested, 0);
    const counts = tabCounts(REQUEST_TABS, rowsOf());
    const s = d.sector;
    el.innerHTML = `${pageHeader({ title: TITLE, desc: DESC, id: "rv-req-h" })}
      ${sectorGridHtml({ sectors: cards, selected: st.sector, label: "Filter by sector", compact: true, all: { name: "All sectors", meta: plural(total, "request"), count: total || undefined, countLabel: `${total} publish requests`, countTone: "purple" } })}
      ${panelHtml({
        heading: s ? `Publish requests for ${s.name}` : "Publish requests in every sector", id: "rv-req-panel-h",
        sub: "Preview each one exactly as Community Ideas will show it, then publish it, send it back to the Moderator or reject it.",
        body: `${tabsHtml(REQUEST_TABS.map(([k, l]) => [k, l, counts[k], k === "awaiting" && counts[k] ? "amber" : ""]), st.tab, { label: "Requests", controls: "rv-req-list" })}
          <form class="rv-pp-filters" role="search" aria-label="Search requests" data-filters><label>Search title, contributor or sector<input type="search" data-f="q" value="${esc(st.q)}" maxlength="100" placeholder="Search…"></label></form>
          <div id="rv-req-list" role="tabpanel" aria-labelledby="rv-pp-tab-${esc(st.tab)}" data-list>${listHtml()}</div><div data-msg aria-live="polite"></div>`,
      })}`;
    bindSectorGrid(el, pick);
    bindTabs(el, (k, keyboard) => { st.tab = k; render(); if (keyboard) { const t = el.querySelector(`[data-tab="${k}"]`); if (t) t.focus(); } });
    const f = el.querySelector("[data-filters]");
    f.addEventListener("submit", (e) => e.preventDefault());
    f.querySelector("[data-f]").addEventListener("input", (e) => { st.q = e.target.value; el.querySelector("[data-list]").innerHTML = listHtml(); bindRows(); });
    bindRows();
  }
  function bindRows() { el.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => act(b.getAttribute("data-act"), b.getAttribute("data-key"), b))); }
  async function pick(slug) {
    if (slug === st.sector) return;
    st.sector = slug;
    if (opts.onSector) opts.onSector(slug);
    else if (typeof history !== "undefined" && opts.basePath) history.replaceState(null, "", slug ? `${opts.basePath}?sector=${encodeURIComponent(slug)}` : opts.basePath);
    if (await load()) { render(); const c = el.querySelector(`.rv-sg [data-sector="${slug}"]`); if (c) c.focus(); }
  }
  async function refresh() { if (await load()) render(); }
  const say = (html) => { const m = el.querySelector("[data-msg]"); if (m) m.innerHTML = html; };

  async function act(what, key, btn) {
    const r = rowsOf().find((x) => x.key === key);
    if (!r) return;
    if (what === "details") return details(r);
    if (btn) btn.disabled = true;
    try {
      let it = (await adapter.detail(r.id)).item;
      const n = it.versions.length;
      if (!canPublishNext(it.status, n, it.publishedVersion)) { await refresh(); return; }
      const pv = await adapter.act(r.id, "preview", { rowVersion: it.rowVersion, version: n });
      it = pv.item;
      const earn = earnBlocked(it.contributor.minor, it.proposed.learningPath);
      const choice = await openPreview(pv.record, {
        meta: `${it.code} · version ${n} · ${pv.record.sectorName} section`,
        actions: [
          { key: "publish", label: it.status === "failed" ? "Retry publish" : "Publish", tone: "success", disabled: earn },
          ...(["pending", "resubmitted", "failed"].includes(it.status) ? [{ key: "changes", label: "Send back to moderator" }, { key: "reject", label: "Reject", tone: "danger" }] : []),
        ],
      });
      if (choice === "publish") {
        toast(el, `Publishing "${it.proposed.title}"…`, "ok");
        const done = await adapter.publish(r.id, { rowVersion: it.rowVersion });
        if (done.item && done.item.status === "published") toast(el, `Published: "${it.proposed.title}" is on Community Ideas now.`);
        else toast(el, `Not published: ${(done.item && done.item.publishError) || "the website did not confirm it"}. You can safely retry.`, "err");
      } else if (choice === "changes") {
        const text = await askReason({ title: "Send back to moderator", label: "What should the Moderator change? (required)", confirmText: "Send back", tone: "primary" });
        if (text) { await adapter.act(r.id, "request_changes", { rowVersion: it.rowVersion, feedback: text }); toast(el, `Sent back to the Moderator: "${it.proposed.title}".`); }
      } else if (choice === "reject") {
        const text = await askReason({ title: "Reject", label: "Reason for rejection (required)", confirmText: "Reject" });
        if (text) { await adapter.act(r.id, "reject", { rowVersion: it.rowVersion, reason: text }); toast(el, `Rejected: "${it.proposed.title}".`); }
      }
      await refresh();
    } catch (e) {
      if (btn && btn.isConnected) btn.disabled = false;
      say(noticeHtml("err", esc((e && e.message) || MESSAGES.failed)));
      if (e && e.status === 409) await refresh();
    }
  }

  async function details(r) {
    const dr = openDrawer({ title: `Details: ${r.code}`, body: '<p class="cw-muted">Loading…</p>', doc: el.ownerDocument, host: el, wide: true, onClose: () => { refresh(); } });
    try {
      const it = (await adapter.detail(r.id)).item;
      adminPanel(dr.body, { adapter, sectors: st.sectors, item: it, onChanged: async (item, action) => { if (action === "publish" && item.status === "published") toast(el, `Published: "${item.proposed.title}" is on Community Ideas now.`); } });
    } catch (e) { dr.body.innerHTML = noticeHtml("err", esc((e && e.message) || MESSAGES.failed)); }
  }

  if (await load()) render();
  return { refresh };
}
