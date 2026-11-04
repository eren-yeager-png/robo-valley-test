// Server-side parsing of an uploaded .xlsx or .csv into validated rows. Pure: no database, no network.
// Order of defence: file name -> size -> MIME type -> real content (magic bytes / text) -> zip-bomb check -> parse
// -> header detection -> required columns -> per-row validation. Anything unexpected becomes an UploadError with a
// message that is safe and useful to show to the admin.

import { parse as parseCsv } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { dedupeRows, type DedupeSummary, MAX_REPORT_ENTRIES, normPin } from "./dedupe";
import { type Header, MAX_CELL_CHARS, normalizeHeaders, sanitizeCell, sanitizeText } from "./sanitize";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 100_000;
export const MAX_COLUMNS = 100;
const MAX_UNZIPPED_BYTES = 150 * 1024 * 1024;
const HEADER_SCAN_ROWS = 10;
const MAX_REPORTED_INVALID = 100;

export class UploadError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: Record<string, unknown>) {
    super(message);
  }
}

// ---- header recognition ----------------------------------------------------------------------------------------
const ALIASES = {
  schoolName: ["school_name", "name_of_school", "name_of_the_school", "school", "institution_name", "institute_name", "institution", "school_college_name", "school_name_of_the_school"],
  state: ["state", "state_name", "state_ut"],
  district: ["district", "district_name", "dist"],
  pincode: ["pincode", "pin_code", "pin", "postal_code", "zip", "zip_code", "pincode_no"],
  udise: ["udise_code", "udise", "udise_no", "udise_number", "udise_code_11_digit", "school_code"],
  place: ["location", "city", "town", "village", "mandal", "block", "address", "area"],
} as const;
type Field = keyof typeof ALIASES;

function findColumn(headers: Header[], field: Field): number {
  for (const alias of ALIASES[field]) {
    const i = headers.findIndex((h) => h.key === alias);
    if (i >= 0) return i;
  }
  return -1;
}

export type ParsedRow = {
  sheet?: string; // the worksheet (xlsx only), so a row number can be found again in a workbook with several sheets
  rowNumber: number; // 1-based row in the file, for error messages
  schoolName: string;
  state: string;
  district: string;
  pincode: string;
  udiseCode: string;
  locationText: string; // lower-case search text: state, district, pincode and any other location columns
  data: Record<string, string>; // every column, keyed by normalised header
};
export type InvalidRow = { rowNumber: number; reason: string; sheet?: string };
export type ParsedFile = {
  filename: string;
  sha256: string;
  headers: Header[];
  /** The UNIQUE records: duplicates are already merged (see dedupe.ts). Each carries the key the database keeps unique. */
  rows: (ParsedRow & { dedupeKey: string })[];
  /** The first rows that were refused (kept short for the response); every refused row is in rejectedRows. */
  invalidRows: InvalidRow[];
  invalidRowCount: number;
  rejectedRows: InvalidRow[];
  /** Data rows seen in the file, before anything was merged or refused (empty rows, repeated headers and hidden rows are not counted). */
  rowsRead: number;
  /** Rows the spreadsheet hides (a filter, or hidden by hand). They are READ like any other row: a leftover filter must never drop most of a list. */
  hiddenRowsRead: number;
  repeatedHeaderRows: { rowNumber: number; sheet?: string }[];
  sheetsRead: string[];
  dedupe: DedupeSummary;
};

// ---- file-level checks ------------------------------------------------------------------------------------------
const XLSX_MIME = ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream", ""];
const CSV_MIME = ["text/csv", "application/csv", "text/x-csv", "application/vnd.ms-excel", "text/plain", "application/octet-stream", ""];

export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  return sanitizeText(base).replace(/^'/, "").slice(0, 255) || "upload";
}

