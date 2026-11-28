// Contribution workflow: pieces shared by the Moderator Workspace and the Admin Approval Dashboard (both inside the admin portal).
import { esc, fmtDate } from "./utils.js";
import { FIELDS, FIELD_LABELS, STATUS_CLASS, STATUS_LABEL } from "./lists.js";
import { robotLabel, sectorLabel } from "./rules.js";

export const badge = (status) => `<span class="rv-badge ${STATUS_CLASS[status] || ""}">${esc(STATUS_LABEL[status] || status)}</span>`;
const notSet = '<span class="cw-muted">Not set</span>';

/** A field's value as text (sector and robot type by name, lists joined); "" when empty. */
export function fieldText(f, v, all, sectors) {
  if (f === "sector") return v ? sectorLabel(v, sectors) : "";
  if (f === "robotType") return v ? robotLabel(all.sector, v, sectors) : "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v ?? "");
}
export const fieldHtml = (f, v, all, sectors) => { const t = fieldText(f, v, all, sectors); return t ? esc(t) : notSet; };

/** The read-only list of the seven fields of a version (original or proposed). */
export const fieldsHtml = (version, sectors) => FIELDS.map((f) =>
  `<div class="cw-field"><div class="cw-k">${FIELD_LABELS[f]}</div><div class="cw-v">${fieldHtml(f, version[f], version, sectors)}</div></div>`).join("");

const link = (u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`;
export function refsHtml(refs) {
  if (!refs || !refs.length) return '<span class="cw-muted">None</span>';
  return refs.map((r) => `<div class="cw-ref">${link(r.url)}${r.remarks ? ` <span class="cw-muted">– ${esc(r.remarks)}</span>` : ""}</div>`).join("");
}

/** The request (type, the RoboValley resource it refers to, reference links): read-only for Moderators and Admins. */
export function requestHtml(it) {
  const r = it.resource;
  return `<div class="cw-box cw-request"><h4>Request</h4><span class="cw-tag">${esc(it.kind)}</span>
  ${r ? `<div class="cw-grid2 cw-tight">
      <div class="cw-field"><div class="cw-k">Feature</div>${esc(r.feature)}</div>
      <div class="cw-field"><div class="cw-k">Resource type</div>${esc(r.type)}</div>
      <div class="cw-field"><div class="cw-k">Resource path</div>${esc(r.path)}</div>
      <div class="cw-field"><div class="cw-k">Resource ID</div>${r.id ? esc(r.id) : notSet}</div>
    </div>
    <div class="cw-field cw-links"><div class="cw-k">Link to that page</div>${r.url ? link(r.url) : '<span class="cw-muted">Not given</span>'}</div>
    <div class="cw-field"><div class="cw-k">What should change</div>${r.change ? esc(r.change) : notSet}</div>`
    : '<div class="cw-muted">Does not refer to an existing RoboValley resource.</div>'}
  <div class="cw-field cw-links"><div class="cw-k">Reference links</div>${refsHtml(it.references)}</div></div>`;
}

/** Activity history, newest first. */
export const historyHtml = (it) => (it.history || []).slice().reverse().map((h) =>
  `<div class="cw-history"><b>${esc(h.actor)}</b>: ${esc(h.text)}<div class="cw-when">${esc(fmtDate(h.at))}</div></div>`).join("");

/** The attachment chip (a private download for reviewers). */
export const attachmentHtml = (it, adapter) => (it.attachment
  ? `<a class="cw-tag cw-attach" href="${esc(adapter.attachmentUrl(it.id))}" download>📎 ${esc(it.attachment.name)}</a>` : "");

export const notice = (kind, html, role = "status") => `<div class="cw-notice cw-n-${kind}" role="${role}">${html}</div>`;
export const lastFeedback = (it, type) => (it.feedback || []).filter((f) => !type || f.type === type).slice(-1)[0];
/** The latest decision to reject: a Moderator's decline or an Admin's rejection (who, why, when). */
export const lastDecision = (it) => (it.feedback || []).filter((f) => f.type === "decline" || f.type === "reject").slice(-1)[0];
export const decisionWho = (f) => `${f.type === "decline" ? "Declined" : "Rejected"} by ${f.by} (${f.type === "decline" ? "Moderator" : "Admin"})`;
export const decisionHtml = (f) => `<b>${esc(decisionWho(f))}</b> on ${esc(fmtDate(f.at))}. Reason: ${esc(f.text)}`;
