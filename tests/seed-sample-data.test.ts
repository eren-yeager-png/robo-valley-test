// The development sample-data script: safety guards, repeatability, validity, reset that touches only sample rows,
// and that the sample data produces meaningful report numbers. In-process database only.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { seedUser, testDb } from "./helpers";
import { TEST_DATABASE_URL } from "./setup";
import { assertSafeTarget, buildSampleFiles, DATASET_PLAN, ID_BASE, ID_END, reset, SAMPLE_DOMAIN, seed } from "../scripts/seed-sample-data.mjs";
import { CATEGORIES } from "../src/lib/serviceCategories";
import { detectAttachment, getAttachment } from "../src/lib/attachments";
import { datasetsByCategory, loginsByDay, registrationsByDay, uploadsByDay } from "../src/lib/adminStats";
import { listHistory } from "../src/lib/uploadHistory";
import { EVENT_TYPES, REASONS } from "../src/lib/loginEvents";

const raw = () => testDb().raw as any;
const db = () => ({ query: async (sql: string, p?: unknown[]) => { const r = await raw().query(sql, p); return { rows: r.rows as any[], rowCount: r.affectedRows as number | undefined }; } });
const q = async (sql: string, p: unknown[] = []) => (await raw().query(sql, p)).rows as any[];
const now = new Date("2026-03-01T12:00:00Z");
const load = () => seed(db(), { now, rounds: 4 });
const snapshot = async () => (await q(`select (select count(*) from users)::int users, (select count(*) from service_datasets)::int datasets, (select count(*) from service_dataset_rows)::int rows,
  (select count(*) from login_events)::int events, (select count(*) from upload_attachments)::int attachments, (select count(*) from upload_attachment_blobs)::int blobs, (select count(*) from upload_audit_log)::int audit`))[0];

describe("safety guards", () => {
  const ok = { url: "postgresql://u:p@localhost:5433/robovalley_dev", expectDb: "robovalley_dev", env: {} as NodeJS.ProcessEnv };
  it("accepts a local database whose name was confirmed", () => {
    expect(assertSafeTarget(ok)).toBe("robovalley_dev");
    expect(assertSafeTarget({ ...ok, url: "postgresql://u:p@127.0.0.1/robovalley_dev" })).toBe("robovalley_dev");
    expect(assertSafeTarget({ ...ok, url: "postgresql://u:p@[::1]/robovalley_dev" })).toBe("robovalley_dev");
  });
  it.each([
    ["a remote host", { url: "postgresql://u:p@db.example.com/robovalley_dev" }, /not on this computer/],
    ["a Neon-style host", { url: "postgresql://u:p@ep-cool-123.ap-southeast-1.aws.neon.tech/neondb" , expectDb: "neondb" }, /not on this computer/],
    ["a look-alike host name", { url: "postgresql://u:p@localhost.evil.example/robovalley_dev" }, /not on this computer/],
    ["production mode", { env: { NODE_ENV: "production" } as NodeJS.ProcessEnv }, /NODE_ENV is production/],
    ["a missing confirmation", { expectDb: undefined }, /Missing --expect-db/],
    ["a different confirmed name", { expectDb: "something_else" }, /confirmed "something_else"/],
    ["no DATABASE_URL", { url: "" }, /DATABASE_URL is not set/],
  ])("refuses %s", (_n, over, msg) => {
    expect(() => assertSafeTarget({ ...ok, ...over })).toThrow(msg as RegExp);
  });
});

