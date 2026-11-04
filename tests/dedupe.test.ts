// No duplicate schools from an upload: the key and normalisation, the merge rules, the parser's file-shape fixes, the upload
// report, the database guarantees, and that every count shown equals the unique count. Real routes and real SQL on the
// in-process PostgreSQL (PGlite); no real database, no network.
import { PGlite } from "@electric-sql/pglite";
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyFile, pickFiles } from "../scripts/migrate.mjs";
import { seedUser, testDb } from "./helpers";
import { createSessionToken } from "../src/lib/session";
import { normText, normUdise, similarity } from "../src/lib/spreadsheet/dedupe";
import { parseUpload } from "../src/lib/spreadsheet/parse";
import { categoryRows } from "../src/lib/adminDatasets";
import { reportCsv } from "../src/lib/uploadReport";

const m = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "rv_session" && m.cookie ? { name: n, value: m.cookie } : undefined) }),
}));

import { POST as upload } from "../src/app/api/services/upload/route";
import { POST as confirm } from "../src/app/api/services/upload/confirm/route";
import { GET as search } from "../src/app/api/services/search/route";
import { GET as categories } from "../src/app/api/services/categories/route";
import { GET as reportRoute } from "../src/app/api/admin/datasets/[id]/report/route";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const tokenFor = (id: string, role: string) => createSessionToken({ id, role }, false, Date.now(), { SESSION_SECRET: SECRET } as never).token;
const signIn = (id: string, role: string) => { m.cookie = tokenFor(id, role); };
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
type F = { name: string; type: string; data: Buffer | string };
const csv = (text: string, name = "schools.csv"): F => ({ name, type: "text/csv", data: text });
const sql = async (q: string, p?: unknown[]) => (await testDb().raw.query(q, p as never)).rows as any[];
const uploadReq = (f: F, category = "atl-labs") => {
  const fd = new FormData();
  fd.set("file", new File([f.data as BlobPart], f.name, { type: f.type }));
  fd.set("category", category);
  return new Request("http://localhost/api/services/upload", { method: "POST", body: fd });
};
const confirmReq = (datasetId: unknown) =>
  new Request("http://localhost/api/services/upload/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ datasetId }) });

const HEAD = "School Name,State,District,Pincode,UDISE Code,ATL UID\n";
const body = (rows: string[]) => csv(HEAD + rows.join("\n") + "\n");
const parse = (f: F) => parseUpload({ filename: f.name, mime: f.type, buffer: Buffer.from(f.data as never) });
const text = async (rows: string[]) => parse(body(rows));

async function xlsx(sheets: Record<string, unknown[][]>, tweak?: (wb: ExcelJS.Workbook) => void): Promise<F> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) { const ws = wb.addWorksheet(name); rows.forEach((r) => ws.addRow(r)); }
  tweak?.(wb);
  return { name: "schools.xlsx", type: XLSX, data: Buffer.from(await wb.xlsx.writeBuffer()) };
}

let admin: { id: string };
beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  m.cookie = undefined;
  for (const fn of ["log", "error", "warn", "info"] as const) vi.spyOn(console, fn).mockImplementation(() => {});
  admin = await seedUser({ email: "ai@symbiosystech.com", role: "admin" });
  signIn(admin.id, "admin");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function stage(f: F, category = "atl-labs") {
  const res = await upload(uploadReq(f, category));
  const b = await res.json();
  expect(res.status, JSON.stringify(b)).toBe(200);
  return b;
}
async function goLive(f: F, category = "atl-labs") {
  const b = await stage(f, category);
  expect((await confirm(confirmReq(b.datasetId))).status).toBe(200);
  return b;
}

