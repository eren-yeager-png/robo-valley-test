// Duplicate handling for an uploaded school list. Pure: no database, no network.
//
// One school is ONE record. The identity of a school is, in this order:
//   1. its UDISE code (11 digits; a 10-digit code is padded with the leading zero Excel drops; "0" and other
//      placeholders are NOT a code), or, when a row has no usable UDISE code,
//   2. its normalised name + district + state + PIN code.
// Two rows with DIFFERENT valid UDISE codes are never merged, even when the name and PIN are the same (two campuses).
//
// What is merged automatically: exact duplicates (same UDISE, or the same name/district/state/PIN) and a row that
// only differs by a blank district or state. What is NEVER merged but listed for a person to review: the same name and
// PIN with different UDISE codes, and near-identical names in one PIN code (trigram similarity >= 0.8).
// The first occurrence wins. A later duplicate may fill a value that is empty in the kept row; it never overwrites one,
// and every difference between two non-empty values is reported with both row numbers.

import type { ParsedRow } from "./parse";

export const NEAR_DUPLICATE_SIMILARITY = 0.8;
/** The report keeps at most this many entries per list (the counts are always exact). */
export const MAX_REPORT_ENTRIES = 5000;

// ---- normalisation ---------------------------------------------------------------------------------------------

/** Unicode NFKC, lower case, "&" = "and", punctuation removed (letters, digits and combining marks of any script kept), "SR" = "SENIOR". */
export function normText(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ")
    .replace(/\bsr\b/g, "senior")
    .replace(/\s+/g, " ")
    .trim();
}

