// Stage 4 server side: attachment checks, the admin upload and download APIs, and the upload history page.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";
import { createSessionToken } from "../src/lib/session";

const m = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "rv_session" && m.cookie ? { name: n, value: m.cookie } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error("REDIRECT:" + to); },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import { POST as upload } from "../src/app/api/admin/attachments/route";
import { GET as download } from "../src/app/api/admin/attachments/[key]/route";
import UploadHistoryPage from "../src/app/admin/upload-history/page";
import UploadPage from "../src/app/admin/upload/page";
import { cleanFilename, contentDisposition, detectAttachment, MAX_ATTACHMENT_BYTES, UPLOADS_PER_WINDOW } from "../src/lib/attachments";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const signIn = (id: string, role = "admin") => { m.cookie = createSessionToken({ id, role }, false, Date.now(), { SESSION_SECRET: SECRET } as never).token; };
const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p);

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("rest-of-image")]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("rest-of-image")]);
const zip = (inner: string) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(inner)]);
const XLSX = zip("xl/workbook.xml");
const DOCX = zip("word/document.xml");

const body = (name: string, buf: Buffer | string, type = "application/octet-stream") => {
  const f = new FormData();
  f.append("file", new File([typeof buf === "string" ? buf : new Uint8Array(buf)], name, { type }));
  return f;
};
const post = (form: FormData, headers: Record<string, string> = {}) => upload(new Request("http://localhost/api/admin/attachments", { method: "POST", body: form, headers }));
const get = (key: string, headers: Record<string, string> = {}) => download(new Request("http://localhost/api/admin/attachments/" + key, { headers }), { params: Promise.resolve({ key }) });
let admin: { id: string };

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  m.cookie = undefined;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  admin = await seedUser({ email: "boss@robovalley.com", role: "admin" });
  signIn(admin.id);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("detectAttachment (content decides, not the browser)", () => {
  it("accepts each approved type when name and content agree", () => {
    expect(detectAttachment("a.pdf", PDF).type).toBe("pdf");
    expect(detectAttachment("a.png", PNG).type).toBe("png");
    expect(detectAttachment("a.jpg", JPG).type).toBe("jpg");
    expect(detectAttachment("a.JPEG", JPG).type).toBe("jpg");
    expect(detectAttachment("a.xlsx", XLSX).contentType).toContain("spreadsheetml");
    expect(detectAttachment("a.docx", DOCX).contentType).toContain("wordprocessingml");
    expect(detectAttachment("a.csv", Buffer.from("a,b\n1,2\n")).contentType).toBe("text/csv");
    expect(detectAttachment("a.txt", Buffer.from("hello ✓")).contentType).toBe("text/plain");
  });

  it.each([
    ["a.exe", Buffer.from("MZ"), "TYPE_NOT_ALLOWED"],
    ["a.html", Buffer.from("<script>"), "TYPE_NOT_ALLOWED"],
    ["a.svg", Buffer.from("<svg/>"), "TYPE_NOT_ALLOWED"],
    ["noextension", PDF, "TYPE_NOT_ALLOWED"],
    ["a.pdf", PNG, "CONTENT_MISMATCH"],
    ["a.png", PDF, "CONTENT_MISMATCH"],
    ["a.jpg", PNG, "CONTENT_MISMATCH"],
    ["a.xlsx", DOCX, "CONTENT_MISMATCH"],
    ["a.docx", XLSX, "CONTENT_MISMATCH"],
    ["a.xlsx", Buffer.from("just text"), "CONTENT_MISMATCH"],
    ["a.txt", Buffer.from([0x41, 0x00, 0x42]), "CONTENT_MISMATCH"],
    ["a.csv", PNG, "CONTENT_MISMATCH"],
    ["a.pdf", Buffer.from("%PDF-1.7 /JavaScript (app.alert(1))"), "ACTIVE_CONTENT"],
    ["a.xlsx", zip("xl/workbook.xml xl/vbaProject.bin"), "ACTIVE_CONTENT"],
    ["a.pdf", Buffer.alloc(0), "EMPTY_FILE"],
    ["a.pdf", Buffer.concat([PDF, Buffer.alloc(MAX_ATTACHMENT_BYTES)]), "FILE_TOO_LARGE"],
  ])("refuses %s (%s)", (name, buf, code) => {
    expect(() => detectAttachment(name, buf as Buffer)).toThrow(expect.objectContaining({ code }));
  });

  it("ignores the browser's claimed type and strips folders and control characters from the name", () => {
    expect(() => detectAttachment("evil.png", PDF)).toThrow();
    expect(cleanFilename("..\\..\\secret/../report\u0000\n.pdf")).toBe("report.pdf");
    expect(detectAttachment("C:\\fakepath\\ok.pdf", PDF).filename).toBe("ok.pdf");
  });

  it("builds a header-safe download name", () => {
    const h = contentDisposition('a"b\r\nSet-Cookie: x=1.pdf');
    expect(h).not.toMatch(/[\r\n]/);
    expect(h.startsWith("attachment;")).toBe(true);
  });
});