describe("normalisation", () => {
  it("normText: NFKC, case, spaces, punctuation, '&' = 'and', SR = SENIOR, other scripts kept", () => {
    expect(normText("  A.C.  G.H.S.S.  ")).toBe(normText("a c g h s s"));
    expect(normText("St. Mary's & Sons")).toBe("st mary s and sons");
    expect(normText("ＤＡＶ Public  School")).toBe("dav public school");
    expect(normText("BVM SR. SEC. SCHOOL")).toBe(normText("BVM SENIOR SEC SCHOOL"));
    expect(normText("दिल्ली पब्लिक स्कूल")).toBe("दिल्ली पब्लिक स्कूल"); // combining marks survive
  });

  it("normUdise: 11 digits, a 10-digit code gets its dropped leading zero, placeholders and junk are not a code", () => {
    expect(normUdise("07080317203")).toBe("07080317203");
    expect(normUdise("7080317203")).toBe("07080317203");
    expect(normUdise("7080317203.0")).toBe("07080317203");
    expect(normUdise(" 0708 0317203 ")).toBe("07080317203");
    for (const bad of ["0", "00000000000", "", "N/A", "123", "123456789012", null, undefined]) expect(normUdise(bad as never), String(bad)).toBeNull();
  });

  it("similarity: identical = 1, one word apart is high, unrelated is low", () => {
    expect(similarity("dav public school", "dav public school")).toBe(1);
    expect(similarity("kendriya vidyalaya no iii jalandhar cantt", "kendriya vidyalaya no ii jalandhar cantt")).toBeGreaterThanOrEqual(0.8);
    expect(similarity("dav public school", "green valley academy")).toBeLessThan(0.3);
  });
});

