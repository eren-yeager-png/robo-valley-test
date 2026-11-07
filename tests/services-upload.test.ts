// Admin-only spreadsheet upload, atomic dataset replacement and public search. Real routes and real SQL on the in-process
// PostgreSQL (PGlite); no real database, no network.
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakePool, seedUser, testDb } from "./helpers";
import { createSessionToken } from "../src/lib/session";

const m = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "rv_session" && m.cookie ? { name: n, value: m.cookie } : undefined) }),
}));

import { POST as upload, OPTIONS as uploadOptions } from "../src/app/api/services/upload/route";
import { POST as confirm } from "../src/app/api/services/upload/confirm/route";
import { GET as search } from "../src/app/api/services/search/route";
import { GET as me } from "../src/app/api/auth/me/route";
import { MAX_FILE_BYTES, UPLOAD_MULTIPART_OVERHEAD, uploadTooLargeMessage, VERCEL_BODY_LIMIT_BYTES } from "../src/lib/spreadsheet/parse";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const tokenFor = (id: string, role: string) => createSessionToken({ id, role }, false, Date.now(), { SESSION_SECRET: SECRET } as never).token;
const signIn = (id: string, role: string) => { m.cookie = tokenFor(id, role); };

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
type F = { name: string; type: string; data: Buffer | string };
const csv = (text: string, name = "schools.csv"): F => ({ name, type: "text/csv", data: text });
const uploadReq = (f: F, headers: Record<string, string> = {}, category = "atl-labs") => {
  const fd = new FormData();
  fd.set("file", new File([f.data as BlobPart], f.name, { type: f.type }));
  fd.set("category", category); // the category is now required on every upload
  return new Request("http://localhost/api/services/upload", { method: "POST", body: fd, headers });
};
const confirmReq = (datasetId: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/services/upload/confirm", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ datasetId }) });
const searchReq = (qs = "") => new Request("http://localhost/api/services/search" + qs);
const sql = async (q: string, p?: unknown[]) => (await testDb().raw.query(q, p as never)).rows as any[];

async function xlsxFile(rows: unknown[][], name = "schools.xlsx", tweak?: (ws: ExcelJS.Worksheet) => void): Promise<F> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  rows.forEach((r) => ws.addRow(r));
  tweak?.(ws);
  return { name, type: XLSX, data: Buffer.from(await wb.xlsx.writeBuffer()) };
}

const HEAD = "School Name,State,District,Pincode,UDISE Code\n";
const SET_A = csv(HEAD + [
  "Kendriya Vidyalaya,Andhra Pradesh,Guntur,522005,28172601012",
  "A P Model School,Andhra Pradesh,Visakhapatnam,530048,28133800334",
  "Sri Prakash Vidya Niketan,Andhra Pradesh,Visakhapatnam,531126,28133800201",
  "Zilla Parishad High School,Andhra Pradesh,East Godavari,533286,28141701105",
].join("\n"));
const SET_B = csv(HEAD + ["Brand New School,Telangana,Hyderabad,500001,36000000001", "Another New School,Telangana,Warangal,506002,36000000002"].join("\n"));

let admin: { id: string }; let user: { id: string };
let logs: string[];
beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  m.cookie = undefined;
  logs = [];
  for (const fn of ["log", "error", "warn", "info"] as const) vi.spyOn(console, fn).mockImplementation((...a) => void logs.push(a.map(String).join(" ")));
  admin = await seedUser({ email: "ai@symbiosystech.com", role: "admin" });
  user = await seedUser({ email: "asha@example.com", role: "ST" });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

/** Admin uploads and confirms a file; returns the dataset id. */
async function goLive(f: F): Promise<string> {
  signIn(admin.id, "admin");
  const up = await (await upload(uploadReq(f))).json();
  expect(up.success, JSON.stringify(up)).toBe(true);
  const ok = await confirm(confirmReq(up.datasetId));
  expect(ok.status).toBe(200);
  return up.datasetId;
}
const names = async (qs = "") => ((await (await search(searchReq(qs))).json()).results as any[]).map((r) => r.schoolName);

