// Contribution workflow: the public Community Ideas page (WordPress page, shortcode [rv_community_ideas]; and the demo). Reads the
// public API every time it is shown (never a cached copy) and draws each idea with the SAME card the Publish Preview showed.
// Grouped by sector in Sector Forms' order, only sectors that have ideas; "Not sure" is listed last as "Other ideas".
import { $, esc } from "./utils.js";
import { MESSAGES, NOT_SURE, OTHER_IDEAS } from "./lists.js";
import { renderListedCard } from "./card.js";
import { RestAdapter } from "./api.js";

export async function mount(el, opts = {}) {
  const adapter = opts.adapter || new RestAdapter(el.getAttribute("data-api-base") || "");
  el.classList.add("rv-app");
  el.innerHTML = `<section aria-labelledby="rv-site-h"><div class="rv-site-head"><h2 id="rv-site-h">RoboValley – Community Ideas</h2><p>Public website. Only contributions an Admin has published appear here.</p></div><div class="rv-site-body" aria-live="polite"><p class="rv-empty">Loading…</p></div></section>`;
  const body = $(el, ".rv-site-body");
  let items, sectors;
  try {
    [{ items }, { sectors }] = await Promise.all([adapter.publicList(), adapter.formConfig().catch(() => ({ sectors: [] }))]);
  } catch (e) {
    body.innerHTML = `<div class="rv-notice rv-n-err" role="alert">${esc(e && e.status === 503 ? "Community Ideas is not available right now. Please try again later." : MESSAGES.failed)}</div>`;
    return;
  }
  if (!items.length) { body.innerHTML = `<p class="rv-empty">${esc(MESSAGES.publicEmpty)}</p>`; return; }
  const order = (sectors || []).map((s) => s.slug);
  const groups = new Map();
  for (const r of items) { const k = r.sector || NOT_SURE; if (!groups.has(k)) groups.set(k, { name: k === NOT_SURE ? OTHER_IDEAS : r.sectorName, items: [] }); groups.get(k).items.push(r); }
  const rank = (k) => (k === NOT_SURE ? 1e6 : order.indexOf(k) === -1 ? 1e5 : order.indexOf(k));
  body.innerHTML = Array.from(groups.entries()).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1].name.localeCompare(b[1].name)).map(([k, g]) =>
    `<section class="rv-sector" aria-labelledby="rv-sec-${esc(k)}"><h3 id="rv-sec-${esc(k)}">${esc(g.name)}</h3>${g.items.map(renderListedCard).join("")}</section>`).join("");
}