describe("loading the sample data", () => {
  beforeEach(() => { /* each test gets an empty database from ./helpers */ });

  it("adds users, datasets, files, history and login activity, and a second run adds nothing", async () => {
    const first = await load();
    expect(first).toMatchObject({ users: 25, datasets: DATASET_PLAN.reduce((n, c) => n + c.versions.length, 0), attachments: 7, realLiveKept: [] });
    expect(first.events).toBeGreaterThan(400);
    const after = await snapshot();
    const second = await load();
    expect(second).toMatchObject({ users: 0, datasets: 0, datasetRows: 0, attachments: 0, events: 0, audit: 0 });
    expect(await snapshot()).toEqual(after);
  });

  it("creates students, parents, teachers and a sample admin only on the reserved e-mail domain", async () => {
    await load();
    const users = await q("select role, email from users order by id");
    const count = (r: string) => users.filter((u) => u.role === r).length;
    expect([count("ST"), count("PA"), count("TC"), count("admin")]).toEqual([12, 6, 6, 1]);
    expect(users.every((u) => u.email.endsWith("@" + SAMPLE_DOMAIN))).toBe(true);
  });

  it("only the sample admin can sign in as admin when asked, otherwise nobody knows its password", async () => {
    const bcrypt = (await import("bcryptjs")).default;
    await load();
    const noLogin = (await q("select password_hash from users where role = 'admin'"))[0].password_hash;
    expect(await bcrypt.compare("SamplePass#2025", noLogin)).toBe(false);
    await seed(db(), { now, rounds: 4, withAdmin: true });
    const withLogin = (await q("select password_hash, must_change_password from users where role = 'admin'"))[0];
    expect(await bcrypt.compare("SamplePass#2025", withLogin.password_hash)).toBe(true);
    expect(withLogin.must_change_password).toBe(false);
  });

  it("keeps the rule: exactly one live dataset in every category, with history and staged versions", async () => {
    await load();
    const rows = await q("select category, status, count(*)::int n from service_datasets group by 1, 2 order by 1, 2");
    for (const c of CATEGORIES) expect(rows.find((r) => r.category === c.slug && r.status === "active")?.n, c.slug).toBe(1);
    expect(rows.filter((r) => r.status === "superseded").length).toBeGreaterThanOrEqual(3);
    expect(rows.filter((r) => r.status === "staged").length).toBeGreaterThanOrEqual(1);
    for (const d of await q("select id, row_count, (select count(*)::int from service_dataset_rows r where r.dataset_id = d.id) n from service_datasets d")) expect(d.n).toBe(d.row_count);
  });

  it("uses only allowed event types, reasons and purposes, covers all seven types and never records the future", async () => {
    await load();
    const types = (await q("select distinct event_type t from login_events")).map((r) => r.t).sort();
    expect(types).toEqual([...EVENT_TYPES].sort());
    for (const r of await q("select distinct reason from login_events where reason is not null")) expect(REASONS).toContain(r.reason);
    expect((await q("select count(*)::int n from login_events where created_at > $1", [now]))[0].n).toBe(0);
    expect((await q("select count(*)::int n from login_events where purpose is not null and event_type not like 'otp_%'"))[0].n).toBe(0);
  });

  it("stores one real, valid file for each of the seven approved types, with correct sizes, hashes and downloadable bytes", async () => {
    await load();
    const meta = await q("select a.storage_key, a.original_filename, a.detected_type, a.size_bytes, a.file_sha256, octet_length(b.content) len from upload_attachments a join upload_attachment_blobs b on b.attachment_id = a.id order by a.id");
    expect(meta.map((m) => m.detected_type).sort()).toEqual(["csv", "docx", "jpg", "pdf", "png", "txt", "xlsx"]);
    const crypto = await import("node:crypto");
    for (const m of meta) {
      const file = await getAttachment(db() as any, m.storage_key);
      expect(file, m.original_filename).not.toBeNull();
      expect(file!.content.length).toBe(Number(m.size_bytes));
      expect(Number(m.len)).toBe(Number(m.size_bytes));
      expect(crypto.createHash("sha256").update(file!.content).digest("hex")).toBe(m.file_sha256);
      expect(detectAttachment(m.original_filename, file!.content).type).toBe(m.detected_type); // passes the same content check as a real upload
    }
    expect((await buildSampleFiles()).map((f) => f.type).sort()).toEqual(["csv", "docx", "jpg", "pdf", "png", "txt", "xlsx"]);
    // every history row that links a file points at a file that exists
    expect((await q("select count(*)::int n from upload_audit_log l where l.attachment_id is not null and not exists (select 1 from upload_attachments a where a.id = l.attachment_id)"))[0].n).toBe(0);
    expect((await q("select count(*)::int n from upload_audit_log where kind = 'attachment' and result = 'success' and attachment_id is null"))[0].n).toBe(0);
  });

  it("gives the admin pages' queries meaningful numbers for every chart", async () => {
    await load();
    const reg = await registrationsByDay(db() as any, 90);
    // the 'now' used here is in the past, so look at the whole table instead of the window
    expect((await q("select count(*)::int n from users where role <> 'admin'"))[0].n).toBe(24);
    expect(reg).toHaveLength(90);
    const cats = await datasetsByCategory(db() as any);
    expect(cats.every((c) => c.active && c.datasets >= 1 && c.rows > 0)).toBe(true);
    expect(cats.some((c) => c.datasets >= 3)).toBe(true);
    const history = await listHistory(db() as any, { page: 1, hasAttachments: true });
    expect(history.total).toBeGreaterThan(30);
    expect(new Set(history.rows.map((r) => r.result)).size).toBeGreaterThanOrEqual(2);
    void loginsByDay; void uploadsByDay;
  });

  it("charts have data when loaded 'now' (relative dates)", async () => {
    await seed(db(), { now: new Date(), rounds: 4 });
    const reg = await registrationsByDay(db() as any, 90);
    expect(reg.reduce((n, p) => n + Number(p.registrations), 0)).toBe(24);
    const logins = await loginsByDay(db() as any, 90);
    expect(logins.reduce((n, p) => n + Number(p.success), 0)).toBeGreaterThan(100);
    expect(logins.reduce((n, p) => n + Number(p.failed), 0)).toBeGreaterThan(20);
    expect(logins.filter((p) => Number(p.success) > 0).length).toBeGreaterThan(60); // a trend, not a single spike
    const ups = await uploadsByDay(db() as any, 90);
    expect(ups.reduce((n, p) => n + Number(p.accepted), 0)).toBeGreaterThan(10);
    expect(ups.reduce((n, p) => n + Number(p.rejected), 0)).toBeGreaterThanOrEqual(3);
  });

  it("puts every non-user sample row in the reserved id range", async () => {
    await load();
    for (const t of ["service_datasets", "service_dataset_rows", "login_events", "upload_attachments", "upload_audit_log"]) {
      expect((await q(`select count(*)::int n from ${t} where id < $1 or id > $2`, [ID_BASE, t === "service_dataset_rows" ? ID_END * 1000 : ID_END]))[0].n, t).toBe(0);
    }
  });
});

