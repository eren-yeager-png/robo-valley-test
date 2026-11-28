// Contribution Portal: <SectorGrid /> and <SectorCard />, THE one sector grid of every portal page (the Visitor's, Student's,
// Teacher's, Parent's and Contributor's sectors, Moderation, Publish Requests, Sector Forms, the Admin's Overview and Sectors). Never
// copied: every page calls sectorGridHtml() with its own data and meta line. Rendered from data only:
//   [{ slug, name, meta, count, countLabel, countTone, dot, dotLabel, chip, icon, color }]
// Every card is a <button aria-pressed> of the same size: an icon top-left (the sector's icon, else its first letter), the name, one
// meta line from the page ("12 ideas · 3 pending"). Optional: a count badge, an amber dot (suggestions waiting), a chip ("Relevant to
// your child"). States: hover lifts it, focus shows a ring, selected = 2px green border, tint and a check. Rounded corners (16px), never
// a pill. Grid: repeat(auto-fill, minmax(200px, 1fr)), 2 columns under 600px and 1 under 380px (public/cw/portal.css .rv-sg-*).
import { esc } from "./utils.js";

export const TINTS = 8;
/** A light tint per sector, worked out from its slug (the same sector always gets the same one) while sectors have no colour. */
export function tintOf(slug) {
  let h = 0;
  for (const ch of String(slug || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % TINTS) + 1;
}
const initial = (name) => (String(name || "").trim().match(/[A-Za-z0-9]/) || ["•"])[0].toUpperCase();
const CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>';

/** One card. `selected` marks it (aria-pressed=true). */
export function sectorCardHtml(s, { selected = false } = {}) {
  const color = typeof s.color === "string" && /^#[0-9a-f]{6}$/i.test(s.color) ? ` style="--rv-sg-tint:${s.color}14;--rv-sg-ink:${s.color}"` : "";
  const icon = s.icon ? esc(String(s.icon).slice(0, 4)) : esc(initial(s.name));
  const count = typeof s.count === "number"
    ? `<span class="rv-sg-count${s.countTone ? ` rv-sg-count--${esc(s.countTone)}` : ""}"><span aria-hidden="true">${s.count}</span><span class="rv-pp-sr">${esc(s.countLabel || String(s.count))}</span></span>` : "";
  const dot = s.dot ? `<span class="rv-sg-dot" title="${esc(s.dotLabel || "Waiting")}"><span class="rv-pp-sr">${esc(s.dotLabel || "Waiting")}</span></span>` : "";
  return `<button type="button" class="rv-sg-card rv-sg-t${tintOf(s.slug)}${selected ? " is-selected" : ""}" aria-pressed="${selected}" data-sector="${esc(s.slug)}"${color}>
    <span class="rv-sg-top"><span class="rv-sg-icon" aria-hidden="true">${icon}</span><span class="rv-sg-flags">${dot}${count}<span class="rv-sg-check" aria-hidden="true">${CHECK}</span></span></span>
    <span class="rv-sg-name">${esc(s.name)}</span>
    ${s.meta ? `<span class="rv-sg-meta">${esc(s.meta)}</span>` : ""}
    ${s.chip ? `<span class="rv-sg-chip">${esc(s.chip)}</span>` : ""}</button>`;
}

/**
 * The grid. `all`: an optional first card for "every sector" ({ name, meta, count }) that is selected when `selected` is "".
 * `compact`: shorter cards (a filter, e.g. Publish Requests). `label`: the group's accessible name.
 */
export function sectorGridHtml({ sectors = [], selected = "", label = "Sectors", compact = false, all = null }) {
  const cards = sectors.map((s) => sectorCardHtml(s, { selected: s.slug === selected }));
  if (all) cards.unshift(sectorCardHtml({ slug: "", icon: "★", ...all }, { selected: !selected }));
  return `<div class="rv-sg${compact ? " rv-sg--compact" : ""}" role="group" aria-label="${esc(label)}">${cards.join("")}</div>`;
}

/** Wires the cards: a click calls onSelect(slug) ("" for the "every sector" card). */
export function bindSectorGrid(root, onSelect) {
  root.querySelectorAll(".rv-sg [data-sector]").forEach((b) => b.addEventListener("click", () => onSelect(b.getAttribute("data-sector"))));
}

/** "1 idea" / "2 ideas". */
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