function extensionOf(name: string): "xlsx" | "csv" {
  const m = /\.([A-Za-z0-9]+)$/.exec(name.trim());
  const ext = m?.[1]?.toLowerCase();
  if (ext === "xlsx" || ext === "csv") return ext;
  if (ext === "xls") throw new UploadError("UNSUPPORTED_FILE_TYPE", "Unsupported file type: legacy .xls files are not accepted. Open the file in Excel, choose Save As, and save it as .xlsx or .csv.", 415);
  throw new UploadError("UNSUPPORTED_FILE_TYPE", "Unsupported file type. Please upload an .xlsx or .csv file.", 415);
}

/** Total uncompressed size declared by the zip's central directory, so a tiny "zip bomb" is refused before it is unpacked. */
function declaredUnzippedBytes(buf: Buffer): number {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new UploadError("INVALID_FILE_CONTENT", "The file is not a valid .xlsx workbook (it is damaged or not a real Excel file).", 400);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new UploadError("INVALID_FILE_CONTENT", "The file is not a valid .xlsx workbook (it is damaged).", 400);
    total += buf.readUInt32LE(p + 24);
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return total;
}

function decodeCsv(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "");
  } catch {
    throw new UploadError("INVALID_ENCODING", "The CSV file is not valid UTF-8. In Excel choose Save As > \"CSV UTF-8 (Comma delimited)\" and upload that file.", 400);
  }
}

// ---- reading rows ----------------------------------------------------------------------------------------------
// One Grid per worksheet (a CSV is one grid). lines[i] = the line number in the file (CSV only; blank lines are skipped by the parser).
// hidden[i] = the spreadsheet program hides that row (xlsx only).
type Grid = { name?: string; cells: unknown[][]; lines?: number[]; hidden?: boolean[] };

function csvGrid(buf: Buffer): Grid {
  if (buf[0] === 0x50 && buf[1] === 0x4b) throw new UploadError("INVALID_FILE_CONTENT", "This looks like an Excel workbook saved with a .csv name. Save it as .xlsx, or export a real CSV.", 400);
  const text = decodeCsv(buf);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text.slice(0, 8192))) throw new UploadError("INVALID_FILE_CONTENT", "The file is not a text CSV (it contains binary data).", 400);
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = ([",", ";", "\t"] as const).map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  try {
    const recs = parseCsv(text, { delimiter, relax_column_count: true, relax_quotes: true, skip_empty_lines: true, info: true, to: MAX_ROWS + HEADER_SCAN_ROWS + 2 }) as unknown as Array<{ record: unknown[]; info: { lines: number } }>;
    return { cells: recs.map((r) => r.record), lines: recs.map((r) => r.info.lines) };
  } catch {
    throw new UploadError("MALFORMED_FILE", "The CSV file could not be read (for example an opening quote is never closed). Please check the file and try again.", 400);
  }
}

async function xlsxGrids(buf: Buffer): Promise<Grid[]> {
  if (!(buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04)) {
    throw new UploadError("INVALID_FILE_CONTENT", "The file is not a real .xlsx workbook (its content does not match its extension).", 400);
  }
  if (declaredUnzippedBytes(buf) > MAX_UNZIPPED_BYTES) throw new UploadError("FILE_TOO_LARGE", "The workbook is too large once unpacked.", 413);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as never);
  } catch {
    throw new UploadError("MALFORMED_FILE", "The workbook could not be opened. It may be damaged or password-protected.", 400);
  }
  // Every visible sheet that has data is read; hidden and empty sheets are ignored.
  const sheets = wb.worksheets.filter((w) => w.state === "visible" && w.rowCount > 0);
  if (sheets.length === 0) throw new UploadError("EMPTY_FILE", "The workbook has no sheet with data.", 400);
  let total = 0;
  for (const ws of sheets) total += ws.actualRowCount;
  if (total > MAX_ROWS + (HEADER_SCAN_ROWS + 2) * sheets.length) {
    throw new UploadError("TOO_MANY_ROWS", `The file has more than ${MAX_ROWS.toLocaleString("en-IN")} rows. Split it into smaller files.`, 413);
  }
  return sheets.map((ws) => {
    const cols = Math.min(ws.columnCount, MAX_COLUMNS + 1);
    const cells: unknown[][] = [];
    const hidden: boolean[] = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const line: unknown[] = [];
      for (let c = 1; c <= cols; c++) line.push(row.getCell(c).value); // a merged cell yields the value of its top-left cell
      cells.push(line);
      hidden.push(row.hidden === true);
    }
    return { name: ws.name, cells, hidden };
  });
}