describe("duplicates inside one file are ONE record", () => {
  it("500 repeated rows create one record, and every row is accounted for", async () => {
    const p = await text(Array.from({ length: 500 }, () => "DAV Public School,Delhi,South West Delhi,110070,07080317203,a1"));
    expect(p.rows).toHaveLength(1);
    expect(p.rowsRead).toBe(500);
    expect(p.dedupe.duplicatesSkipped).toBe(499);
    expect(p.rowsRead).toBe(p.rows.length + p.dedupe.duplicatesSkipped + p.invalidRowCount);
  });

  it("same UDISE: merged even when spelling, case, spaces and punctuation differ", async () => {
    const p = await text([
      "DELHI PUBLIC SCHOOL,Uttar Pradesh,Ghaziabad,201002,09090903812,x1",
      "  Delhi  Public School. ,UTTAR PRADESH,ghaziabad,201002,09090903812,x2",
    ]);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]!.schoolName).toBe("DELHI PUBLIC SCHOOL"); // the first row wins
  });

  it("a 10-digit UDISE code (leading zero lost) and the 11-digit code are the same school", async () => {
    const p = await text(["Amity School,Delhi,South Delhi,110017,07090316905,1", "Amity School,Delhi,South Delhi,110017,7090316905,2"]);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]!.dedupeKey).toBe("u:07090316905");
  });

  it("UDISE '0' is a placeholder, NOT a code: different schools with '0' stay separate", async () => {
    const p = await text(["School One,Kerala,Kannur,670521,0,1", "School Two,Kerala,Wayanad,673579,0,2", "School Three,Kerala,Thrissur,680303,0,3"]);
    expect(p.rows).toHaveLength(3);
    expect(p.rows.every((r) => r.dedupeKey.startsWith("n:"))).toBe(true);
  });

  it("no UDISE: the same name + district + state + PIN is one school; another PIN or district is another", async () => {
    const p = await text([
      "Government High School Belavi,Karnataka,Belagavi,591309,,1",
      "GOVERNMENT HIGH SCHOOL  BELAVI,karnataka,BELAGAVI,591309,,2",
      "Government High School Belavi,Karnataka,Belagavi,591310,,3",
      "Government High School Belavi,Karnataka,Kolar,563101,,4",
    ]);
    expect(p.rows.map((r) => r.rowNumber)).toEqual([2, 4, 5]);
  });

  it("a blank district or state does not make it a different school (and the blank is filled, never overwritten)", async () => {
    const p = await text(["Zilla Parishad High School,,,533286,,1", "Zilla Parishad High School,Andhra Pradesh,East Godavari,533286,,2"]);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]!.state).toBe("Andhra Pradesh");
    expect(p.rows[0]!.district).toBe("East Godavari");
    expect(p.rows[0]!.locationText).toContain("east godavari"); // and it is searchable
    expect(p.dedupe.rowsFilled).toBe(1);
    expect(p.dedupe.merged[0]!.filled).toEqual(expect.arrayContaining(["state", "district"]));
  });

  it("the first row's values are never overwritten; every different non-empty value is reported with BOTH row numbers", async () => {
    const p = await text([
      "Kendriya Vidyalaya,Tamil Nadu,Chennai,600055,33010906805,d8cd150",
      "Kendriya Vidyalaya AFS Avadi,Tamil Nadu,Tiruvallur,600055,33010906805,32053695",
    ]);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]!.schoolName).toBe("Kendriya Vidyalaya");
    expect(p.rows[0]!.district).toBe("Chennai");
    const merged = p.dedupe.merged[0]!;
    expect(merged.row).toBe(3);
    expect(merged.keptRow).toBe(2);
    expect(merged.conflicts.map((c) => c.column)).toEqual(expect.arrayContaining(["school_name", "district", "atl_uid"]));
    const atl = merged.conflicts.find((c) => c.column === "atl_uid")!;
    expect([atl.kept, atl.skipped]).toEqual(["d8cd150", "32053695"]); // both ATL UIDs are kept in the report
    expect(p.dedupe.conflictRows).toBe(1);
  });

  it("two DIFFERENT valid UDISE codes are never merged, even with the same name and PIN (two campuses); they are listed for review", async () => {
    const p = await text(["Amity International School,Haryana,Gurgaon,122002,06180107361,1", "Amity International School,Haryana,Gurgaon,122002,06180106416,2"]);
    expect(p.rows).toHaveLength(2);
    expect(p.dedupe.possible.some((x) => x.row === 3 && x.otherRow === 2 && /different UDISE/.test(x.reason))).toBe(true);
  });

  it("near-identical names in one PIN code are flagged for review and never merged", async () => {
    const p = await text([
      "Kendriya Vidyalaya No III Jalandhar Cantt,Punjab,Jalandhar,144005,03101001111,1",
      "Kendriya Vidyalaya No II Jalandhar Cantt,Punjab,Jalandhar,144005,03101002222,2",
      "Totally Different Academy,Punjab,Jalandhar,144005,03101003333,3",
    ]);
    expect(p.rows).toHaveLength(3);
    expect(p.dedupe.possible).toHaveLength(1);
    expect(p.dedupe.possible[0]).toMatchObject({ row: 3, otherRow: 2 });
    expect(p.dedupe.possible[0]!.similarity).toBeGreaterThanOrEqual(0.8);
  });

  it("Hindi / regional-script names deduplicate too", async () => {
    const p = await text(["दिल्ली पब्लिक स्कूल,दिल्ली,नई दिल्ली,110001,,1", "  दिल्ली  पब्लिक स्कूल ,दिल्ली,नई दिल्ली,110001,,2"]);
    expect(p.rows).toHaveLength(1);
  });

  it("every row is accounted for: rows read = unique + duplicates skipped + rejected", async () => {
    const p = await text([
      "A School,AP,Guntur,522001,28172601012,1", "A School,AP,Guntur,522001,28172601012,2", ",AP,Guntur,522001,,3", "Bad Pin School,AP,Guntur,12ab,,4", "B School,AP,Guntur,522001,,5",
    ]);
    expect(p.rowsRead).toBe(5);
    expect(p.rows).toHaveLength(2);
    expect(p.dedupe.duplicatesSkipped).toBe(1);
    expect(p.invalidRowCount).toBe(2);
    expect(p.rejectedRows.map((r) => r.rowNumber)).toEqual([4, 5]);
  });
});

