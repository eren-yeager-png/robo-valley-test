// The downloadable upload report: one CSV of every row that was skipped, merged or refused, and every row that needs a person's
// review, each with its row number (and sheet). Nothing is dropped silently: the numbers in the admin screen add up to the
// rows of the file, and this file lists the rows behind them.

import type { MergedRow, PossibleDuplicate } from "./spreadsheet/dedupe";
import type { InvalidRow } from "./spreadsheet/parse";

export type StoredReport = {
  version?: number;
  rowsRead?: number;
  sheets?: string[];
  hiddenRowsRead?: number;
  repeatedHeaderRows?: { rowNumber: number; sheet?: string }[];
  rejected?: InvalidRow[];
  merged?: MergedRow[];
  possible?: PossibleDuplicate[];
  truncated?: boolean;
  databaseSkipped?: number;
};

/** One CSV cell. A value a spreadsheet program would run as a formula is neutralised, and quotes are doubled. */
export function csvCell(v: unknown): string {
  let s = String(v ?? "").replace(/[\r\n]+/g, " ");
  if (/^[=+\-@\t]/.test(s)) s = "'" + s;
  return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const line = (cells: unknown[]) => cells.map(csvCell).join(",");

export function reportCsv(report: StoredReport | null): string {
  const out: string[] = [line(["type", "sheet", "row", "related_row", "reason", "details"])];
  const r = report ?? {};
  for (const x of r.rejected ?? []) out.push(line(["rejected", x.sheet ?? "", x.rowNumber, "", x.reason, ""]));
  for (const m of r.merged ?? []) {
    const parts: string[] = [];
    if (m.filled.length) parts.push("filled into the kept row: " + m.filled.join("; "));
    for (const c of m.conflicts) parts.push(`${c.column}: kept "${c.kept}", skipped "${c.skipped}"`);
    out.push(line(["duplicate_skipped", m.sheet ?? "", m.row, m.keptRow, m.reason, parts.join(" | ")]));
  }
  for (const p of r.possible ?? []) out.push(line(["possible_duplicate_review", p.sheet ?? "", p.row, p.otherRow, p.reason, p.similarity != null ? `similarity ${p.similarity}` : ""]));
  for (const h of r.repeatedHeaderRows ?? []) out.push(line(["header_repeated_skipped", h.sheet ?? "", h.rowNumber, "", "the header row appears again in the data", ""]));
  if (r.hiddenRowsRead) out.push(line(["note", "", "", "", `${r.hiddenRowsRead} rows are hidden in the spreadsheet (for example by a filter); they were read like every other row`, ""]));
  if (r.truncated) out.push(line(["note", "", "", "", "This list is capped; the counts shown in the admin screen are exact", ""]));
  return out.join("\r\n") + "\r\n";
}
