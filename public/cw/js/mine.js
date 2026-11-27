// Contribution workflow: "My Contributions" (every portal, and the demo). The signed-in person's OWN items only: new ideas (the
// workflow) and the ones sent with the current form, with filters by status and sector and an empty state with a way to contribute.
// Columns: Sector, Field, Type, Submitted, Status (Draft / Pending / Approved / Published / Unpublished / Rejected), Moderator
// feedback, Actions. New ideas are View only: a submitted idea is never edited (its original is written once; a Moderator may refine
// it during review). Pending items from the current form keep their existing Edit (on the website's "Your contributions" page).
import { esc, fmtDate } from "./utils.js";
import { RestAdapter } from "./api.js";

export const NEW_IDEA_NOTE = "Submitted ideas can't be edited. A Moderator may refine it during review.";
export const STATUS_FILTERS = [["", "All statuses"], ["draft", "Draft"], ["pending", "Pending"], ["approved", "Approved"], ["published", "Published"], ["unpublished", "Unpublished"], ["rejected", "Rejected"]];
const notice = (kind, html) => `<div class="cw-notice cw-n-${kind}" role="${kind === "err" ? "alert" : "status"}">${html}</div>`;
const option = (v, label, sel) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(label)}</option>`;

export async function mount(el, opts = {}) {
  const adapter = opts.adapter || new RestAdapter(opts.base || "");
  const st = { status: opts.status || "", sector: opts.sector || "", open: null };
  el.classList.add("rv-cw-root");
  let data;
  try { data = await adapter.mine(); } catch (e) {
    el.innerHTML = notice("err", esc(e && e.status === 401 ? "Please sign in to see your contributions." : e && e.status === 503 ? "This list is not available yet." : "Your contributions could not be loaded. Please try again."));
    return;
  }
  const items = data.items || [];
  const contribute = data.contributeUrl || opts.contributeUrl || "/contribute-now/";
  const sectors = Array.from(new Map(items.filter((i) => i.sector).map((i) => [i.sector, i.sectorName || i.sector])).entries()).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  function render() {
    const shown = items.filter((i) => (!st.status || i.status === st.status) && (!st.sector || i.sector === st.sector));
    el.innerHTML = `<section class="rv-mine" aria-labelledby="rv-mine-h"><h1 id="rv-mine-h">My Contributions</h1>
      <p class="cw-muted">Everything you have contributed, and where each one is. Only you see this list.${data.note ? " " + esc(data.note) : ""}</p>
      ${items.length ? `<form class="rv-mine-filters" role="search" aria-label="Filter your contributions">
        <label>Status <select data-f="status">${STATUS_FILTERS.map(([v, l]) => option(v, l, st.status)).join("")}</select></label>
        <label>Sector <select data-f="sector">${option("", "All sectors", st.sector)}${sectors.map(([v, l]) => option(v, l, st.sector)).join("")}</select></label>
        <span class="cw-muted" aria-live="polite">${shown.length} of ${items.length}</span></form>` : ""}
      ${!items.length ? notice("info", `You have not contributed anything yet. <a href="${esc(contribute)}">Share your first idea</a>.`)
        : !shown.length ? notice("info", `Nothing matches these filters. <button type="button" class="rv-mine-clear" data-clear>Show everything</button>`)
        : `<div class="rv-table-scroll"><table class="rv-mine-table"><thead><tr><th scope="col">Title</th><th scope="col">Sector</th><th scope="col">Field</th><th scope="col">Type</th><th scope="col">Submitted</th><th scope="col">Status</th><th scope="col">Moderator feedback</th><th scope="col">Actions</th></tr></thead>
        <tbody>${shown.map((i) => `<tr>
          <td><b>${esc(i.code)}</b> ${esc(i.title)}</td><td>${esc(i.sectorName || "Not sure")}</td><td>${esc(i.field || "—")}</td><td>${esc(i.type)}</td>
          <td>${esc(fmtDate(i.submittedAt))}</td>
          <td><span class="rv-mine-status rv-mine-${esc(i.status)}">${esc(i.statusLabel)}</span>${i.source === "workflow" ? `<div class="rv-mine-note">${esc(NEW_IDEA_NOTE)}</div>` : ""}</td>
          <td>${i.feedback ? esc(i.feedback) : '<span class="cw-muted">—</span>'}</td>
          <td class="rv-mine-actions"><button type="button" class="btn" data-view="${esc(i.code)}" aria-expanded="${st.open === i.code}">View</button>${i.editUrl ? ` <a class="btn" href="${esc(i.editUrl)}">Edit</a>` : ""}</td></tr>
          ${st.open === i.code ? `<tr class="rv-mine-detail"><td colspan="8"><h2>${esc(i.code)} – ${esc(i.title)}</h2><p>${esc(i.description || "")}</p>
            <p class="cw-muted">${esc(i.type)} · ${esc(i.sectorName || "Not sure")}${i.field ? " · " + esc(i.field) : ""} · sent ${esc(fmtDate(i.submittedAt))}${i.publishedAt ? " · published " + esc(fmtDate(i.publishedAt)) : ""}</p>
            ${i.source === "workflow" ? `<p class="rv-mine-note">${esc(NEW_IDEA_NOTE)}</p>` : ""}</td></tr>` : ""}`).join("")}</tbody></table></div>`}
      <p class="cw-muted"><a class="rv-mine-new" href="${esc(contribute)}">+ Contribute something new</a></p></section>`;
    el.querySelectorAll("[data-f]").forEach((s) => s.addEventListener("change", () => { st[s.getAttribute("data-f")] = s.value; st.open = null; render(); }));
    el.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { const c = b.getAttribute("data-view"); st.open = st.open === c ? null : c; render(); }));
    const clear = el.querySelector("[data-clear]");
    if (clear) clear.addEventListener("click", () => { st.status = ""; st.sector = ""; render(); });
  }
  render();
}
