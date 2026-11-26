// Contribution workflow: the ONE public card. Used by the Publish Preview (and its downloadable .html), the live Community Ideas page
// and the demo, so the preview and the website can never differ. Inline styles only: the card (and the preview file) needs no
// stylesheet, no app and no network, so it also works when the preview is downloaded and opened offline.
import { esc, fmtDate } from "./utils.js";
import { ideaBy } from "./rules.js";

const chip = (t) => `<span style="display:inline-block;font-size:12px;background:#eef2ff;color:#3730a3;padding:3px 8px;border-radius:10px;margin:0 4px 4px 0">${esc(t)}</span>`;

/** The card markup for one public record (see rules.js toPublicRecord). */
export function renderPublicCard(r) {
  const tags = [...(r.categories || []), ...(r.suitableFor || []).filter((x) => x !== "Not sure")].map(chip).join("")
    + (r.learningPath && r.learningPath !== "Not sure" ? chip(r.learningPath + " path") : "");
  const about = r.resource ? `<div style="font-size:13px;color:#475569;margin:0 0 10px">${esc(r.kind)} for ${r.resource.url
    ? `<a href="${esc(r.resource.url)}" style="color:#1d4ed8">${esc(r.resource.path)}</a>` : esc(r.resource.path)}</div>` : "";
  const refs = r.references && r.references.length ? `<div style="font-size:13px;margin:10px 0 0"><b>Further reading</b>${r.references.map((x) =>
    `<div style="margin-top:4px"><a href="${esc(x.url)}" style="color:#1d4ed8;word-break:break-all" target="_blank" rel="noopener noreferrer">${esc(x.url)}</a>${x.remarks
      ? ` <span style="color:#64748b">– ${esc(x.remarks)}</span>` : ""}</div>`).join("")}</div>` : "";
  return `<article style="border:1px solid #e2e8f0;border-radius:10px;padding:16px;background:#fff;max-width:640px;margin:0 auto;text-align:left;font-family:Arial,Helvetica,sans-serif;color:#202938">
  <div style="font-size:12px;color:#1d4ed8;font-weight:bold;text-transform:uppercase;letter-spacing:.05em">${esc(r.sectorName)} · ${esc(r.robotTypeName)}</div>
  <h2 style="margin:6px 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:1.25;color:#0f172a">${esc(r.title)}</h2>
  ${about}
  <p style="line-height:1.55;color:#334155;margin:0 0 12px;white-space:pre-wrap;overflow-wrap:anywhere">${esc(r.description)}</p>
  ${tags ? `<div style="margin:0 0 8px">${tags}</div>` : ""}
  <div style="font-size:13px;color:#64748b">${esc(ideaBy(r.contributor))}</div>
  ${refs}
</article>`;
}

/** The card with its "Published <date>" line, as listed on the Community Ideas page. */
export const renderListedCard = (r) => `<div class="rv-pub-card">${renderPublicCard(r)}<div style="text-align:center;margin-top:6px;color:#64748b;font-size:13px">Published ${esc(fmtDate(r.publishedAt))}</div></div>`;

/** The standalone preview page (iframe srcdoc, "Open in new tab" and the downloaded .html): self-contained, works offline. */
export function renderPreviewDocument(r) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Preview – ${esc(r.title)}</title></head>
<body style="margin:0;font-family:Arial,Helvetica,sans-serif;background:#f1f5f9">
<div style="background:#fef3c7;color:#92400e;padding:8px 16px;font-size:13px;text-align:center">PREVIEW ONLY – not published. This is how the idea will appear on the public website.</div>
<div style="background:#0f172a;color:#fff;padding:14px 20px"><b>RoboValley</b> › Community Ideas › ${esc(r.sectorName)}</div>
<div style="padding:24px 16px">${renderPublicCard(r)}</div>
</body></html>`;
}