describe("real data and reset", () => {
  it("never replaces a real live dataset, and leaves real rows alone", async () => {
    const real = await seedUser({ email: "real.person@example.com", role: "TC" });
    await q(`insert into service_datasets (uploaded_by, original_filename, file_sha256, row_count, status, category, activated_at) values ($1,'real-atl.xlsx',repeat('c',64),1,'active','atl-labs',now())`, [real.id]);
    const r = await load();
    expect(r.realLiveKept).toEqual(["atl-labs"]);
    expect((await q("select original_filename from service_datasets where category = 'atl-labs' and status = 'active'")).map((x) => x.original_filename)).toEqual(["real-atl.xlsx"]);
    expect((await q("select count(*)::int n from service_datasets where status = 'active'"))[0].n).toBe(6);
  });

  it("--reset removes exactly the sample records and nothing else", async () => {
    const real = await seedUser({ email: "real.person@example.com", role: "TC" });
    await q(`insert into service_datasets (uploaded_by, original_filename, file_sha256, row_count, status, category, activated_at) values ($1,'real-atl.xlsx',repeat('c',64),1,'active','atl-labs',now())`, [real.id]);
    await q("insert into login_events (event_type, user_id) values ('login_success', $1)", [real.id]);
    await q("insert into upload_audit_log (user_id, action, result, filename) values ($1,'upload','success','real-atl.xlsx')", [real.id]);
    const before = await snapshot();
    await load();
    expect(await snapshot()).not.toEqual(before);
    const removed = await reset(db());
    expect(removed).toMatchObject({ users: 25, usersKept: 0, datasets: 14 });
    expect(await snapshot()).toEqual(before);
    expect((await q("select email from users")).map((u) => u.email)).toEqual(["real.person@example.com"]);
    expect((await q("select original_filename from service_datasets")).map((d) => d.original_filename)).toEqual(["real-atl.xlsx"]);
    // and it can be repeated, and the data can be loaded again afterwards
    expect(await reset(db())).toMatchObject({ users: 0, datasets: 0, events: 0, audit: 0, attachments: 0 });
    expect((await load()).users).toBe(25);
  });

  it("keeps a sample account that real data now refers to, and says so", async () => {
    await load();
    const admin = (await q("select id from users where role = 'admin'"))[0].id;
    await q(`insert into service_datasets (uploaded_by, original_filename, file_sha256, row_count, status, category) values ($1,'uploaded-while-testing.xlsx',repeat('d',64),1,'staged','stem-labs')`, [admin]);
    const removed = await reset(db());
    expect(removed.usersKept).toBe(1);
    expect((await q("select original_filename from service_datasets")).map((d) => d.original_filename)).toEqual(["uploaded-while-testing.xlsx"]);
  });
});

describe("command line", () => {
  const run = (args: string[], env: Record<string, string | undefined> = {}) => {
    const r = spawnSync(process.execPath, [resolve("scripts/seed-sample-data.mjs"), ...args], {
      encoding: "utf8", timeout: 30_000,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DATABASE_URL: TEST_DATABASE_URL, ...env } as unknown as NodeJS.ProcessEnv,
    });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
  };
  it("is a dry run by default: it lists what it would add and connects to nothing", () => {
    const r = run(["--expect-db", "never_connects"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/DRY RUN/);
    expect(r.out).toMatch(/"datasets":14/);
  });
  it("refuses a remote or production-looking target, with or without --apply", () => {
    for (const args of [["--expect-db", "neondb", "--apply"], ["--expect-db", "neondb"], ["--expect-db", "neondb", "--reset", "--apply"]]) {
      const r = run(args, { DATABASE_URL: "postgresql://user:secret@ep-cool-123.neon.tech/neondb?sslmode=require" });
      expect(r.code, args.join(" ")).toBe(1);
      expect(r.out).toMatch(/not on this computer/);
      expect(r.out).not.toMatch(/secret|ep-cool/);
    }
    expect(run(["--expect-db", "never_connects"], { NODE_ENV: "production" }).out).toMatch(/NODE_ENV is production/);
  });
  it("needs --expect-db and rejects unknown options", () => {
    expect(run([]).out).toMatch(/Missing --expect-db/);
    expect(run(["--expect-db", "never_connects", "--wipe"]).out).toMatch(/Unknown option: --wipe/);
  });
  it("--apply against an unreachable local database fails with one clear line", () => {
    const r = run(["--expect-db", "never_connects", "--apply"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Could not connect/);
  });
});