/** The 11-digit UDISE code, or null when the value is blank, a placeholder ("0") or not a code. */
export function normUdise(raw: unknown): string | null {
  const s = String(raw ?? "").normalize("NFKC").trim().replace(/\.0+$/, "").replace(/[\s'-]/g, "");
  if (!/^\d{10,11}$/.test(s)) return null;
  const code = s.length === 10 ? "0" + s : s;
  return /^0+$/.test(code) ? null : code;
}

/** A PIN code as 6 digits: "110001.0", "110 001" and a number cell all become "110001"; anything else is returned unchanged for validation. */
export function normPin(raw: unknown): string {
  const s = String(raw ?? "").normalize("NFKC").trim().replace(/\.0+$/, "").replace(/[\s-]/g, "");
  return s;
}

/** pg_trgm-style similarity (0..1): shared trigrams / all trigrams of the two normalised names. */
export function similarity(a: string, b: string): number {
  const grams = (s: string) => {
    const out = new Set<string>();
    for (const w of s.split(" ").filter(Boolean)) {
      const p = "  " + w + " ";
      for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
    }
    return out;
  };
  const A = grams(a), B = grams(b);
  if (A.size === 0 && B.size === 0) return 1;
  let shared = 0;
  for (const g of A) if (B.has(g)) shared++;
  return shared / (A.size + B.size - shared);
}

// ---- the report ------------------------------------------------------------------------------------------------

export type MergedRow = {
  sheet?: string;
  row: number;           // the duplicate that was skipped
  keptRow: number;       // the row that was kept
  reason: string;
  filled: string[];      // columns the kept row did not have and now has
  conflicts: { column: string; kept: string; skipped: string }[]; // both non-empty and different: the kept value stays
};
export type PossibleDuplicate = { sheet?: string; row: number; otherRow: number; reason: string; similarity?: number };
export type DedupeSummary = {
  uniqueRows: number;
  duplicatesSkipped: number;
  rowsFilled: number;
  conflictRows: number;
  possibleDuplicates: number;
  merged: MergedRow[];
  possible: PossibleDuplicate[];
  truncated: boolean;
};

type Entry = { row: ParsedRow; udise: string | null; name: string; district: string; state: string; pin: string };

const where = (r: { sheet?: string }) => r.sheet;

function mergeInto(kept: Entry, dup: ParsedRow, reason: string): MergedRow {
  const filled: string[] = [];
  const conflicts: MergedRow["conflicts"] = [];
  for (const [col, v] of Object.entries(dup.data)) {
    if (!v) continue;
    const cur = kept.row.data[col] ?? "";
    if (!cur) { kept.row.data[col] = v; filled.push(col); }
    else if (cur !== v) conflicts.push({ column: col, kept: cur, skipped: v });
  }
  // The searchable fields follow what was filled in, so a value taken from the duplicate is searchable too.
  if (!kept.row.schoolName && dup.schoolName) kept.row.schoolName = dup.schoolName;
  if (!kept.row.state && dup.state) { kept.row.state = dup.state; kept.state = normText(dup.state); }
  if (!kept.row.district && dup.district) { kept.row.district = dup.district; kept.district = normText(dup.district); }
  if (!kept.row.udiseCode && dup.udiseCode) kept.row.udiseCode = dup.udiseCode;
  if (filled.length) {
    const have = new Set(kept.row.locationText.split(" ").filter(Boolean));
    const extra = dup.locationText.split(" ").filter((w) => w && !have.has(w));
    if (extra.length) kept.row.locationText = (kept.row.locationText + " " + extra.join(" ")).trim();
  }
  return { sheet: where(dup), row: dup.rowNumber, keptRow: kept.row.rowNumber, reason, filled, conflicts };
}

const blankOrEqual = (a: string, b: string) => !a || !b || a === b;

/**
 * Collapses duplicate rows (first occurrence wins) and lists what needs a person's eye. The returned `rows` are the unique
 * records, in file order, each carrying the `dedupeKey` that the database enforces as unique within a dataset.
 */
export function dedupeRows(input: ParsedRow[]): { rows: (ParsedRow & { dedupeKey: string })[]; summary: DedupeSummary } {
  const entries: Entry[] = [];
  const byUdise = new Map<string, Entry>();
  const byFull = new Map<string, Entry>();       // name|district|state|pin of entries WITHOUT a UDISE code
  const byNamePin = new Map<string, Entry[]>();
  const merged: MergedRow[] = [];
  const possible: PossibleDuplicate[] = [];
  let possibleCount = 0;
  let filledRows = 0, conflictRows = 0;
  let truncated = false;

  const note = (list: unknown[], item: unknown) => { if (list.length < MAX_REPORT_ENTRIES) list.push(item); else truncated = true; };
  const addPossible = (p: PossibleDuplicate) => { possibleCount++; note(possible, p); };
  const register = (e: Entry) => {
    entries.push(e);
    if (e.udise) byUdise.set(e.udise, e);
    else byFull.set(`${e.name}|${e.district}|${e.state}|${e.pin}`, e);
    const k = `${e.name}|${e.pin}`;
    (byNamePin.get(k) ?? byNamePin.set(k, []).get(k)!).push(e);
  };
  const absorb = (e: Entry, r: ParsedRow, reason: string) => {
    const m = mergeInto(e, r, reason);
    if (m.filled.length) filledRows++;
    if (m.conflicts.length) conflictRows++;
    if (e.udise === null && normUdise(r.udiseCode)) { e.udise = normUdise(r.udiseCode); byUdise.set(e.udise!, e); byFull.delete(`${e.name}|${e.district}|${e.state}|${e.pin}`); }
    note(merged, m);
    return m;
  };
  let skipped = 0;

  for (const r of input) {
    const udise = normUdise(r.udiseCode);
    const cand: Omit<Entry, "row"> = { udise, name: normText(r.schoolName), district: normText(r.district), state: normText(r.state), pin: normPin(r.pincode) };
    const mine: Entry = { row: r, ...cand };

    if (udise) {
      const same = byUdise.get(udise);
      if (same) { absorb(same, r, same.row.schoolName === r.schoolName ? "same UDISE code" : "same UDISE code (names differ)"); skipped++; continue; }
    } else {
      const exact = byFull.get(`${cand.name}|${cand.district}|${cand.state}|${cand.pin}`);
      if (exact) { absorb(exact, r, "same name, district, state and PIN code"); skipped++; continue; }
    }

    // Same name and PIN: a blank district or state does not make it a different school.
    const near = (byNamePin.get(`${cand.name}|${cand.pin}`) ?? []).filter((e) => blankOrEqual(e.district, cand.district) && blankOrEqual(e.state, cand.state));
    const sameSchool = near.filter((e) => !(e.udise && udise && e.udise !== udise)); // two different UDISE codes are two schools
    if (sameSchool.length === 1) {
      const e = sameSchool[0]!;
      absorb(e, r, udise && !e.udise ? "same name and PIN code (UDISE code added)" : "same name and PIN code (a district or state was blank)");
      skipped++;
      continue;
    }
    if (sameSchool.length > 1) {
      addPossible({ sheet: where(r), row: r.rowNumber, otherRow: sameSchool[0]!.row.rowNumber, reason: `same name and PIN code as ${sameSchool.length} schools with different UDISE codes; kept as a new school` });
    } else if (near.length) {
      addPossible({ sheet: where(r), row: r.rowNumber, otherRow: near[0]!.row.rowNumber, reason: "same name and PIN code but a different UDISE code; kept as a separate school" });
    }
    register(mine);
  }

  // Near-identical names inside one PIN code (different schools by identity, so never merged): listed for review.
  const byPin = new Map<string, Entry[]>();
  for (const e of entries) if (e.pin) (byPin.get(e.pin) ?? byPin.set(e.pin, []).get(e.pin)!).push(e);
  const seenPair = new Set(possible.map((p) => `${p.otherRow}:${p.row}`));
  for (const group of byPin.values()) {
    if (group.length < 2 || group.length > 400) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!, b = group[j]!;
        if (a.udise && a.udise === b.udise) continue;
        const s = similarity(a.name, b.name);
        if (s < NEAR_DUPLICATE_SIMILARITY) continue;
        if (seenPair.has(`${a.row.rowNumber}:${b.row.rowNumber}`) || seenPair.has(`${b.row.rowNumber}:${a.row.rowNumber}`)) continue;
        addPossible({ sheet: where(b.row), row: b.row.rowNumber, otherRow: a.row.rowNumber, reason: "very similar name in the same PIN code (not merged)", similarity: Math.round(s * 100) / 100 });
      }
    }
  }

  const rows = entries.map((e) => ({ ...e.row, dedupeKey: e.udise ? `u:${e.udise}` : `n:${e.name}|${e.district}|${e.state}|${e.pin}` }));
  return { rows, summary: { uniqueRows: rows.length, duplicatesSkipped: skipped, rowsFilled: filledRows, conflictRows, possibleDuplicates: possibleCount, merged, possible, truncated } };
}
