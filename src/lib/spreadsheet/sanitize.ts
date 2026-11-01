// Everything that comes out of an uploaded spreadsheet is untrusted text. This module turns a cell into a safe plain
// string and a header into a stable key. It never produces markup and never leaves a formula-looking value.

export const MAX_CELL_CHARS = 1000;

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‍⁠﻿]/g;
const TAGS = /<[^>]*>/g;
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;

/** Turns whatever a spreadsheet library hands back for a cell (text, number, date, rich text, formula result ...) into plain text. */
export function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.richText)) return v.richText.map((p) => cellToText((p as { text?: unknown }).text)).join("");
    if ("result" in v) return cellToText(v.result); // a formula: keep the computed value, never the formula itself
    if ("error" in v) return "";
    if ("text" in v) return cellToText(v.text); // hyperlink: keep the visible text, drop the target
  }
  return "";
}

/**
 * Plain, single-line, markup-free text. Control and zero-width characters, HTML tags and repeated spaces are removed;
 * a value that a spreadsheet program would run as a formula (starts with = + - @) is neutralised with a leading apostrophe,
 * except plain numbers. Output is escaped again by the page that shows it; this is defence in depth, not the only layer.
 */
export function sanitizeText(input: string): string {
  let s = input.normalize("NFC").replace(/[\t\r\n]+/g, " ").replace(CONTROL, "");
  s = s.replace(TAGS, " ").replace(/[<>]/g, "");
  s = s.replace(/\s+/g, " ").trim();
  if (/^[=+\-@]/.test(s) && !PLAIN_NUMBER.test(s)) s = "'" + s;
  return s;
}

export const sanitizeCell = (value: unknown): string => sanitizeText(cellToText(value));

/** snake_case key from a header label: "School  Name " -> "school_name". */
export function headerKey(label: string): string {
  return label.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export type Header = { key: string; label: string };

/** Trims, cleans and de-duplicates headers: empty ones become column_N, repeats get _2, _3 ... */
export function normalizeHeaders(rawLabels: unknown[]): Header[] {
  const seen = new Map<string, number>();
  return rawLabels.map((raw, i) => {
    const label = sanitizeCell(raw).replace(/^'/, "").slice(0, 100);
    let key = headerKey(label) || `column_${i + 1}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) key = `${key}_${n}`;
    return { key, label: label || `Column ${i + 1}` };
  });
}
