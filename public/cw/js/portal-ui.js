// Contribution Portal: the shared pieces of every portal page (the app's admin and member portals and the standalone demo; never the
// WordPress plugin). One copy of: the page header row, the panel with its header row, tabs with counts, the table (sticky header,
// scrolls sideways inside its wrapper), the status badge, the "Sent" date, the empty state, the slug, toasts and the side drawer.
// Styles: public/cw/portal.css (.rv-pp-*). Single column: a page is header -> sector grid -> panel, top to bottom.
import { esc } from "./utils.js";
import { PORTAL_STATUS } from "./portal-status.js";

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "19 Sep 2026, 1:20 pm" in local time ("" when missing or not a date). Written out by hand: browsers disagree on "Sep"/"Sept". */
export function fmtSent(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const h = d.getHours();
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}
/** The Sent cell: one line, never wrapped (the full date and time is also in datetime). */
export function sentHtml(value) {
  const t = fmtSent(value);
  return t ? `<time class="rv-pp-sent" datetime="${esc(new Date(value).toISOString())}">${esc(t)}</time>` : '<span class="rv-pp-muted">—</span>';
}

/** A status badge: amber pending review, blue approved, purple publish requested, green published, red rejected, grey otherwise. */
export function statusBadge(key, note = "") {
  const s = PORTAL_STATUS[key] || PORTAL_STATUS.pending;
  return `<span class="rv-pp-badge rv-pp-badge--${s.tone}" data-status="${esc(key)}">${esc(s.label)}</span>${note ? `<span class="rv-pp-note">${esc(note)}</span>` : ""}`;
}

/** Where a field (robot type) comes from: Admin (grey), Suggested by member (indigo), Added by plugin (amber, plugin name in the tooltip). */
export const FIELD_SOURCE = { admin: "Admin", member: "Suggested by member", plugin: "Added by plugin" };
export function sourceBadge(source, pluginName = "") {
  const k = FIELD_SOURCE[source] ? source : "admin";
  const tip = k === "plugin" && pluginName ? ` title="${esc(`Added by the plugin ${pluginName}`)}"` : "";
  return `<span class="rv-pp-src rv-pp-src--${k}"${tip}>${esc(FIELD_SOURCE[k])}</span>`;
}

/** A slug: 12px monospace, muted, one line with an ellipsis; the whole value in the tooltip. */
export const slugHtml = (slug) => `<code class="rv-pp-slug" title="${esc(slug)}">${esc(slug)}</code>`;

/** The page's header row: the title (28px) and a one-line description on the left, the page's button on the right. */
export const pageHeader = ({ title, desc = "", id = "rv-pp-h", actions = "" }) => `<header class="rv-pp-head">
  <div class="rv-pp-head__text"><h1 id="${esc(id)}" class="rv-pp-title">${esc(title)}</h1>${desc ? `<p class="rv-pp-desc">${esc(desc)}</p>` : ""}</div>
  ${actions ? `<div class="rv-pp-actions">${actions}</div>` : ""}</header>`;

/** A panel (white card, 24px padding, full width). Header row: heading (22px) and subtitle on the left, the buttons on the right. */
export const panelHtml = ({ heading, sub = "", id = "rv-pp-panel-h", actions = "", body = "", attrs = "" }) => `<section class="rv-pp-panel" aria-labelledby="${esc(id)}"${attrs}>
  <div class="rv-pp-panel__head"><div class="rv-pp-panel__text"><h2 id="${esc(id)}" class="rv-pp-panel__title">${esc(heading)}</h2>${sub ? `<p class="rv-pp-desc">${esc(sub)}</p>` : ""}</div>
  ${actions ? `<div class="rv-pp-actions">${actions}</div>` : ""}</div>
  <div class="rv-pp-panel__body">${body}</div></section>`;

/** Tabs with counts (role=tablist; Left/Right/Home/End move between them). `tabs`: [[key, label, count?, tone?]]. */
export function tabsHtml(tabs, active, { label = "Status", controls = "rv-pp-tabpanel", idPrefix = "rv-pp-tab" } = {}) {
  return `<div class="rv-pp-tabs" role="tablist" aria-label="${esc(label)}">${tabs.map(([k, l, n, tone]) => {
    const on = k === active;
    return `<button type="button" role="tab" class="rv-pp-tab${on ? " is-on" : ""}" id="${esc(idPrefix)}-${esc(k)}" aria-selected="${on}" aria-controls="${esc(controls)}" tabindex="${on ? 0 : -1}" data-tab="${esc(k)}">${esc(l)}${typeof n === "number" ? ` <span class="rv-pp-tab__n${tone ? ` rv-pp-tab__n--${esc(tone)}` : ""}">${n}</span>` : ""}</button>`;
  }).join("")}</div>`;
}
/** Wires tabs: a click or the arrow keys call onPick(key). */
export function bindTabs(root, onPick) {
  const list = root.querySelector(".rv-pp-tabs");
  if (!list) return;
  const tabs = Array.from(list.querySelectorAll("[data-tab]"));
  tabs.forEach((b, i) => {
    b.addEventListener("click", () => onPick(b.getAttribute("data-tab")));
    b.addEventListener("keydown", (e) => {
      const go = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (go === undefined) return;
      e.preventDefault();
      const t = tabs[(go + tabs.length) % tabs.length];
      t.focus();
      onPick(t.getAttribute("data-tab"), true);
    });
  });
}

