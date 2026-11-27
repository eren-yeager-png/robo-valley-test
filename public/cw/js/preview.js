// Contribution workflow: the Publish Preview modal (Admin). The SAME public card the live Community Ideas page shows (card.js), in a
// standalone page inside an iframe; it can be downloaded as one .html file that works offline, or opened in a new tab.
import { esc } from "./utils.js";
import { renderPreviewDocument } from "./card.js";
import { MESSAGES } from "./lists.js";

/** Opens the preview for a public record; resolves when it is closed ("Close" or "Done reviewing"). */
export function openPreview(record, { meta = "", doc = document } = {}) {
  return new Promise((resolve) => {
    const html = renderPreviewDocument(record);
    const back = doc.activeElement;
    const wrap = doc.createElement("div");
    wrap.className = "cw-modal-bg";
    wrap.innerHTML = `<div class="cw-modal" role="dialog" aria-modal="true" aria-labelledby="cw-pv-h">
      <div class="cw-modal-h"><div><h3 id="cw-pv-h">Publish Preview</h3><div class="cw-muted" data-meta>${esc(meta)}</div></div>
        <button type="button" class="btn" data-x="close">Close</button></div>
      <iframe title="Publish preview" data-frame></iframe>
      <div class="cw-modal-f" data-foot>
        <button type="button" class="btn" data-x="download">Download preview (.html)</button>
        <button type="button" class="btn" data-x="tab">Open in new tab</button>
        <button type="button" class="btn primary" data-x="done">Done reviewing</button>
      </div><div data-pv-msg aria-live="polite"></div></div>`;
    (doc.querySelector(".rv-cw-root") || doc.body).appendChild(wrap);
    wrap.querySelector("[data-frame]").srcdoc = html;
    const blobUrl = () => URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const close = () => { wrap.remove(); doc.removeEventListener("keydown", onKey, true); if (back && back.focus) back.focus(); resolve(); };
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      if (e.key === "Tab") {
        const f = Array.from(wrap.querySelectorAll("button"));
        const i = f.indexOf(doc.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    wrap.querySelector('[data-x="close"]').addEventListener("click", close);
    wrap.querySelector('[data-x="done"]').addEventListener("click", close);
    wrap.querySelector('[data-x="download"]').addEventListener("click", () => {
      const a = doc.createElement("a");
      a.href = blobUrl(); a.download = `${record.code}-publish-preview.html`;
      doc.body.appendChild(a); a.click(); a.remove();
    });
    wrap.querySelector('[data-x="tab"]').addEventListener("click", () => {
      const w = (doc.defaultView || window).open(blobUrl(), "_blank");
      if (!w) wrap.querySelector("[data-pv-msg]").innerHTML = `<div class="cw-notice cw-n-warn" role="alert">${esc(MESSAGES.popupBlocked)}</div>`;
    });
    doc.addEventListener("keydown", onKey, true);
    wrap.querySelector('[data-x="close"]').focus();
  });
}
