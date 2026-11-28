// Contribution workflow: "My Contributions" (every Member portal, the moderators' portal, and the demo). The signed-in person's OWN
// items only: new ideas (the workflow) and the ones sent with the current form, with filters by status and sector and an empty state
// with a way to contribute. Columns (the portal's table): Title (with the code, field and type), Sector, Status (the portal badges;
// a rejected item shows the reviewer's reason, other replies show under it too), Sent, Actions. New ideas are View only: a submitted
// idea is never edited (its original is written once; a Moderator may refine it during review). Pending items from the current form
// keep their existing Edit (on the website's "Your contributions" page).
// opts.data: the list given by the page (Users & Roles' View as); opts.readOnly: no Edit and no "contribute" links; opts.sector: only
// one sector (the Parent's sector tab); opts.compact: just the table (Title, Status, Sent) inside another page.
import { esc } from "./utils.js";
import { RestAdapter } from "./api.js";
import { emptyHtml, fmtSent, noticeHtml, pageHeader, sentHtml, statusBadge, tableHtml } from "./portal-ui.js";

export const NEW_IDEA_NOTE = "Submitted ideas can't be edited. A Moderator may refine it during review.";
export const STATUS_FILTERS = [["", "All statuses"], ["draft", "Draft"], ["pending", "Pending review"], ["approved", "Approved"], ["published", "Published"], ["unpublished", "Unpublished"], ["rejected", "Rejected"]];
const option = (v, label, sel) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(label)}</option>`;

export async function mount(el, opts = {}) {
  const adapter = opts.adapter || new RestAdapter(opts.base || "");
  const st = { status: opts.status || "", sector: opts.sector || "", open: null };
  el.classList.add("rv-cw-root", "rv-pp");
  let data;
  try { data = opts.data || await adapter.mine(); } catch (e) {
    el.innerHTML = noticeHtml("err", esc(e && e.status === 401 ? "Please sign in to see your contributions." : e && e.status === 503 ? "This list is not available yet." : "Your contributions could not be loaded. Please try again."));
    return;
  }
  const all = data.items || [];
  const items = opts.onlySector ? all.filter((i) => i.sector === opts.onlySector) : all;
  const contribute = opts.readOnly ? "" : data.contributeUrl || opts.contributeUrl || "/contribute-now/";
  const sectors = Array.from(new Map(items.filter((i) => i.sector).map((i) => [i.sector, i.sectorName || i.sector])).entries()).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  const title = (i) => `<td class="rv-pp-col-title"><b>${esc(i.title)}</b><span class="rv-pp-sub">${esc(i.code)}${i.field ? ` · ${esc(i.field)}` : ""} · ${esc(i.type)}</span></td>`;
  const status = (i) => `<td>${statusBadge(i.status === "approved" ? "approved" : i.status)}${i.feedback ? `<span class="rv-pp-note">${i.status === "rejected" ? "Reason: " : "Reviewer: "}${esc(i.feedback)}</span>` : ""}${i.source === "workflow" && !opts.compact ? `<span class="rv-pp-note rv-mine-note">${esc(NEW_IDEA_NOTE)}</span>` : ""}</td>`;

  function table(shown) {
    if (opts.compact) {
      return tableHtml({ caption: "Your contributions", head: [["Title", "rv-pp-col-title"], ["Status"], ["Sent", "rv-pp-col-sent"]], empty: "You have not contributed to this sector yet.",
        rows: shown.map((i) => `<tr>${title(i)}${status(i)}<td class="rv-pp-col-sent">${sentHtml(i.submittedAt)}</td></tr>`) });
    }
    return tableHtml({ caption: "Your contributions", head: [["Title", "rv-pp-col-title"], ["Sector"], ["Status"], ["Sent", "rv-pp-col-sent"], ["", "rv-pp-col-actions"]], empty: "Nothing matches these filters.",
      rows: shown.map((i) => `<tr>${title(i)}<td>${esc(i.sectorName || "Not sure")}</td>${status(i)}<td class="rv-pp-col-sent">${sentHtml(i.submittedAt)}</td>
        <td class="rv-pp-col-actions"><div class="rv-pp-rowact"><button type="button" class="btn small" data-view="${esc(i.code)}" aria-expanded="${st.open === i.code}">View</button>${i.editUrl && !opts.readOnly ? ` <a class="btn small" href="${esc(i.editUrl)}">Edit</a>` : ""}</div></td></tr>
        ${st.open === i.code ? `<tr class="rv-mine-detail"><td colspan="5"><h2>${esc(i.code)} – ${esc(i.title)}</h2><p>${esc(i.description || "")}</p>
          <p class="rv-pp-muted">${esc(i.type)} · ${esc(i.sectorName || "Not sure")}${i.field ? " · " + esc(i.field) : ""} · sent ${esc(fmtSent(i.submittedAt))}${i.publishedAt ? " · published " + esc(fmtSent(i.publishedAt)) : ""}</p>
          ${i.source === "workflow" ? `<p class="rv-mine-note">${esc(NEW_IDEA_NOTE)}</p>` : ""}</td></tr>` : ""}`) });
  }

  function render() {
    const shown = items.filter((i) => (!st.status || i.status === st.status) && (!st.sector || i.sector === st.sector));
    if (opts.compact) { el.innerHTML = table(shown); return; }
    el.innerHTML = `${pageHeader({ title: opts.heading || "My Contributions", id: "rv-mine-h", desc: opts.note || `Everything you have contributed, and where each one is. Only you see this list.${data.note ? " " + data.note : ""}`,
        actions: contribute ? `<a class="btn primary rv-mine-new" href="${esc(contribute)}">+ Contribute something new</a>` : "" })}
      <section class="rv-mine rv-pp-block" aria-labelledby="rv-mine-h">
      ${items.length ? `<form class="rv-pp-filters rv-mine-filters" role="search" aria-label="Filter your contributions">
        <label>Status <select data-f="status">${STATUS_FILTERS.map(([v, l]) => option(v, l, st.status)).join("")}</select></label>
        <label>Sector <select data-f="sector">${option("", "All sectors", st.sector)}${sectors.map(([v, l]) => option(v, l, st.sector)).join("")}</select></label>
        <span class="rv-pp-count" aria-live="polite">${shown.length} of ${items.length}</span></form>` : ""}
      ${!items.length ? (contribute ? noticeHtml("info", `You have not contributed anything yet. <a href="${esc(contribute)}">Share your first idea</a>.`) : emptyHtml("Nothing contributed yet."))
        : !shown.length ? noticeHtml("info", `Nothing matches these filters. <button type="button" class="rv-mine-clear" data-clear>Show everything</button>`)
        : table(shown)}</section>`;
    el.querySelectorAll("[data-f]").forEach((s) => s.addEventListener("change", () => { st[s.getAttribute("data-f")] = s.value; st.open = null; render(); }));
    el.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { const c = b.getAttribute("data-view"); st.open = st.open === c ? null : c; render(); }));
    const clear = el.querySelector("[data-clear]");
    if (clear) clear.addEventListener("click", () => { st.status = ""; st.sector = ""; render(); });
  }
  render();
}