describe("POST /api/admin/attachments", () => {
  it("stores a file for an admin, records it in the history, and keeps it apart from the datasets", async () => {
    const before = (await q("select (select count(*) from service_datasets)::int a, (select count(*) from service_dataset_rows)::int b")).rows[0] as any;
    const res = await post(body("Report 2025.pdf", PDF, "text/html")); // the lying browser type is ignored
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.attachment).toMatchObject({ filename: "Report 2025.pdf", type: "pdf", size: PDF.length });
    expect(j.attachment.key).toMatch(/^[0-9a-f]{32}$/);
    const stored = (await q("select detected_type, content_type, size_bytes, uploaded_by from upload_attachments")).rows[0] as any;
    expect(stored).toMatchObject({ detected_type: "pdf", content_type: "application/pdf", size_bytes: PDF.length });
    expect(String(stored.uploaded_by)).toBe(admin.id);
    const log = (await q("select kind, action, result, file_size, attachment_id from upload_audit_log")).rows as any[];
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: "attachment", action: "upload", result: "success", file_size: PDF.length });
    expect(log[0].attachment_id).not.toBeNull();
    const after = (await q("select (select count(*) from service_datasets)::int a, (select count(*) from service_dataset_rows)::int b")).rows[0] as any;
    expect(after).toEqual(before);
  });

  it("warns, but still stores, when the same contents were uploaded before", async () => {
    await post(body("one.pdf", PDF));
    const j = await (await post(body("two.pdf", PDF))).json();
    expect(j.warning).toContain("one.pdf");
    expect((await q("select count(*)::int n from upload_attachments")).rows[0]).toEqual({ n: 2 });
  });

  it("rejects a bad file with a clear message, stores nothing and logs the rejection", async () => {
    const res = await post(body("fake.pdf", "this is not a pdf"));
    expect(res.status).toBe(415);
    expect((await res.json()).error).toBe("CONTENT_MISMATCH");
    expect((await q("select count(*)::int n from upload_attachments")).rows[0]).toEqual({ n: 0 });
    const log = (await q("select result, detail, filename from upload_audit_log")).rows[0] as any;
    expect(log).toMatchObject({ result: "rejected", filename: "fake.pdf" });
  });

  it("rejects an oversized upload with 413 before reading it all", async () => {
    const res = await post(body("big.pdf", Buffer.concat([PDF, Buffer.alloc(MAX_ATTACHMENT_BYTES)])));
    expect(res.status).toBe(413);
    expect((await q("select count(*)::int n from upload_attachments")).rows[0]).toEqual({ n: 0 });
  });

  it("refuses a request that is not multipart, or has no file", async () => {
    const r1 = await upload(new Request("http://localhost/api/admin/attachments", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(r1.status).toBe(415);
    const f = new FormData(); f.append("file", "just text, not a file");
    expect((await post(f)).status).toBe(400);
  });

  it("limits how many uploads one admin can make in a short time", async () => {
    for (let i = 0; i < UPLOADS_PER_WINDOW; i++) await q("insert into upload_audit_log (user_id, action, result) values ($1,'upload','rejected')", [admin.id]);
    const res = await post(body("a.pdf", PDF));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect((await q("select count(*)::int n from upload_attachments")).rows[0]).toEqual({ n: 0 });
  });

  it("says storage is not set up (503) while migration 009 is missing, and changes nothing", async () => {
    await q("alter table upload_attachments rename to upload_attachments_hidden"); // shared harness: put it back below
    try {
      const res = await post(body("a.pdf", PDF));
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe("NOT_SET_UP");
    } finally { await q("alter table upload_attachments_hidden rename to upload_attachments"); }
  });

  it("is admin only: 401 for visitors, 403 for regular users, a forged cookie and a foreign origin", async () => {
    m.cookie = undefined;
    expect((await post(body("a.pdf", PDF))).status).toBe(401);
    const u = await seedUser({ email: "t@example.com", role: "TC" });
    signIn(u.id, "TC");
    expect((await post(body("a.pdf", PDF))).status).toBe(403);
    signIn(u.id, "admin"); // cookie claims admin, database says TC
    expect((await post(body("a.pdf", PDF))).status).toBe(403);
    signIn(admin.id);
    expect((await post(body("a.pdf", PDF), { origin: "https://evil.example" })).status).toBe(403);
    m.cookie = "garbage";
    expect((await post(body("a.pdf", PDF))).status).toBe(401);
    expect((await q("select count(*)::int n from upload_attachments")).rows[0]).toEqual({ n: 0 });
  });
});

