// Server-side parsing of an uploaded .xlsx or .csv into validated rows. Pure: no database, no network.
// Order of defence: file name -> size -> MIME type -> real content (magic bytes / text) -> zip-bomb check -> parse
// -> header detection -> required columns -> per-row validation. Anything unexpected becomes an UploadError with a
// message that is safe and useful to show to the admin.

import { parse as parseCsv } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
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
  rowNumber: number; // 1-based row in the file, for error messages
  schoolName: string;
  state: string;
  district: string;
  pincode: string;
  udiseCode: string;
  locationText: string; // lower-case search text: state, district, pincode and any other location columns
  data: Record<string, string>; // every column, keyed by normalised header
};
export type InvalidRow = { rowNumber: number; reason: string };
export type ParsedFile = {
  filename: string;
  sha256: string;
  headers: Header[];
  rows: ParsedRow[];
  invalidRows: InvalidRow[];
  invalidRowCount: number;
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
type Grid = { cells: unknown[][]; lines?: number[] }; // lines[i] = the line number in the file (CSV only; blank lines are skipped by the parser)

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

async function xlsxGrid(buf: Buffer): Promise<Grid> {
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
  const ws = wb.worksheets.find((w) => w.state === "visible" && w.rowCount > 0);
  if (!ws) throw new UploadError("EMPTY_FILE", "The workbook has no sheet with data.", 400);
  if (ws.actualRowCount > MAX_ROWS + HEADER_SCAN_ROWS + 2) {
    throw new UploadError("TOO_MANY_ROWS", `The file has more than ${MAX_ROWS.toLocaleString("en-IN")} rows. Split it into smaller files.`, 413);
  }
  const cols = Math.min(ws.columnCount, MAX_COLUMNS + 1);
  const grid: unknown[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: unknown[] = [];
    for (let c = 1; c <= cols; c++) cells.push(row.getCell(c).value); // a merged cell yields the value of its top-left cell
    grid.push(cells);
  }
  return { cells: grid };
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

  const { cells: grid, lines } = ext === "xlsx" ? await xlsxGrid(buffer) : csvGrid(buffer);
  const isBlank = (r: unknown[]) => r.every((c) => sanitizeCell(c) === "");

  // The header row is the first row (within the first few) that has a school-name column; failing that, the first non-empty row.
  let headerAt = -1;
  let fallback = -1;
  for (let i = 0; i < Math.min(grid.length, HEADER_SCAN_ROWS); i++) {
    if (isBlank(grid[i]!)) continue;
    if (fallback < 0) fallback = i;
    if (findColumn(normalizeHeaders(grid[i]!), "schoolName") >= 0) { headerAt = i; break; }
  }
  if (fallback < 0) throw new UploadError("EMPTY_FILE", "The file has no data.", 400);
  if (headerAt < 0) headerAt = fallback;

  let rawHeaders = grid[headerAt]!;
  while (rawHeaders.length && sanitizeCell(rawHeaders[rawHeaders.length - 1]) === "") rawHeaders = rawHeaders.slice(0, -1); // trailing empty columns
  if (rawHeaders.length > MAX_COLUMNS) throw new UploadError("TOO_MANY_COLUMNS", `The file has more than ${MAX_COLUMNS} columns.`, 400);
  const headers = normalizeHeaders(rawHeaders);

  const col = {
    school: findColumn(headers, "schoolName"), state: findColumn(headers, "state"), district: findColumn(headers, "district"),
    pincode: findColumn(headers, "pincode"), udise: findColumn(headers, "udise"), place: findColumn(headers, "place"),
  };
  const missing: string[] = [];
  if (col.school < 0) missing.push("School Name");
  if (col.district < 0 && col.pincode < 0 && col.place < 0) missing.push("a location column (District or Pincode)");
  if (missing.length) {
    throw new UploadError(
      "MISSING_COLUMNS",
      `The file was rejected because it is missing: ${missing.join(" and ")}. Columns found: ${headers.map((h) => h.label).join(", ") || "none"}.`,
      422,
      { missing, found: headers.map((h) => h.label) }
    );
  }

  const rows: ParsedRow[] = [];
  const invalidRows: InvalidRow[] = [];
  let invalidRowCount = 0;
  let dataRows = 0;
  const bad = (rowNumber: number, reason: string) => { invalidRowCount++; if (invalidRows.length < MAX_REPORTED_INVALID) invalidRows.push({ rowNumber, reason }); };

  for (let i = headerAt + 1; i < grid.length; i++) {
    const raw = grid[i]!;
    if (isBlank(raw)) continue; // empty rows are skipped silently
    if (++dataRows > MAX_ROWS) throw new UploadError("TOO_MANY_ROWS", `The file has more than ${MAX_ROWS.toLocaleString("en-IN")} data rows. Split it into smaller files.`, 413);
    const rowNumber = lines?.[i] ?? i + 1;
    const data: Record<string, string> = {};
    let tooLong = false;
    headers.forEach((h, c) => {
      const v = sanitizeCell(raw[c]);
      if (v.length > MAX_CELL_CHARS) tooLong = true;
      data[h.key] = v.slice(0, MAX_CELL_CHARS);
    });
    const at = (c: number) => (c >= 0 ? data[headers[c]!.key]! : "");
    const schoolName = at(col.school), state = at(col.state), district = at(col.district), pincode = at(col.pincode), place = at(col.place);
    if (tooLong) { bad(rowNumber, `A cell is longer than ${MAX_CELL_CHARS} characters`); continue; }
    if (!schoolName || schoolName === "'") { bad(rowNumber, "School name is empty"); continue; }
    if (!district && !pincode && !place) { bad(rowNumber, "No location (district, pincode) given"); continue; }
    if (pincode && !/^\d{6}$/.test(pincode)) { bad(rowNumber, "Pincode must be 6 digits"); continue; }
    rows.push({
      rowNumber, schoolName, state, district, pincode, udiseCode: at(col.udise).slice(0, 32),
      locationText: [state, district, pincode, place].filter(Boolean).join(" ").toLowerCase(),
      data,
    });
  }
  if (rows.length === 0) {
    throw new UploadError("NO_VALID_ROWS", invalidRowCount ? `The file was rejected: none of its ${invalidRowCount} rows are valid (for example the school name or location is empty).` : "The file has a header row but no data rows.", 422, { invalidRows });
  }
  return { filename, sha256: createHash("sha256").update(buffer).digest("hex"), headers, rows, invalidRows, invalidRowCount };
}
