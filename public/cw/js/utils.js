// Contribution workflow: small shared helpers (escaping, word diff, dates, DOM). Plain JavaScript, used by every screen and the server.

/** Escapes text for HTML. Every piece of user text goes through this before it is put into markup. */
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** A date as the demo shows it: "26 Nov 2026, 15:47" (the viewer's locale and time zone). Empty for nothing. */
export function fmtDate(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

/** A list value as text ("STEAM, Robotics"); a plain value as itself. */
export const asText = (v) => (Array.isArray(v) ? v.join(", ") : String(v ?? ""));

/**
 * Word-level difference between two texts, as HTML: kept words as they are, removed words in <del>, added words in <ins>
 * (longest common subsequence on whitespace-split tokens, exactly as the demo's wordDiff). Everything is escaped.
 */
export function wordDiff(a, b) {
  const A = String(a ?? "").split(/(\s+)/), B = String(b ?? "").split(/(\s+)/);
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  let i = 0, j = 0, out = "";
  while (i < n && j < m) {
    if (A[i] === B[j]) { out += esc(A[i]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { if (A[i] !== "") out += `<del>${esc(A[i])}</del>`; i++; }
    else { if (B[j] !== "") out += `<ins>${esc(B[j])}</ins>`; j++; }
  }
  while (i < n) { if (A[i] !== "") out += `<del>${esc(A[i])}</del>`; i++; }
  while (j < m) { if (B[j] !== "") out += `<ins>${esc(B[j])}</ins>`; j++; }
  return out;
}

/** Shorthand for document.querySelector inside a root. */
export const $ = (root, sel) => root.querySelector(sel);
export const $$ = (root, sel) => Array.from(root.querySelectorAll(sel));

/** The checked values of the inputs named `name` inside root. */
export const checkedValues = (root, name) => $$(root, `input[name="${name}"]:checked`).map((x) => x.value);

/** <option> tags for a list of [value, label] pairs (or plain strings). */
export function options(list, selected) {
  return list.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return `<option value="${esc(v)}"${v === selected ? " selected" : ""}>${esc(l)}</option>`;
  }).join("");
}

/**
 * Pill choices (radio or checkbox) with a visually hidden input and a visible label, operable by keyboard. `ids` keeps the
 * ids unique on a page that shows several pill groups.
 */
export function pills(name, list, selected, { type = "checkbox", disabled = false, legend = "" } = {}) {
  const sel = Array.isArray(selected) ? selected : [selected];
  const items = list.map((o, i) => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    const id = `${name}-${i}`;
    return `<label class="rv-pill" for="${esc(id)}"><input id="${esc(id)}" type="${type}" name="${esc(name)}" value="${esc(v)}"${sel.includes(v) ? " checked" : ""}${disabled ? " disabled" : ""}><span>${esc(l)}</span></label>`;
  }).join("");
  return `<div class="rv-pills" role="group"${legend ? ` aria-label="${esc(legend)}"` : ""}>${items}</div>`;
}