/**
 * A table in a wrapper that scrolls sideways (and keeps its header in view): `head` = [[label, className?]], `rows` = html of <tr>s.
 * Empty -> the empty state instead of the table.
 */
export function tableHtml({ caption, head, rows, empty = "No contributions in this sector yet", cls = "" }) {
  if (!rows || !rows.length) return emptyHtml(empty);
  return `<div class="rv-pp-tablewrap" role="region" aria-label="${esc(caption)}" tabindex="0"><table class="rv-pp-table${cls ? " " + esc(cls) : ""}">
  <caption class="rv-pp-sr">${esc(caption)}</caption>
  <thead><tr>${head.map(([l, c]) => `<th scope="col"${c ? ` class="${esc(c)}"` : ""}>${l ? esc(l) : '<span class="rv-pp-sr">Actions</span>'}</th>`).join("")}</tr></thead>
  <tbody>${rows.join("")}</tbody></table></div>`;
}
export const emptyHtml = (text) => `<div class="rv-pp-empty" role="status">${esc(text)}</div>`;
export const noticeHtml = (kind, html, role = kind === "err" ? "alert" : "status") => `<div class="cw-notice cw-n-${kind}" role="${role}">${html}</div>`;

/** A short message in the corner (polite live region); goes away after a few seconds. */
export function toast(root, text, kind = "ok") {
  const doc = root.ownerDocument || document;
  let host = doc.querySelector(".rv-pp-toasts");
  if (!host) {
    host = doc.createElement("div");
    host.className = "rv-pp-toasts";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    doc.body.appendChild(host); // outside the screen: a screen redraws itself right after most actions
  }
  const t = doc.createElement("div");
  t.className = `rv-pp-toast rv-pp-toast--${kind}`;
  t.textContent = text;
  host.appendChild(t);
  const view = doc.defaultView || globalThis;
  view.setTimeout(() => { t.remove(); }, 4500);
  return t;
}

/**
 * A side drawer (role=dialog), or a centred modal with `modal: true` ("+ Add field"): focus moves into it, Tab stays inside, Escape or the backdrop closes it, focus goes back to the button
 * that opened it. Returns { el, body, close }. `onClose` runs once when it closes.
 */
export function openDrawer({ title, body = "", foot = "", doc = document, host = null, onClose = null, wide = false, modal = false }) {
  const back = doc.activeElement;
  const id = `rv-pp-dr-${Math.random().toString(36).slice(2, 8)}`;
  const wrap = doc.createElement("div");
  wrap.className = `rv-pp-drawer-bg${modal ? " rv-pp-modal-bg" : ""}`;
  wrap.innerHTML = `<aside class="rv-pp-drawer${wide ? " rv-pp-drawer--wide" : ""}${modal ? " rv-pp-modal" : ""}" role="dialog" aria-modal="true" aria-labelledby="${id}">
    <div class="rv-pp-drawer__head"><h2 id="${id}" class="rv-pp-drawer__title">${esc(title)}</h2><button type="button" class="btn rv-pp-close" data-x="close" aria-label="Close">✕</button></div>
    <div class="rv-pp-drawer__body" data-body>${body}</div>${foot ? `<div class="rv-pp-drawer__foot" data-foot>${foot}</div>` : ""}</aside>`;
  (host || doc.querySelector(".rv-cw-root") || doc.body).appendChild(wrap);
  let done = false;
  const focusables = () => Array.from(wrap.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
    .filter((x) => !x.closest("[hidden]")); // not by layout: hidden parts are marked, and a test DOM has no layout
  const close = () => {
    if (done) return;
    done = true;
    doc.removeEventListener("keydown", onKey, true);
    wrap.remove();
    if (back && back.focus && back.isConnected) back.focus();
    if (onClose) onClose();
  };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    const f = focusables();
    if (!f.length) return;
    const i = f.indexOf(doc.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  };
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('[data-x="close"]').addEventListener("click", close);
  doc.addEventListener("keydown", onKey, true);
  const first = wrap.querySelector("[data-body] input, [data-body] textarea, [data-body] select") || wrap.querySelector('[data-x="close"]');
  first.focus();
  return { el: wrap, body: wrap.querySelector("[data-body]"), foot: wrap.querySelector("[data-foot]"), close };
}

/** Plain-text search over a row's words. */
export const matches = (q, ...words) => !q || words.join(" ").toLowerCase().includes(String(q).toLowerCase().trim());