describe("who may upload (checked on the server)", () => {
  it("anonymous: 401 on upload and confirm, and nothing is written", async () => {
    expect((await upload(uploadReq(SET_A))).status).toBe(401);
    expect((await confirm(confirmReq("1"))).status).toBe(401);
    expect(await sql("select count(*)::int n from service_datasets")).toEqual([{ n: 0 }]);
  });

  it("a signed-in regular user: 403 on upload and confirm, and nothing is written", async () => {
    signIn(user.id, "ST");
    expect((await upload(uploadReq(SET_A))).status).toBe(403);
    expect((await confirm(confirmReq("1"))).status).toBe(403);
    expect(await sql("select count(*)::int n from service_datasets")).toEqual([{ n: 0 }]);
  });

  it("a token that CLAIMS admin for a non-admin account is still 403 (the role comes from the database)", async () => {
    signIn(user.id, "admin");
    expect((await upload(uploadReq(SET_A, { "x-role": "admin" }))).status).toBe(403);
  });

  it("a forged or tampered cookie is 401", async () => {
    m.cookie = tokenFor(admin.id, "admin").slice(0, -3) + "AAA";
    expect((await upload(uploadReq(SET_A))).status).toBe(401);
  });

  it("an admin can upload and gets a preview (row count, columns, invalid rows)", async () => {
    signIn(admin.id, "admin");
    const res = await upload(uploadReq(SET_A));
    const b = await res.json();
    expect(res.status).toBe(200);
    expect(b).toMatchObject({ success: true, rowCount: 4, invalidRowCount: 0, filename: "schools.csv" });
    expect(b.columns).toEqual(["School Name", "State", "District", "Pincode", "UDISE Code"]);
    expect(b.preview).toHaveLength(4);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("a browser request from an origin that is not allowed is refused, even for an admin", async () => {
    signIn(admin.id, "admin");
    expect((await upload(uploadReq(SET_A, { origin: "https://evil.example" }))).status).toBe(403);
    vi.stubEnv("ALLOWED_ORIGINS", "http://localhost:8080");
    expect((await upload(uploadReq(SET_A, { origin: "https://evil.example" }))).status).toBe(403);
  });

  it("an allowed origin (from ALLOWED_ORIGINS) gets CORS with credentials; preflight answers it", async () => {
    vi.stubEnv("ALLOWED_ORIGINS", "http://localhost:8080, https://techytree.in/");
    signIn(admin.id, "admin");
    const res = await upload(uploadReq(SET_A, { origin: "http://localhost:8080" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:8080");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    const pre = uploadOptions(new Request("http://localhost/api/services/upload", { method: "OPTIONS", headers: { origin: "https://techytree.in" } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://techytree.in");
    const bad = uploadOptions(new Request("http://localhost/api/services/upload", { method: "OPTIONS", headers: { origin: "https://evil.example" } }));
    expect(bad.status).toBe(403);
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("/api/auth/me returns only the role and the FIRST name: admin, user, or signed out", async () => {
    signIn(admin.id, "admin");
    expect(await (await me(new Request("http://localhost/api/auth/me"))).json()).toEqual({ role: "admin", firstName: "Asha" });
    signIn(user.id, "ST");
    expect(await (await me(new Request("http://localhost/api/auth/me"))).json()).toEqual({ role: "user", firstName: "Asha" });
    m.cookie = undefined;
    expect(await (await me(new Request("http://localhost/api/auth/me"))).json()).toEqual({ role: null, firstName: null });
  });

  it("/api/auth/me never includes the full name, email or id, and keeps the CORS allow-list", async () => {
    signIn(admin.id, "admin");
    const res = await me(new Request("http://localhost/api/auth/me", { headers: { origin: "https://techytree.in" } }));
    const text = await res.text();
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["firstName", "role"]);
    expect(text).not.toMatch(/Rao|@|"id"/);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://techytree.in");
    const other = await me(new Request("http://localhost/api/auth/me", { headers: { origin: "https://example.com" } }));
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("file validation (everything is rejected with a clear message and nothing is stored)", () => {
  const rejected = async (f: F, status: number, msg: RegExp, code?: string) => {
    signIn(admin.id, "admin");
    const res = await upload(uploadReq(f));
    const b = await res.json();
    expect(res.status, JSON.stringify(b)).toBe(status);
    expect(b.success).toBe(false);
    expect(b.message).toMatch(msg);
    if (code) expect(b.error).toBe(code);
    expect(await sql("select count(*)::int n from service_datasets")).toEqual([{ n: 0 }]);
    return b;
  };

  it("legacy .xls is refused with an explanation", async () => {
    await rejected({ name: "old.xls", type: "application/vnd.ms-excel", data: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]) }, 415, /\.xls.*not accepted|legacy/i, "UNSUPPORTED_FILE_TYPE");
  });
  it("other extensions are refused (.txt, .pdf, .exe, double extensions, no extension)", async () => {
    for (const name of ["a.txt", "a.pdf", "a.exe", "a.csv.exe", "noextension", "a.xlsx.php"]) {
      await rejected({ name, type: "application/octet-stream", data: "x" }, 415, /Unsupported file type/);
    }
  });
  it("a wrong MIME type is refused even when the extension is right", async () => {
    await rejected({ name: "a.csv", type: "image/png", data: SET_A.data }, 415, /Unsupported file type \(image\/png\)/);
    await rejected({ name: "a.xlsx", type: "text/html", data: "x" }, 415, /Unsupported file type/);
  });
  it("an .xlsx that is not really a workbook is refused (content sniffing)", async () => {
    await rejected({ name: "a.xlsx", type: XLSX, data: "School Name,District\nX,Y" }, 400, /not a real \.xlsx/, "INVALID_FILE_CONTENT");
  });
  it("a .csv that is really a zip/xlsx, or contains binary data, is refused", async () => {
    await rejected({ name: "a.csv", type: "text/csv", data: Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]) }, 400, /Excel workbook saved with a \.csv name/);
    await rejected({ name: "a.csv", type: "text/csv", data: Buffer.from("School Name,District\n\u0000\u0001\u0002,x") }, 400, /binary/);
  });
  it("a CSV that is not UTF-8 is refused with the way to fix it", async () => {
    await rejected({ name: "a.csv", type: "text/csv", data: Buffer.from([0x53, 0x63, 0x68, 0x6f, 0x6f, 0x6c, 0x2c, 0xe9, 0xff, 0x0a]) }, 400, /not valid UTF-8.*CSV UTF-8/, "INVALID_ENCODING");
  });
  it("an empty file, or a header with no rows, is refused", async () => {
    await rejected(csv(""), 400, /empty/i);
    await rejected(csv("School Name,District\n"), 422, /no data rows/);
  });
  it("a file over 4 MB is refused with a clear message (even without a Content-Length header)", async () => {
    const b = await rejected({ name: "big.csv", type: "text/csv", data: Buffer.alloc(5 * 1024 * 1024, 97) }, 413, /4 MB/, "FILE_TOO_LARGE");
    expect(b.message).toBe("The file is larger than the 4 MB limit. Please remove unused rows or columns, or split it into two files, and try again.");
  });
  it("a file just over 4 MB is refused too (4.1 MB)", async () => {
    await rejected({ name: "big.csv", type: "text/csv", data: Buffer.alloc(Math.round(4.1 * 1024 * 1024), 97) }, 413, /4 MB/, "FILE_TOO_LARGE");
  });
  it("the stated limit, the form allowance and the hosting limit stay in step (Vercel refuses bodies over 4.5 MB)", () => {
    expect(MAX_FILE_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_FILE_BYTES + UPLOAD_MULTIPART_OVERHEAD).toBeLessThan(VERCEL_BODY_LIMIT_BYTES);
    expect(VERCEL_BODY_LIMIT_BYTES).toBe(4.5 * 1024 * 1024);
    expect(uploadTooLargeMessage()).toContain("4 MB");
  });
  it("the upload widget and the admin form say the same 4 MB (no stale 10 MB anywhere)", () => {
    const widget = readFileSync(resolve("frontend/elementor/find-a-service-510/widgets/04-upload-button.a51f0e2.html"), "utf8");
    expect(widget).toContain("var MAX_BYTES = 4 * 1024 * 1024;");
    expect(widget).toContain("Maximum 4 MB and 100,000 rows.");
    expect(widget).toContain("The file is larger than the 4 MB limit. Please remove unused rows or columns, or split it into two files, and try again.");
    expect(widget).not.toMatch(/10 MB/);
    expect(readFileSync(resolve("src/app/admin/_components/UploadForm.tsx"), "utf8")).toContain("const DATASET_MAX = 4 * 1024 * 1024;");
  });
  it("missing school name: the WHOLE file is rejected and the message says exactly what is missing", async () => {
    const b = await rejected(csv("Foo,District\nx,Guntur"), 422, /missing: School Name\./, "MISSING_COLUMNS");
    expect(b.missing).toEqual(["School Name"]);
    expect(b.found).toEqual(["Foo", "District"]);
  });
  it("missing location columns: rejected", async () => {
    await rejected(csv("School Name,State\nx,AP"), 422, /missing: a location column \(District or Pincode\)/);
  });
  it("missing both: both are named", async () => {
    await rejected(csv("Foo,Bar\n1,2"), 422, /School Name and a location column/);
  });
  it("a file where no row is valid is rejected", async () => {
    await rejected(csv("School Name,District\n,Guntur\nX,"), 422, /none of its 2 rows are valid/, "NO_VALID_ROWS");
  });
  it("a body that is not multipart, or has no file, is a clear 4xx", async () => {
    signIn(admin.id, "admin");
    const r1 = await upload(new Request("http://localhost/api/services/upload", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(r1.status).toBe(415);
    const fd = new FormData(); fd.set("note", "no file here");
    const r2 = await upload(new Request("http://localhost/api/services/upload", { method: "POST", body: fd }));
    expect(r2.status).toBe(400);
    expect((await r2.json()).message).toMatch(/Choose a file/);
  });
  it("every outcome is logged: rejected uploads appear in the audit log with who and why", async () => {
    signIn(admin.id, "admin");
    await upload(uploadReq({ name: "bad.txt", type: "text/plain", data: "x" }));
    await upload(uploadReq(SET_A));
    const log = await sql("select user_id::text u, action, result, filename, detail from upload_audit_log order by id");
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ u: admin.id, action: "upload", result: "rejected" });
    expect(log[0].detail).toMatch(/UNSUPPORTED_FILE_TYPE/);
    expect(log[1]).toMatchObject({ u: admin.id, action: "upload", result: "success", filename: "schools.csv" });
  });
});

describe("parsing: headers, cells, encodings, merged cells", () => {
  const rowsOf = async (id: string) => sql("select row_number, school_name, state, district, pincode, udise_code, data from service_dataset_rows where dataset_id = $1 order by row_number", [id]);
  const stage = async (f: F) => { signIn(admin.id, "admin"); const b = await (await upload(uploadReq(f))).json(); expect(b.success, JSON.stringify(b)).toBe(true); return b; };

  it("normalises headers (case, spaces, aliases, duplicates, empty) and keeps every column", async () => {
    const b = await stage(csv("  SCHOOL   name ,, Dist ,PIN Code,Remarks,Remarks\nSri Sai School,x,Guntur,522001,a,b\n"));
    expect(b.columns).toEqual(["SCHOOL name", "Column 2", "Dist", "PIN Code", "Remarks", "Remarks"]);
    const [r] = await rowsOf(b.datasetId);
    expect(r).toMatchObject({ school_name: "Sri Sai School", district: "Guntur", pincode: "522001" });
    expect(r.data).toEqual({ school_name: "Sri Sai School", column_2: "x", dist: "Guntur", pin_code: "522001", remarks: "a", remarks_2: "b" });
  });

  it("trims whitespace, skips empty rows, and reports invalid rows with their row number", async () => {
    const b = await stage(csv(HEAD + "  Good School  ,AP,  Guntur ,522001,1\n\n,,,,\n,AP,Guntur,522001,2\nBad Pin,AP,Guntur,12ab,3\nNo Location,AP,,,4\nLast School,AP,Krishna,521001,5\n"));
    expect(b.rowCount).toBe(2);
    expect(b.invalidRowCount).toBe(3);
    expect(b.invalidRows).toEqual([
      { row: 5, rowNumber: 5, reason: "School name is empty" },
      { row: 6, rowNumber: 6, reason: "Pincode must be 6 digits" },
      { row: 7, rowNumber: 7, reason: "No location (district, pincode) given" },
    ]);
    const rows = await rowsOf(b.datasetId);
    expect(rows.map((r) => r.school_name)).toEqual(["Good School", "Last School"]);
    expect(rows[0].district).toBe("Guntur");
  });

  it("neutralises spreadsheet formula injection and strips HTML / script, in every column", async () => {
    const b = await stage(csv(HEAD + [
      "=HYPERLINK(\"http://evil\"),AP,Guntur,522001,1",
      "+cmd|' /C calc'!A0,AP,Guntur,522001,2",
      "-2+3,AP,Guntur,522001,3",
      "@SUM(1+1),AP,Guntur,522001,4",
      "<script>alert(1)</script>Evil <b>School</b>,AP,<img src=x onerror=alert(1)>Guntur,522001,5",
      "\"O'Brien\"\"s School; DROP TABLE users;--\",AP,Guntur,522001,6",
      "-12.5,AP,Guntur,522001,7",
    ].join("\n")));
    const rows = await rowsOf(b.datasetId);
    expect(rows[0].school_name).toBe("'=HYPERLINK(\"http://evil\")");
    expect(rows[1].school_name.startsWith("'+cmd")).toBe(true);
    expect(rows[2].school_name).toBe("'-2+3");
    expect(rows[3].school_name).toBe("'@SUM(1+1)");
    expect(rows[4].school_name).toBe("alert(1) Evil School");
    expect(rows[4].district).toBe("Guntur");
    expect(JSON.stringify(rows.map((r) => r.data))).not.toMatch(/[<>]/);
    expect(rows[5].school_name).toContain("DROP TABLE users;--"); // stored as inert text
    expect(rows[6].school_name).toBe("-12.5"); // a plain number is not a formula
    expect(await sql("select count(*)::int n from users")).toEqual([{ n: 2 }]); // users table intact
  });

  it("handles a UTF-8 BOM, a semicolon delimiter, quotes with commas and Indian-language text", async () => {
    const b = await stage(csv("﻿School Name;District;Pincode\n\"ZPHS, Kothapeta\";Guntur;522001\nశ్రీ సాయి పాఠశాల;గుంటూరు;522002\n"));
    const rows = await rowsOf(b.datasetId);
    expect(rows.map((r) => r.school_name)).toEqual(["ZPHS, Kothapeta", "శ్రీ సాయి పాఠశాల"]);
    expect(rows[1].district).toBe("గుంటూరు");
  });

  it("reads UTF-16 CSV exported by Excel", async () => {
    const text = "School Name,District\r\nUTF Sixteen School,Guntur\r\n";
    const b = await stage({ name: "u16.csv", type: "text/csv", data: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]) });
    expect(b.rowCount).toBe(1);
  });

  it("reads a real .xlsx: numbers become text, formula cells keep their value, merged cells fill down, blank rows are skipped", async () => {
    const f = await xlsxFile([
      ["School Name", "State", "District", "Pincode", "UDISE Code"],
      ["Alpha School", "Andhra Pradesh", "Guntur", 522001, 28172601012],
      ["Beta School", null, "Guntur", 522002, 28172601013],
      [null, null, null, null, null],
      ["Gamma School", null, "Krishna", { formula: "521000+1", result: 521001 }, 28172601014],
    ], "schools.xlsx", (ws) => ws.mergeCells("B2:B5"));
    const b = await stage(f);
    expect(b.rowCount).toBe(3);
    const rows = await rowsOf(b.datasetId);
    expect(rows.map((r) => r.pincode)).toEqual(["522001", "522002", "521001"]);
    expect(rows.map((r) => r.udise_code)).toEqual(["28172601012", "28172601013", "28172601014"]);
    expect(rows.map((r) => r.state)).toEqual(["Andhra Pradesh", "Andhra Pradesh", "Andhra Pradesh"]);
  });

  it("finds the header row below a title row, and ignores a sample's hash/serial columns without losing them", async () => {
    const f = await xlsxFile([
      ["Operational ATLs Tranche 1"],
      [],
      ["S.No", "State", "District", "School Name", "Pincode", "Match"],
      [73, "ANDHRA PRADESH", "EAST GODAVARI", "ASHRAM PUBLIC SCHOOL", 533003, "UDISE code match"],
    ]);
    const b = await stage(f);
    expect(b.columns).toEqual(["S.No", "State", "District", "School Name", "Pincode", "Match"]);
    const [r] = await rowsOf(b.datasetId);
    expect(r.data).toMatchObject({ s_no: "73", match: "UDISE code match", school_name: "ASHRAM PUBLIC SCHOOL" });
  });

  it("refuses a zip bomb (tiny file, huge declared size)", async () => {
    const { deflateRawSync } = await import("node:zlib");
    // one entry claiming 400 MB uncompressed, hand-built zip
    const name = Buffer.from("xl/sharedStrings.xml");
    const data = deflateRawSync(Buffer.alloc(1024));
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(400 * 1024 * 1024, 24); cd.writeUInt16LE(name.length, 28);
    const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
    const cdOffset = lh.length + name.length + data.length;
    eocd.writeUInt32LE(cd.length + name.length, 12); eocd.writeUInt32LE(cdOffset, 16);
    const zip = Buffer.concat([lh, name, data, cd, name, eocd]);
    signIn(admin.id, "admin");
    const res = await upload(uploadReq({ name: "bomb.xlsx", type: XLSX, data: zip }));
    expect(res.status).toBe(413);
    expect((await res.json()).message).toMatch(/too large once unpacked/);
  });
});

describe("atomic replacement", () => {
  it("nothing is searchable until the admin confirms (staged data is invisible)", async () => {
    signIn(admin.id, "admin");
    await upload(uploadReq(SET_A));
    expect((await (await search(searchReq())).json()).dataset).toBeNull();
    expect(await names()).toEqual([]);
  });

  it("confirm makes the upload live; a re-upload replaces it completely; old versions are kept for audit", async () => {
    const a = await goLive(SET_A);
    expect(await names()).toHaveLength(4);
    signIn(admin.id, "admin");
    const b = (await (await upload(uploadReq(SET_B))).json()).datasetId;
    // staged but not confirmed: users still see ONLY the old data, never a mixture
    expect((await names()).sort()).toEqual(["A P Model School", "Kendriya Vidyalaya", "Sri Prakash Vidya Niketan", "Zilla Parishad High School"]);
    expect((await confirm(confirmReq(b))).status).toBe(200);
    expect((await names()).sort()).toEqual(["Another New School", "Brand New School"]);
    expect(await sql("select id::text id, status, row_count from service_datasets order by id")).toEqual([
      { id: a, status: "superseded", row_count: 4 },
      { id: b, status: "active", row_count: 2 },
    ]);
    expect(await sql("select count(*)::int n from service_dataset_rows where dataset_id = $1", [a])).toEqual([{ n: 4 }]); // old rows kept
    const log = await sql("select action, result from upload_audit_log order by id");
    expect(log.map((l) => `${l.action}:${l.result}`)).toEqual(["upload:success", "confirm:success", "upload:success", "confirm:success"]);
  });

  it("if the switch fails part-way it rolls back: the previous dataset stays live and the new one stays staged", async () => {
    await goLive(SET_A);
    signIn(admin.id, "admin");
    const b = (await (await upload(uploadReq(SET_B))).json()).datasetId;
    makeFakePool((q) => (/SET status = 'active'/.test(q) ? new Error("simulated crash") : undefined));
    const res = await confirm(confirmReq(b));
    expect(res.status).toBe(500);
    expect((await res.json()).message).toMatch(/rolled back.*previous data is still live/);
    testDb().failOn(undefined);
    expect(await names()).toHaveLength(4);
    expect(await names("?q=kendriya")).toEqual(["Kendriya Vidyalaya"]);
    expect(await sql("select status, count(*)::int n from service_datasets group by status order by status")).toEqual([{ status: "active", n: 1 }, { status: "staged", n: 1 }]);
    expect((await confirm(confirmReq(b))).status).toBe(200); // and a retry works
    expect(await names()).toHaveLength(2);
  });

  it("if staging fails part-way (rows insert crashes) nothing is left behind and the live data is untouched", async () => {
    await goLive(SET_A);
    signIn(admin.id, "admin");
    makeFakePool((q) => (/INSERT INTO service_dataset_rows/.test(q) ? new Error("disk full") : undefined));
    const res = await upload(uploadReq(SET_B));
    expect(res.status).toBe(500);
    testDb().failOn(undefined);
    expect(await sql("select status, count(*)::int n from service_datasets group by status")).toEqual([{ status: "active", n: 1 }]);
    expect(await names()).toHaveLength(4);
    expect(logs.join("\n")).not.toMatch(/disk full/); // internals are not echoed to logs/clients
  });

  it("the database itself allows only one active dataset", async () => {
    const a = await goLive(SET_A);
    signIn(admin.id, "admin");
    const b = (await (await upload(uploadReq(SET_B))).json()).datasetId;
    await expect(testDb().raw.query("update service_datasets set status = 'active' where id = $1", [b])).rejects.toThrow(/service_datasets_one_active|duplicate key/);
    expect(await sql("select id::text id from service_datasets where status = 'active'")).toEqual([{ id: a }]);
  });

  it("confirm twice, confirm an unknown id, a malformed id, and an incomplete staging are all refused without changing anything", async () => {
    signIn(admin.id, "admin");
    const a = (await (await upload(uploadReq(SET_A))).json()).datasetId;
    expect((await confirm(confirmReq(a))).status).toBe(200);
    const again = await confirm(confirmReq(a));
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("NOT_STAGED");
    expect((await confirm(confirmReq("99999"))).status).toBe(404);
    for (const bad of [undefined, 5, "abc", "1; drop table users", "-1", ""]) expect((await confirm(confirmReq(bad))).status).toBe(400);
    const b = (await (await upload(uploadReq(SET_B))).json()).datasetId;
    await sql("delete from service_dataset_rows where dataset_id = $1 and row_number = 2", [b]); // simulate a damaged staging area
    const res = await confirm(confirmReq(b));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("STAGING_INCOMPLETE");
    expect(await names()).toHaveLength(4); // still the first dataset
  });

  it("an old preview expires and cannot be confirmed", async () => {
    signIn(admin.id, "admin");
    const a = (await (await upload(uploadReq(SET_A))).json()).datasetId;
    await sql("update service_datasets set uploaded_at = now() - interval '25 hours' where id = $1", [a]);
    const res = await confirm(confirmReq(a));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("STAGING_EXPIRED");
  });

  it("uploading again before confirming replaces the admin's earlier unconfirmed preview", async () => {
    signIn(admin.id, "admin");
    const first = (await (await upload(uploadReq(SET_A))).json()).datasetId;
    await upload(uploadReq(SET_B));
    expect(await sql("select status from service_datasets where id = $1", [first])).toEqual([{ status: "discarded" }]);
    expect(await sql("select count(*)::int n from service_dataset_rows where dataset_id = $1", [first])).toEqual([{ n: 0 }]);
  });
});

describe("search (same data for everyone)", () => {
  beforeEach(async () => { await goLive(SET_A); m.cookie = undefined; });

  it("is case-insensitive and matches partial words in the school name", async () => {
    expect(await names("?q=KENDRIYA")).toEqual(["Kendriya Vidyalaya"]);
    expect(await names("?q=vidya")).toEqual(["Kendriya Vidyalaya", "Sri Prakash Vidya Niketan"]);
    expect(await names("?q=prakash%20niketan")).toEqual(["Sri Prakash Vidya Niketan"]); // every word must match
    expect(await names("?q=model")).toEqual(["A P Model School"]);
  });

  it("matches location (district, state, pincode), alone or combined with the name", async () => {
    expect(await names("?location=visakha")).toEqual(["A P Model School", "Sri Prakash Vidya Niketan"]);
    expect(await names("?location=GUNTUR")).toEqual(["Kendriya Vidyalaya"]);
    expect(await names("?location=533286")).toEqual(["Zilla Parishad High School"]);
    expect(await names("?location=andhra")).toHaveLength(4);
    expect(await names("?q=school&location=visakhapatnam")).toEqual(["A P Model School"]);
    expect(await names("?q=kendriya&location=visakhapatnam")).toEqual([]);
  });

  it("returns the expected fields, including every uploaded column", async () => {
    const b = await (await search(searchReq("?q=kendriya"))).json();
    expect(b).toMatchObject({ success: true, total: 1, page: 1, pageSize: 20 });
    expect(b.results[0]).toMatchObject({ schoolName: "Kendriya Vidyalaya", state: "Andhra Pradesh", district: "Guntur", pincode: "522005", udiseCode: "28172601012" });
    expect(b.results[0].details).toEqual({ school_name: "Kendriya Vidyalaya", state: "Andhra Pradesh", district: "Guntur", pincode: "522005", udise_code: "28172601012" });
    expect(b.dataset).toMatchObject({ rowCount: 4 });
  });

  it("paginates with a stable order and a correct total", async () => {
    const p1 = await (await search(searchReq("?pageSize=3&page=1"))).json();
    const p2 = await (await search(searchReq("?pageSize=3&page=2"))).json();
    const p3 = await (await search(searchReq("?pageSize=3&page=3"))).json();
    expect([p1.total, p2.total, p3.total]).toEqual([4, 4, 4]);
    expect([p1.results.length, p2.results.length, p3.results.length]).toEqual([3, 1, 0]);
    expect([...p1.results, ...p2.results].map((r: any) => r.schoolName)).toEqual(["A P Model School", "Kendriya Vidyalaya", "Sri Prakash Vidya Niketan", "Zilla Parishad High School"]);
  });

  it("shows an empty (not an error) result when nothing matches", async () => {
    const b = await (await search(searchReq("?q=zzzz"))).json();
    expect(b).toMatchObject({ success: true, total: 0, results: [] });
  });

  it("validates input with a friendly message", async () => {
    for (const qs of ["?page=0", "?page=abc", "?page=-1", "?pageSize=0", "?pageSize=51", "?pageSize=1e3", `?q=${"a".repeat(101)}`, "?q=a%20b%20c%20d%20e%20f%20g", `?location=${"b".repeat(101)}`]) {
      const res = await search(searchReq(qs));
      expect(res.status, qs).toBe(400);
      expect((await res.json()).message, qs).toBeTruthy();
    }
  });

  it("treats % _ \\ and SQL as plain text, never as wildcards or code", async () => {
    expect(await names("?q=%25")).toEqual([]);
    expect(await names("?q=_")).toEqual([]);
    expect(await names("?q=%5C")).toEqual([]);
    expect(await names("?q=" + encodeURIComponent("'; DROP TABLE users;--"))).toEqual([]);
    expect(await names("?location=" + encodeURIComponent("' OR '1'='1"))).toEqual([]);
    expect(await sql("select count(*)::int n from users")).toEqual([{ n: 2 }]);
  });

  it("is identical for anonymous users, regular users and admins, and is cacheable for a minute (PR 2)", async () => {
    const get = async () => { const r = await search(searchReq("?q=school")); return { body: await r.json(), cc: r.headers.get("cache-control") }; };
    const anon = await get();
    signIn(user.id, "ST");
    const asUser = await get();
    signIn(admin.id, "admin");
    const asAdmin = await get();
    expect(asUser.body).toEqual(anon.body);
    expect(asAdmin.body).toEqual(anon.body);
    expect(anon.cc).toBe("public, s-maxage=60, stale-while-revalidate=30");
    expect(anon.body.results.length).toBeGreaterThan(0);
  });

  it("a re-upload is visible to the very next search (no stale results)", async () => {
    expect(await names("?q=kendriya")).toHaveLength(1);
    await goLive(SET_B);
    m.cookie = undefined;
    expect(await names("?q=kendriya")).toEqual([]);
    expect(await names("?q=brand")).toEqual(["Brand New School"]);
  });

  it("CORS: an allowed origin gets the headers, another origin does not", async () => {
    vi.stubEnv("ALLOWED_ORIGINS", "http://localhost:8080");
    const ok = await search(new Request("http://localhost/api/services/search?q=x", { headers: { origin: "http://localhost:8080" } }));
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:8080");
    const other = await search(new Request("http://localhost/api/services/search?q=x", { headers: { origin: "https://evil.example" } }));
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
    expect(other.headers.get("vary")).toMatch(/Origin/);
  });
});