// ---- main entry --------------------------------------------------------------------------------------------------
export async function parseUpload(input: { filename: string; mime: string; buffer: Buffer }): Promise<ParsedFile> {
  const filename = safeFilename(input.filename);
  const ext = extensionOf(input.filename);
  const { buffer } = input;
  if (buffer.length === 0) throw new UploadError("EMPTY_FILE", "The file is empty.", 400);
  if (buffer.length > MAX_FILE_BYTES) throw new UploadError("FILE_TOO_LARGE", `The file is larger than the ${MAX_FILE_BYTES / 1024 / 1024} MB limit.`, 413);
  const mime = input.mime.split(";")[0]!.trim().toLowerCase();
  if (!(ext === "xlsx" ? XLSX_MIME : CSV_MIME).includes(mime)) {
    throw new UploadError("UNSUPPORTED_FILE_TYPE", `Unsupported file type (${mime || "unknown"}). Please upload an .xlsx or .csv file.`, 415);
  }

  const grids: Grid[] = ext === "xlsx" ? await xlsxGrids(buffer) : [csvGrid(buffer)];
  const multi = grids.length > 1;

  const rows: ParsedRow[] = [];
  const rejectedRows: InvalidRow[] = [];
  const invalidRows: InvalidRow[] = [];
  const repeatedHeaderRows: { rowNumber: number; sheet?: string }[] = [];
  const headers: Header[] = [];
  const sheetsRead: string[] = [];
  let invalidRowCount = 0, dataRows = 0, hiddenRowsRead = 0;
  let sheetError: UploadError | null = null;
  let anyData = false;

  for (const grid of grids) {
    const { cells, lines, hidden } = grid;
    const sheet = multi ? grid.name : undefined;
    const isBlank = (r: unknown[]) => r.every((c) => sanitizeCell(c) === "");

    // The header row is the first row (within the first few) that has a school-name column; failing that, the first non-empty row.
    let headerAt = -1;
    let fallback = -1;
    for (let i = 0; i < Math.min(cells.length, HEADER_SCAN_ROWS); i++) {
      if (isBlank(cells[i]!)) continue;
      if (fallback < 0) fallback = i;
      if (findColumn(normalizeHeaders(cells[i]!), "schoolName") >= 0) { headerAt = i; break; }
    }
    if (fallback < 0) continue; // an empty sheet
    anyData = true;
    if (headerAt < 0) headerAt = fallback;

    let rawHeaders = cells[headerAt]!;
    while (rawHeaders.length && sanitizeCell(rawHeaders[rawHeaders.length - 1]) === "") rawHeaders = rawHeaders.slice(0, -1); // trailing empty columns
    if (rawHeaders.length > MAX_COLUMNS) throw new UploadError("TOO_MANY_COLUMNS", `The file has more than ${MAX_COLUMNS} columns.`, 400);
    const sheetHeaders = normalizeHeaders(rawHeaders);

    const col = {
      school: findColumn(sheetHeaders, "schoolName"), state: findColumn(sheetHeaders, "state"), district: findColumn(sheetHeaders, "district"),
      pincode: findColumn(sheetHeaders, "pincode"), udise: findColumn(sheetHeaders, "udise"), place: findColumn(sheetHeaders, "place"),
    };
    const missing: string[] = [];
    if (col.school < 0) missing.push("School Name");
    if (col.district < 0 && col.pincode < 0 && col.place < 0) missing.push("a location column (District or Pincode)");
    if (missing.length) {
      // With several sheets, one without school data (a notes sheet, say) is skipped; the file is only refused when no sheet is usable.
      sheetError ??= new UploadError(
        "MISSING_COLUMNS",
        `The file was rejected because it is missing: ${missing.join(" and ")}. Columns found: ${sheetHeaders.map((h) => h.label).join(", ") || "none"}.`,
        422,
        { missing, found: sheetHeaders.map((h) => h.label) }
      );
      if (multi) continue;
      throw sheetError;
    }
    sheetsRead.push(grid.name ?? "csv");
    for (const h of sheetHeaders) if (!headers.some((x) => x.key === h.key)) headers.push(h);

    const schoolLabel = (sheetHeaders[col.school]!.label ?? "").toLowerCase();
    const bad = (rowNumber: number, reason: string) => {
      invalidRowCount++;
      const item: InvalidRow = { rowNumber, reason, ...(sheet ? { sheet } : {}) };
      if (invalidRows.length < MAX_REPORTED_INVALID) invalidRows.push(item);
      if (rejectedRows.length < MAX_REPORT_ENTRIES) rejectedRows.push(item);
    };

    for (let i = headerAt + 1; i < cells.length; i++) {
      const raw = cells[i]!;
      if (isBlank(raw)) continue; // empty rows are skipped silently
      const rowNumber = lines?.[i] ?? i + 1;
      if (hidden?.[i]) hiddenRowsRead++; // counted and reported, but still read: an Excel filter left switched on hides rows without deleting them
      // A header row repeated further down (a file pasted together from several parts) is not a school.
      if (schoolLabel !== "" && sanitizeCell(raw[col.school]).replace(/^'/, "").toLowerCase() === schoolLabel) {
        repeatedHeaderRows.push({ rowNumber, ...(sheet ? { sheet } : {}) });
        continue;
      }
      if (++dataRows > MAX_ROWS) throw new UploadError("TOO_MANY_ROWS", `The file has more than ${MAX_ROWS.toLocaleString("en-IN")} data rows. Split it into smaller files.`, 413);
      const data: Record<string, string> = {};
      let tooLong = false;
      sheetHeaders.forEach((h, c) => {
        const v = sanitizeCell(raw[c]);
        if (v.length > MAX_CELL_CHARS) tooLong = true;
        data[h.key] = v.slice(0, MAX_CELL_CHARS);
      });
      const at = (c: number) => (c >= 0 ? data[sheetHeaders[c]!.key]! : "");
      const schoolName = at(col.school), state = at(col.state), district = at(col.district), place = at(col.place);
      // "110001.0" and "110 001" are the same PIN code as "110001"; the cleaned value is what is stored.
      const pincode = normPin(at(col.pincode));
      if (col.pincode >= 0 && pincode !== at(col.pincode)) data[sheetHeaders[col.pincode]!.key] = pincode;
      if (tooLong) { bad(rowNumber, `A cell is longer than ${MAX_CELL_CHARS} characters`); continue; }
      if (!schoolName || schoolName === "'") { bad(rowNumber, "School name is empty"); continue; }
      if (!district && !pincode && !place) { bad(rowNumber, "No location (district, pincode) given"); continue; }
      if (pincode && !/^\d{6}$/.test(pincode)) { bad(rowNumber, "Pincode must be 6 digits"); continue; }
      rows.push({
        ...(sheet ? { sheet } : {}), rowNumber, schoolName, state, district, pincode, udiseCode: at(col.udise).slice(0, 32),
        locationText: [state, district, pincode, place].filter(Boolean).join(" ").toLowerCase(),
        data,
      });
    }
  }
  if (!anyData) throw new UploadError("EMPTY_FILE", "The file has no data.", 400);
  if (sheetsRead.length === 0 && sheetError) throw sheetError;
  if (rows.length === 0) {
    throw new UploadError("NO_VALID_ROWS", invalidRowCount ? `The file was rejected: none of its ${invalidRowCount} rows are valid (for example the school name or location is empty).` : "The file has a header row but no data rows.", 422, { invalidRows });
  }
  const { rows: unique, summary } = dedupeRows(rows);
  return {
    filename, sha256: createHash("sha256").update(buffer).digest("hex"), headers, rows: unique, invalidRows, invalidRowCount, rejectedRows,
    rowsRead: dataRows, hiddenRowsRead, repeatedHeaderRows, sheetsRead, dedupe: summary,
  };
}