describe("file shapes", () => {
  it("a PIN written as 110001.0, '110 001' or a number is the same PIN code", async () => {
    const f = await xlsx({ S: [["School Name", "State", "District", "Pincode", "UDISE Code"], ["One", "Delhi", "North", 110001, ""], ["One", "Delhi", "North", "110001.0", ""], ["One", "Delhi", "North", " 110 001 ", ""]] });
    const p = await parse(f);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]!.pincode).toBe("110001");
    expect(p.rows[0]!.data["pincode"]).toBe("110001");
  });

  it("a UDISE code stored as a number loses its leading zero in Excel; it still matches the text version", async () => {
    const f = await xlsx({ S: [["School Name", "State", "District", "Pincode", "UDISE Code"], ["DAV School", "Delhi", "SW", "110070", 7080317203], ["DAV School", "Delhi", "SW", "110070", "07080317203"]] });
    const p = await parse(f);
    expect(p.rows).toHaveLength(1);
  });

  it("a header row repeated in the middle of the data is skipped and counted, not stored as a school", async () => {
    const p = await text(["One School,AP,Guntur,522001,,1", "School Name,State,District,Pincode,UDISE Code,ATL UID", "Two School,AP,Guntur,522002,,2"]);
    expect(p.rows.map((r) => r.schoolName)).toEqual(["One School", "Two School"]);
    expect(p.repeatedHeaderRows).toEqual([{ rowNumber: 3 }]);
    expect(p.invalidRowCount).toBe(0);
  });

  it("rows hidden in Excel (a filter left on, say) are STILL read, and the report says how many", async () => {
    const f = await xlsx({ S: [["School Name", "State", "District", "Pincode"], ["Shown", "AP", "Guntur", "522001"], ["Hidden", "AP", "Guntur", "522002"], ["Also Shown", "AP", "Guntur", "522003"]] }, (wb) => { wb.getWorksheet("S")!.getRow(3).hidden = true; });
    const p = await parse(f);
    expect(p.rows.map((r) => r.schoolName)).toEqual(["Shown", "Hidden", "Also Shown"]);
    expect(p.hiddenRowsRead).toBe(1);
  });

  it("every visible sheet is read; a hidden sheet and a sheet without school data are ignored; duplicates across sheets merge", async () => {
    const f = await xlsx({
      North: [["School Name", "State", "District", "Pincode", "UDISE Code"], ["Alpha", "Delhi", "North", "110001", "07010305607"], ["Beta", "Delhi", "North", "110002", "07010305608"]],
      South: [["School Name", "State", "District", "Pincode", "UDISE Code"], ["Alpha Again", "Delhi", "North", "110001", "07010305607"], ["Gamma", "Kerala", "Kannur", "670521", "32010305609"]],
      Notes: [["Remark"], ["not a school list"]],
      Old: [["School Name", "State", "District", "Pincode"], ["Hidden Sheet School", "AP", "Guntur", "522001"]],
    }, (wb) => { wb.getWorksheet("Old")!.state = "hidden"; });
    const p = await parse(f);
    expect(p.sheetsRead).toEqual(["North", "South"]);
    expect(p.rows.map((r) => r.schoolName)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(p.dedupe.merged[0]).toMatchObject({ sheet: "South", row: 2, keptRow: 2 });
    expect(p.rows.find((r) => r.schoolName === "Gamma")!.sheet).toBe("South");
  });

  it("a workbook with several sheets and NO sheet with school data is refused with the usual message", async () => {
    const f = await xlsx({ A: [["Remark"], ["x"]], B: [["Other"], ["y"]] });
    await expect(parse(f)).rejects.toMatchObject({ code: "MISSING_COLUMNS" });
  });

  it("merged cells fill down and empty rows are skipped", async () => {
    const f = await xlsx({ S: [["School Name", "State", "District", "Pincode"], ["Alpha", "Delhi", "North", "110001"], [], ["Beta", "", "North", "110002"]] }, (wb) => { wb.getWorksheet("S")!.mergeCells("B3:B4"); });
    const p = await parse(f);
    expect(p.rows).toHaveLength(2);
  });
});

