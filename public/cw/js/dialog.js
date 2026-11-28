// Contribution workflow: the dialogs (they replace the demo's prompt() and confirm()). Real modals: focus moves into them, Tab stays
// inside, Escape cancels, focus returns to the button that opened them.
//   askReason  - a required text (decline, reject, request changes, reopen): the confirm button stays disabled until something is
//                typed. Resolves to the trimmed text, or null when cancelled.
//   askConfirm - a yes/no question with an explanation (unpublish). Resolves to true, or false when cancelled.
import { esc } from "./utils.js";

let uid = 0;

function modal({ title, inner, tone, confirmText, needsText, doc }, onDone) {
  const id = `rv-dlg-${++uid}`;
  const back = doc.activeElement;
  const wrap = doc.createElement("div");
  wrap.className = "rv-dlg-bg";
  wrap.innerHTML = `<div class="rv-dlg" role="dialog" aria-modal="true" aria-labelledby="${id}-t"${needsText ? "" : ` aria-describedby="${id}-d"`}>
      <h3 id="${id}-t" class="rv-dlg-title">${esc(title)}</h3>
      ${inner(id)}
      <div class="rv-dlg-actions">
        <button type="button" class="btn" data-x="cancel">Cancel</button>
        <button type="button" class="btn ${tone === "danger" ? "danger" : "primary"}" data-x="ok"${needsText ? " disabled" : ""}>${esc(confirmText)}</button>
      </div></div>`;
  const host = doc.querySelector(".rv-cw-root") || doc.body;
  host.appendChild(wrap);
  const box = wrap.querySelector(".rv-dlg"), ta = wrap.querySelector("textarea, input[type=\"text\"]"), okBtn = wrap.querySelector('[data-x="ok"]');
  const done = (v) => { wrap.remove(); doc.removeEventListener("keydown", onKey, true); if (back && back.focus) back.focus(); onDone(v); };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); done(null); return; }
    if (e.key === "Tab") {
      const f = Array.from(box.querySelectorAll("textarea, input, button:not([disabled])"));
      const i = f.indexOf(doc.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  };
  if (ta) {
    okBtn.disabled = ta.value.trim() === "";
    ta.addEventListener("input", () => { okBtn.disabled = ta.value.trim() === ""; });
    if (ta.tagName === "INPUT") ta.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); okBtn.click(); } });
  }
  wrap.querySelector('[data-x="cancel"]').addEventListener("click", () => done(null));
  okBtn.addEventListener("click", () => { if (!ta) { done(true); return; } const v = ta.value.trim(); if (v) done(v); });
  wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) done(null); });
  doc.addEventListener("keydown", onKey, true);
  (ta || okBtn).focus();
}

export function askReason({ title, label, confirmText = "Confirm", tone = "danger", maxLength = 2000, doc = document } = {}) {
  return new Promise((resolve) => modal({
    title, tone, confirmText, needsText: true, doc,
    inner: (id) => `<label for="${id}-r" class="rv-dlg-label">${esc(label)}</label>
      <textarea id="${id}-r" rows="4" maxlength="${maxLength}" required aria-required="true"></textarea>`,
  }, (v) => resolve(typeof v === "string" ? v : null)));
}

export function askConfirm({ title, text, confirmText = "Confirm", tone = "danger", doc = document } = {}) {
  return new Promise((resolve) => modal({
    title, tone, confirmText, needsText: false, doc,
    inner: (id) => `<p id="${id}-d" class="rv-dlg-text">${esc(text)}</p>`,
  }, (v) => resolve(v === true)));
}

/** A short text with a starting value (a field's name: Rename, Edit & approve). Resolves to the trimmed text, or null when cancelled. */
export function askText({ title, label, value = "", confirmText = "Save", tone = "primary", maxLength = 80, hint = "", doc = document } = {}) {
  return new Promise((resolve) => modal({
    title, tone, confirmText, needsText: true, doc,
    inner: (id) => `<label for="${id}-r" class="rv-dlg-label">${esc(label)}</label>
      <input id="${id}-r" type="text" maxlength="${maxLength}" value="${esc(value)}" required aria-required="true"${hint ? ` aria-describedby="${id}-h"` : ""}>${hint ? `<p id="${id}-h" class="cw-muted cw-hint">${esc(hint)}</p>` : ""}`,
  }, (v) => resolve(typeof v === "string" ? v : null)));
}