describe("GET /api/admin/attachments/[key]", () => {
  async function stored(name = "My report.pdf", buf = PDF) {
    return (await (await post(body(name, buf))).json()).attachment.key as string;
  }

  it("lets an admin download the exact bytes, always as an attachment with safe headers", async () => {
    const key = await stored();
    const res = await get(key);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("content-disposition")).toContain("My_report.pdf");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("serves a png as an attachment too (never inline)", async () => {
    const res = await get(await stored("pic.png", PNG));
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("answers 404 for unknown or malformed keys and never runs a query for a malformed one", async () => {
    expect((await get("0".repeat(32))).status).toBe(404);
    for (const bad of ["../etc/passwd", "ABC", "1", "g".repeat(32), "0".repeat(31), "0".repeat(33), "1 OR 1=1", "%00"]) expect((await get(bad)).status, bad).toBe(404);
  });

  it("is admin only", async () => {
    const key = await stored();
    m.cookie = undefined;
    expect((await get(key)).status).toBe(401);
    const u = await seedUser({ email: "t@example.com", role: "ST" });
    signIn(u.id, "ST");
    expect((await get(key)).status).toBe(403);
    signIn(admin.id);
    expect((await get(key, { origin: "https://evil.example" })).status).toBe(403);
    expect((await get(key)).status).toBe(200);
  });
});

describe("upload history page", () => {
  const page = async (sp: object = {}) => renderToStaticMarkup((await UploadHistoryPage({ searchParams: Promise.resolve(sp) })) as React.ReactElement);

  it("lists dataset and file uploads with a download link only for stored files", async () => {
    const key = (await (await post(body("notes.pdf", PDF))).json()).attachment.key as string;
    await post(body("fake.pdf", "nope"));
    await q("insert into upload_audit_log (user_id, action, result, filename, detail) values ($1,'upload','success','schools.xlsx','atl-labs: 10 rows'), ($1,'confirm','success','schools.xlsx','atl-labs: 10 rows now live')", [admin.id]);
    const h = await page();
    expect(h).toContain("notes.pdf");
    expect(h).toContain("schools.xlsx");
    expect(h).toContain("Made live");
    expect(h).toContain("Rejected");
    expect(h).toContain("boss@robovalley.com");
    expect(h).toContain(`href="/api/admin/attachments/${key}"`);
    expect((h.match(/>Download</g) ?? []).length).toBe(1);
    expect(h).not.toMatch(/\.xlsx[^<]*<\/td><td>[^<]*<\/td><td><span[^>]*>[^<]*<\/span><\/td><td[^>]*>[^<]*<\/td><td[^>]*>[^<]*<\/td><td><a/); // no link on dataset rows
  });

  it("filters by type and result and ignores unknown filters", async () => {
    await post(body("notes.pdf", PDF));
    await q("insert into upload_audit_log (user_id, action, result, filename) values ($1,'upload','success','schools.xlsx')", [admin.id]);
    const files = await page({ kind: "attachment" });
    expect(files).toContain("notes.pdf"); expect(files).not.toContain("schools.xlsx");
    const ds = await page({ kind: "dataset", result: "success" });
    expect(ds).toContain("schools.xlsx"); expect(ds).not.toContain("notes.pdf");
    expect(await page({ kind: "x'; drop table users;--", result: "nope" })).toContain("notes.pdf");
  });

  it("works, with a setup notice, while migration 009 is missing", async () => {
    await q("insert into upload_audit_log (user_id, action, result, filename) values ($1,'upload','success','schools.xlsx')", [admin.id]);
    await q("alter table upload_attachments rename to upload_attachments_hidden");
    let h: string;
    try { h = await page(); } finally { await q("alter table upload_attachments_hidden rename to upload_attachments"); }
    expect(h).toContain("schools.xlsx");
    expect(h).toContain("not set up yet");
    expect(h).toContain("migration 009");
  });

  it("shows an empty state, and refuses visitors and regular users", async () => {
    expect(await page()).toContain("No uploads yet.");
    m.cookie = undefined;
    await expect(page()).rejects.toThrow("REDIRECT:/login");
    const u = await seedUser({ email: "t@example.com", role: "ST" });
    signIn(u.id, "ST");
    await expect(page()).rejects.toThrow("REDIRECT:/dashboard");
  });
});

describe("upload page", () => {
  it("renders the form for admins and is closed to everyone else", async () => {
    const h = renderToStaticMarkup((await UploadPage({ searchParams: Promise.resolve({ category: "stem-labs" }) })) as React.ReactElement);
    expect(h).toContain("School data for a category");
    expect(h).toContain("STEM Labs");
    expect(h).toContain("Upload and preview");
    m.cookie = undefined;
    await expect(UploadPage()).rejects.toThrow("REDIRECT:/login");
  });
});
