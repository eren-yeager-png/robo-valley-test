// Contribution Portal: the Audit Log (Admins only; /admin/audit-log and the demo). Who approved, edited, published, rejected or changed
// a role, in which role, on which item and when; filter by kind and search; 50 lines a page, newest first.
import { esc } from "./utils.js";
import { noticeHtml, pageHeader, panelHtml, sentHtml, tableHtml } from "./portal-ui.js";
import { PortalRest } from "./portal-api.js";

export const TITLE = "Audit Log";
export const DESC = "Every approval, edit, publish, rejection and role change, with who did it and when.";

export async function mount(el, opts = {}) {
  const adapter = opts.adapter || new PortalRest(opts.base || "");
  const st = { page: 1, action: "", q: "", data: null };
  el.classList.add("rv-cw-root", "rv-pp");
  let timer = null;

  async function load() {
    try { st.data = await adapter.auditLog({ page: st.page, action: st.action, q: st.q }); return true; } catch (e) {
      el.innerHTML = pageHeader({ title: TITLE, desc: DESC, id: "rv-audit-h" }) + noticeHtml("err", esc((e && e.message) || "The audit log could not be loaded. Please try again."));
      return false;
    }
  }
  const listHtml = () => {
    const d = st.data;
    return `${tableHtml({ caption: "Audit log", empty: st.q || st.action ? "Nothing matches these filters." : "Nothing has been recorded yet.",
      head: [["When", "rv-pp-col-sent"], ["Who"], ["Role"], ["Action"], ["Item", "rv-pp-col-title"], ["Details"]],
      rows: d.rows.map((r) => `<tr><td class="rv-pp-col-sent">${sentHtml(r.at)}</td><td>${esc(r.actor)}</td><td>${esc(r.role)}</td><td><span class="rv-pp-tag">${esc(r.actionLabel)}</span></td>
        <td class="rv-pp-col-title">${esc(r.target)}</td><td>${esc(r.details)}</td></tr>`) })}
      ${d.pages > 1 ? `<nav class="rv-pp-pager" aria-label="Pages"><button type="button" class="btn small" data-page="${d.page - 1}"${d.page <= 1 ? " disabled" : ""}>← Newer</button>
        <span>Page ${d.page} of ${d.pages} · ${d.total} entries</span><button type="button" class="btn small" data-page="${d.page + 1}"${d.page >= d.pages ? " disabled" : ""}>Older →</button></nav>` : ""}`;
  };
  function render() {
    const d = st.data;
    el.innerHTML = `${pageHeader({ title: TITLE, desc: DESC, id: "rv-audit-h" })}
      ${panelHtml({ heading: "Activity", id: "rv-audit-panel-h", sub: `${d.total} entries${st.action ? " of this kind" : ""}.`,
        body: `<form class="rv-pp-filters" role="search" aria-label="Filter the audit log" data-filters>
          <label>Kind<select data-f="action"><option value="">Everything</option>${(d.actions || []).map(([k, l]) => `<option value="${esc(k)}"${k === st.action ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
          <label>Search who, item or details<input type="search" data-f="q" value="${esc(st.q)}" maxlength="100" placeholder="Search…"></label></form>
          <div data-list aria-live="polite">${listHtml()}</div>` })}`;
    const f = el.querySelector("[data-filters]");
    f.addEventListener("submit", (e) => e.preventDefault());
    f.querySelector('[data-f="action"]').addEventListener("change", async (e) => { st.action = e.target.value; st.page = 1; if (await load()) { el.querySelector("[data-list]").innerHTML = listHtml(); bindPages(); } });
    f.querySelector('[data-f="q"]').addEventListener("input", (e) => {
      st.q = e.target.value; st.page = 1;
      clearTimeout(timer);
      timer = setTimeout(async () => { if (await load()) { el.querySelector("[data-list]").innerHTML = listHtml(); bindPages(); } }, 250);
    });
    bindPages();
  }
  function bindPages() {
    el.querySelectorAll("[data-page]").forEach((b) => b.addEventListener("click", async () => { st.page = Number(b.getAttribute("data-page")); if (await load()) { el.querySelector("[data-list]").innerHTML = listHtml(); bindPages(); } }));
  }
  if (await load()) render();
  return { stop: () => clearTimeout(timer) };
}
