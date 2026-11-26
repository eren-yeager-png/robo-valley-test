// Contribution workflow: the reason dialog (replaces the demo's prompt()). A real modal: focus moves into it, Tab stays inside, Escape
// cancels, focus returns to the button that opened it. The textarea is required: the confirm button stays disabled until a reason is
// typed. Resolves to the trimmed reason, or null when cancelled.
import { esc } from "./utils.js";

let uid = 0;
export function askReason({ title, label, confirmText = "Confirm", tone = "danger", maxLength = 2000, doc = document } = {}) {
  return new Promise((resolve) => {
    const id = `rv-dlg-${++uid}`;
    const back = doc.activeElement;
    const wrap = doc.createElement("div");
    wrap.className = "rv-dlg-bg";
    wrap.innerHTML = `<div class="rv-dlg" role="dialog" aria-modal="true" aria-labelledby="${id}-t">
      <h3 id="${id}-t" class="rv-dlg-title">${esc(title)}</h3>
      <label for="${id}-r" class="rv-dlg-label">${esc(label)}</label>
      <textarea id="${id}-r" rows="4" maxlength="${maxLength}" required aria-required="true"></textarea>
      <div class="rv-dlg-actions">
        <button type="button" class="btn" data-x="cancel">Cancel</button>
        <button type="button" class="btn ${tone === "danger" ? "danger" : "primary"}" data-x="ok" disabled>${esc(confirmText)}</button>
      </div></div>`;
    const host = doc.querySelector(".rv-cw-root") || doc.body;
    host.appendChild(wrap);
    const box = wrap.querySelector(".rv-dlg"), ta = wrap.querySelector("textarea"), okBtn = wrap.querySelector('[data-x="ok"]');
    const done = (v) => { wrap.remove(); doc.removeEventListener("keydown", onKey, true); if (back && back.focus) back.focus(); resolve(v); };
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); done(null); return; }
      if (e.key === "Tab") {
        const f = Array.from(box.querySelectorAll("textarea, button:not([disabled])"));
        const i = f.indexOf(doc.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    ta.addEventListener("input", () => { okBtn.disabled = ta.value.trim() === ""; });
    wrap.querySelector('[data-x="cancel"]').addEventListener("click", () => done(null));
    okBtn.addEventListener("click", () => { const v = ta.value.trim(); if (v) done(v); });
    wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) done(null); });
    doc.addEventListener("keydown", onKey, true);
    ta.focus();
  });
}