describe("upload: the report, the counts and re-uploads", () => {
  const FILE = body([
    "Alpha School,Delhi,North,110001,07010305607,1",
    "Alpha School,Delhi,North,110001,07010305607,2",
    "Beta School,Delhi,North,110002,07010305608,3",
    ",Delhi,North,110003,,4",
    "Gamma School,Kerala,Kannur,670521,0,5",
  ]);

  it("the response and the database agree: unique count, report numbers, dedupe keys, no duplicate rows", async () => {
    const b = await stage(FILE);
    expect(b.rowCount).toBe(3);
    expect(b.report).toMatchObject({ rowsRead: 5, added: 3, duplicatesSkipped: 1, rejected: 1, possibleDuplicates: 0, hiddenRowsRead: 0 });
    expect(b.report.rowsRead).toBe(b.report.added + b.report.duplicatesSkipped + b.report.rejected);
    expect(b.report.url).toBe(`/api/admin/datasets/${b.datasetId}/report`);
    expect(b.report.examples.merged[0]).toMatchObject({ row: 3, keptRow: 2 });
    const rows = await sql("select school_name, dedupe_key from service_dataset_rows where dataset_id = $1 order by row_number", [b.datasetId]);
    expect(rows.map((r) => r.school_name)).toEqual(["Alpha School", "Beta School", "Gamma School"]);
    expect(rows[0].dedupe_key).toBe("u:07010305607");
    expect(rows[2].dedupe_key.startsWith("n:")).toBe(true);
    const ds = (await sql("select row_count, rows_read, duplicate_row_count, invalid_row_count, dedupe_version, is_demo from service_datasets where id = $1", [b.datasetId]))[0];
    expect(ds).toMatchObject({ row_count: 3, rows_read: 5, duplicate_row_count: 1, invalid_row_count: 1, dedupe_version: 1, is_demo: false });
  });

  it("search shows the school once", async () => {
    await goLive(FILE);
    const r = await (await search(new Request("http://localhost/api/services/search?q=alpha"))).json();
    expect(r.total).toBe(1);
    expect(r.results).toHaveLength(1);
  });

  it("the category count and every admin table show the UNIQUE count, and is_demo is false unless set", async () => {
    await goLive(FILE);
    const cats = await (await categories(new Request("http://localhost/api/services/categories"))).json();
    const atl = cats.categories.find((c: any) => c.slug === "atl-labs");
    expect(atl).toMatchObject({ active: true, count: 3, isDemo: false });
    const rows = await categoryRows({ query: (s: string, p?: unknown[]) => testDb().raw.query(s, p as never) } as never);
    expect(rows.find((r) => r.slug === "atl-labs")!.active!.rows).toBe(3);
    await sql("update service_datasets set is_demo = true where status = 'active'");
    const demo = await (await categories(new Request("http://localhost/api/services/categories"))).json();
    expect(demo.categories.find((c: any) => c.slug === "atl-labs").isDemo).toBe(true);
    expect(demo.categories.find((c: any) => c.slug === "stem-labs").isDemo).toBe(false);
  });

  it("uploading the SAME file again says 'no changes' and creates no new dataset", async () => {
    await goLive(FILE);
    const before = (await sql("select count(*)::int n from service_datasets"))[0].n;
    const again = await (await upload(uploadReq(FILE))).json();
    expect(again).toMatchObject({ success: true, unchanged: true });
    expect(again.message).toMatch(/identical/i);
    expect((await sql("select count(*)::int n from service_datasets"))[0].n).toBe(before);
    expect((await sql("select detail from upload_audit_log order by id desc limit 1"))[0].detail).toMatch(/no changes/);
  });

  it("the same bytes under another category are NOT 'no changes'; a changed file is a new dataset; staged-only data is not 'live'", async () => {
    await goLive(FILE);
    const other = await stage(FILE, "stem-labs");
    expect(other.unchanged).toBe(false);
    const changed = await stage(body(["Alpha School,Delhi,North,110001,07010305607,1", "Delta School,Delhi,North,110009,07010305699,9"]));
    expect(changed.unchanged).toBe(false);
    expect(changed.rowCount).toBe(2);
  });

  it("a dataset loaded BEFORE duplicate handling is not 'the same': re-uploading the file replaces it with a clean one", async () => {
    const old = await goLive(FILE);
    await sql("update service_datasets set dedupe_version = null where id = $1", [old.datasetId]);
    const again = await (await upload(uploadReq(FILE))).json();
    expect(again.unchanged).toBe(false);
    expect(again.datasetId).not.toBe(old.datasetId);
  });

  it("two simultaneous uploads of the same file cannot create a duplicate school in any dataset", async () => {
    const [a, b] = await Promise.all([upload(uploadReq(FILE)), upload(uploadReq(FILE))]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const per = await sql("select dataset_id, count(*)::int n, count(distinct dedupe_key)::int k from service_dataset_rows group by dataset_id");
    for (const r of per) expect(r.n).toBe(r.k);
  });

  it("two rows of different schools and one school filed under a second service stay consistent: services attach to the school", async () => {
    // the service (category) comes from the upload form, so the same school in two category files is one school in each
    await goLive(body(["Alpha School,Delhi,North,110001,07010305607,1"]), "atl-labs");
    await goLive(body(["Alpha School,Delhi,North,110001,07010305607,1"]), "stem-labs");
    const cats = (await (await categories(new Request("http://localhost/api/services/categories"))).json()).categories;
    expect(cats.find((c: any) => c.slug === "atl-labs").count).toBe(1);
    expect(cats.find((c: any) => c.slug === "stem-labs").count).toBe(1);
  });
});

describe("the database itself refuses a second row with the same key", () => {
  it("unique (dataset_id, dedupe_key); ON CONFLICT DO NOTHING keeps one; rows without a key (older data) can repeat; another dataset may reuse a key", async () => {
    const b = await stage(body(["Alpha School,Delhi,North,110001,07010305607,1"]));
    const id = b.datasetId;
    const ins = "insert into service_dataset_rows (dataset_id, row_number, school_name, data, search_name, dedupe_key) values ($1, $2, 'X', '{}', 'x', $3)";
    await expect(sql(ins, [id, 99, "u:07010305607"])).rejects.toThrow(/unique|duplicate/i);
    await sql(ins + " on conflict (dataset_id, dedupe_key) do nothing", [id, 99, "u:07010305607"]);
    expect((await sql("select count(*)::int n from service_dataset_rows where dataset_id = $1", [id]))[0].n).toBe(1);
    await sql(ins, [id, 100, null]);
    await sql(ins, [id, 101, null]);
    expect((await sql("select count(*)::int n from service_dataset_rows where dataset_id = $1", [id]))[0].n).toBe(3);
    const second = await stage(body(["Alpha School,Delhi,North,110001,07010305607,1", "Other School,Delhi,North,110002,07010305610,2"]));
    expect(second.rowCount).toBe(2);
  });
});

describe("GET /api/admin/datasets/:id/report (admin only CSV)", () => {
  const FILE2 = body([
    "Alpha School,Delhi,North,110001,07010305607,1",
    "Alpha School,Delhi,North,110001,07010305607,2",
    ",Delhi,North,110003,,3",
    "=HYPERLINK(\"http://evil\"),Delhi,North,110004,,4",
  ]);
  const call = (id: string) => reportRoute(new Request(`http://localhost/api/admin/datasets/${id}/report`), { params: Promise.resolve({ id }) });

  it("lists every skipped and rejected row with its row number, and is safe to open in a spreadsheet", async () => {
    const b = await stage(FILE2);
    const res = await call(b.datasetId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    expect(res.headers.get("content-disposition")).toMatch(/attachment/);
    const csvText = await res.text();
    expect(csvText.split("\r\n")[0]).toBe("type,sheet,row,related_row,reason,details");
    expect(csvText).toMatch(/rejected,,4,,School name is empty/);
    expect(csvText).toMatch(/duplicate_skipped,,3,2,same UDISE code/);
    expect(csvText).not.toMatch(/(^|,)=HYPERLINK/m); // never a live formula
  });

  it("401 without a session, 403 for a regular user, 404 unknown, 400 for a bad id", async () => {
    const b = await stage(FILE2);
    const user = await seedUser({ email: "asha@example.com", role: "ST" });
    m.cookie = undefined;
    expect((await call(b.datasetId)).status).toBe(401);
    signIn(user.id, "ST");
    expect((await call(b.datasetId)).status).toBe(403);
    signIn(admin.id, "admin");
    expect((await call("999999")).status).toBe(404);
    expect((await call("abc")).status).toBe(400);
  });

  it("reportCsv handles a dataset with no report (loaded before duplicate handling)", () => {
    expect(reportCsv(null)).toBe("type,sheet,row,related_row,reason,details\r\n");
  });
});

describe("migration 010", () => {
  const read = (p: string) => readFileSync(resolve(p), "utf8");
  const runner = (pg: PGlite) => ({ setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]), exec: (s: string) => pg.exec(s) });
  async function upTo009() {
    const pg = new PGlite();
    await pg.exec(read("tests/helpers/baseSchema.sql"));
    const db = String((await pg.query("select current_database() d")).rows[0]!["d" as never]);
    for (const f of pickFiles().filter((f) => !/010/.test(f))) await applyFile(runner(pg), db, readFileSync(f, "utf8"));
    return { pg, db };
  }
  const cols = async (pg: PGlite, t: string) => ((await pg.query("select column_name c from information_schema.columns where table_name = $1", [t])).rows as any[]).map((r) => r.c);

  it("is additive and idempotent: existing rows and columns are untouched, new columns are empty or defaulted", async () => {
    const { pg, db } = await upTo009();
    await pg.exec("insert into users (full_name,email,role,password_hash) values ('A','a@example.com','admin','x')");
    await pg.exec(`insert into service_datasets (uploaded_by, original_filename, file_sha256, row_count, status) values (1,'old.xlsx','${"a".repeat(64)}',2,'active')`);
    await pg.exec("insert into service_dataset_rows (dataset_id,row_number,school_name,data,search_name) values (1,1,'S','{}','s'),(1,2,'S','{}','s')");
    const before = { ds: await cols(pg, "service_datasets"), rows: await cols(pg, "service_dataset_rows") };
    for (let i = 0; i < 2; i++) await applyFile(runner(pg), db, read("db/migrations/010_dedupe_uploads.sql"));
    const after = { ds: await cols(pg, "service_datasets"), rows: await cols(pg, "service_dataset_rows") };
    expect(after.rows.filter((c) => !before.rows.includes(c))).toEqual(["dedupe_key"]);
    expect(after.ds.filter((c) => !before.ds.includes(c)).sort()).toEqual(["dedupe_version", "duplicate_row_count", "filled_row_count", "is_demo", "possible_duplicate_count", "report", "rows_read"]);
    expect(before.ds.every((c) => after.ds.includes(c))).toBe(true);
    const d = (await pg.query("select row_count, dedupe_version, duplicate_row_count, is_demo, report from service_datasets")).rows[0] as any;
    expect(d).toMatchObject({ row_count: 2, dedupe_version: null, duplicate_row_count: 0, is_demo: false, report: null });
    expect(((await pg.query("select count(*)::int n, count(dedupe_key)::int k from service_dataset_rows")).rows[0] as any)).toMatchObject({ n: 2, k: 0 }); // old rows keep a NULL key, so they never conflict
    await pg.close();
  });

  it("refuses to run without the database-name confirmation", async () => {
    const { pg } = await upTo009();
    await pg.query("select set_config('rv.expected_db', '', false)");
    await expect(pg.exec(read("db/migrations/010_dedupe_uploads.sql"))).rejects.toThrow(/rv\.expected_db is not set/);
    await pg.exec("ROLLBACK");
    await pg.close();
  });

  it("the rollback removes the columns and the index and keeps every school row", async () => {
    const { pg, db } = await upTo009();
    await applyFile(runner(pg), db, read("db/migrations/010_dedupe_uploads.sql"));
    await pg.exec("insert into users (full_name,email,role,password_hash) values ('A','a@example.com','admin','x')");
    await pg.exec(`insert into service_datasets (uploaded_by, original_filename, file_sha256, row_count, status) values (1,'o.xlsx','${"a".repeat(64)}',1,'active')`);
    await pg.exec("insert into service_dataset_rows (dataset_id,row_number,school_name,data,search_name,dedupe_key) values (1,1,'S','{}','s','u:1')");
    await applyFile(runner(pg), db, read("db/rollback/010_down.sql"));
    expect(await cols(pg, "service_dataset_rows")).not.toContain("dedupe_key");
    expect(await cols(pg, "service_datasets")).not.toContain("is_demo");
    expect((await pg.query("select count(*)::int n from service_dataset_rows")).rows[0]).toMatchObject({ n: 1 });
    expect((await pg.query("select count(*)::int n from pg_indexes where indexname = 'service_dataset_rows_dedupe_key_uq'")).rows[0]).toMatchObject({ n: 0 });
    await pg.close();
  });
});
