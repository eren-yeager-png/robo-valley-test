// Migration status (schema probes), the runner's skip/guard behaviour, and chain-level safety:
// repeat runs, data preservation, foreign keys and the per-category active-dataset rule. All on in-process databases.
import { PGlite } from "@electric-sql/pglite";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { seedUser, testDb } from "./helpers";
import { TEST_DATABASE_URL } from "./setup";
import { applyFile, hintFor, pickFiles } from "../scripts/migrate.mjs";
import { evaluate, formatStatus, MIGRATIONS, migrationStatus, pending, readSnapshot, statusOf } from "../scripts/migration-status.mjs";

const file = (name: string) => readFileSync(resolve("db", name), "utf8");
const migration = (id: string) => file("migrations/" + pickFiles({ only: id })[0]!.split(/[\\/]/).pop());
const rollback = (id: string) => file(`rollback/${id}_down.sql`);

const runnerFor = (pg: PGlite) => ({
  setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]),
  exec: (sql: string) => pg.exec(sql),
});
const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p);
const status = async () => migrationStatus((sql: string) => testDb().raw.query(sql) as any);
const byId = (r: any[], id: string) => statusOf(r, id)!;
async function dbName() { return String(((await q("select current_database() as d")).rows[0] as any).d); }
async function reapply(id: string) { await applyFile(runnerFor(testDb().raw as unknown as PGlite), await dbName(), migration(id)); }
async function rollBack(id: string) { await applyFile(runnerFor(testDb().raw as unknown as PGlite), await dbName(), rollback(id)); }

describe("status probes", () => {
  it("covers exactly the migration files, in order", () => {
    const files = pickFiles().map((f) => f.split(/[\\/]/).pop()!.slice(0, 3));
    expect(MIGRATIONS.map((m) => m.id)).toEqual(files);
    expect(files).toEqual(["001", "002", "003", "004", "005", "006", "007", "008", "009", "010", "011", "012", "013", "014", "015", "016"]);
  });

  it("reports every migration applied on a fully migrated database", async () => {
    const r = await status();
    expect(r.map((x: any) => [x.id, x.status])).toEqual(MIGRATIONS.map((m) => [m.id, "applied"]));
    expect(pending(r)).toEqual([]);
    expect(formatStatus(r)).toContain("Everything is applied.");
  });

  it("reports everything missing, and the dependants as blocked, on an empty database", async () => {
    const empty = new PGlite();
    const r = await migrationStatus((sql: string) => empty.query(sql) as any);
    expect(r.every((x: any) => x.status === "missing")).toBe(true);
    expect(byId(r, "007").blockedBy).toEqual(["005"]);
    expect(byId(r, "009").blockedBy).toEqual(["005"]);
    expect(byId(r, "008").blockedBy).toEqual([]);
    expect(formatStatus(r)).toContain("To do: 001, 002");
  });

  it("detects a missing migration (008 rolled back) without disturbing the others, and that it is applied again afterwards", async () => {
    await rollBack("008");
    try {
      const r = await status();
      expect(byId(r, "008").status).toBe("missing");
      expect(byId(r, "008").feature).toContain("Login Activity");
      expect(r.filter((x: any) => x.status !== "applied").map((x: any) => x.id)).toEqual(["008"]);
      expect(formatStatus(r)).toMatch(/008\s+MISSING/);
    } finally { await reapply("008"); }
    expect(byId(await status(), "008").status).toBe("applied");
  });

  it("detects a missing 009 (tables and columns) as missing, with the upload history rows kept", async () => {
    const boss = await seedUser({ email: "boss@example.com", role: "admin" });
    await q("insert into upload_audit_log (user_id, action, result, filename) values ($1,'upload','success','keep.xlsx')", [boss.id]);
    await rollBack("009");
    try {
      expect(byId(await status(), "009").status).toBe("missing");
      expect((await q("select filename from upload_audit_log")).rows).toEqual([{ filename: "keep.xlsx" }]);
    } finally { await reapply("009"); }
    expect(byId(await status(), "009").status).toBe("applied");
    expect((await q("select filename, kind from upload_audit_log")).rows).toEqual([{ filename: "keep.xlsx", kind: "dataset" }]);
  });

  it("detects a partly applied migration and lists exactly what is missing", async () => {
    await q("alter table upload_audit_log drop constraint upload_audit_log_attachment_kind_ck");
    await q("drop index upload_attachments_sha_idx");
    try {
      const m9 = byId(await status(), "009");
      expect(m9.status).toBe("partial");
      expect(m9.absent).toEqual(["index upload_attachments_sha_idx", "constraint upload_audit_log_attachment_kind_ck"].sort((a, b) => m9.absent.indexOf(a) - m9.absent.indexOf(b)));
      expect(m9.absent).toHaveLength(2);
      expect(m9.present.length).toBeGreaterThan(5);
      expect(formatStatus(await status())).toMatch(/009\s+PARTIAL/);
    } finally { await reapply("009"); }
    expect(byId(await status(), "009").status).toBe("applied");
  });

  it("treats 007 as partial while the old single-active index is still there", async () => {
    await q("create unique index service_datasets_one_active on service_datasets ((true)) where status = 'active'");
    try {
      const m7 = byId(await status(), "007");
      expect(m7.status).toBe("partial");
      expect(m7.absent).toEqual(["old index service_datasets_one_active replaced"]);
    } finally { await q("drop index service_datasets_one_active"); }
    expect(byId(await status(), "007").status).toBe("applied");
  });

  it("only ever reads: every statement is a SELECT on the system catalogs", async () => {
    const seen: string[] = [];
    await migrationStatus(async (sql: string) => { seen.push(sql.trim()); return testDb().raw.query(sql) as any; });
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) expect(s, s).toMatch(/^SELECT /);
    expect(seen.join("\n")).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/i);
  });

  it("evaluate() works on a hand-made snapshot", async () => {
    const snap = await readSnapshot((sql: string) => testDb().raw.query(sql) as any);
    snap.tables.delete("pincode_locations");
    expect(byId(evaluate(snap), "006").status).toBe("partial");
  });
});

describe("running the whole chain again", () => {
  it("is safe: no errors, same schema, and existing rows are untouched", async () => {
    const u = await seedUser({ email: "asha@example.com", role: "ST" });
    await q(`insert into service_datasets (uploaded_by, original_filename, file_sha256, row_count, status, category, activated_at)
             values ($1,'keep.xlsx',repeat('a',64),1,'active','stem-labs',now())`, [u.id]);
    await q("insert into login_events (event_type, user_id) values ('login_success',$1)", [u.id]);
    await q("insert into upload_audit_log (user_id, action, result, filename) values ($1,'upload','success','keep.xlsx')", [u.id]);
    const counts = async () => (await q(`select (select count(*) from users)::int u, (select count(*) from service_datasets)::int d, (select count(*) from login_events)::int e, (select count(*) from upload_audit_log)::int a`)).rows[0];
    const schema = async () => (await q(`select table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema = current_schema() order by 1, 2`)).rows;
    const indexes = async () => (await q("select indexname, indexdef from pg_indexes where schemaname = current_schema() order by 1")).rows;
    const cons = async () => (await q("select conname, pg_get_constraintdef(oid) d from pg_constraint order by 1")).rows;
    const before = { c: await counts(), s: await schema(), i: await indexes(), k: await cons() };
    const run = runnerFor(testDb().raw as unknown as PGlite);
    const name = await dbName();
    for (let pass = 0; pass < 2; pass++) for (const f of pickFiles()) await applyFile(run, name, readFileSync(f, "utf8"));
    expect({ c: await counts(), s: await schema(), i: await indexes(), k: await cons() }).toEqual(before);
    expect(pending(await status())).toEqual([]);
  });

  it("refuses the wrong database name and changes nothing", async () => {
    const run = runnerFor(testDb().raw as unknown as PGlite);
    await expect(applyFile(run, "some_other_database", migration("008"))).rejects.toThrow(/Wrong database/);
    expect(pending(await status())).toEqual([]);
  });

  it("an empty database can be built up one migration at a time in order, and the status follows along", async () => {
    // The tests' base fixture (users, guardian_details), then 001..009 one by one on a private database.
    const pg = new PGlite();
    await pg.exec(readFileSync(resolve("tests/helpers/baseSchema.sql"), "utf8"));
    const name = String(((await pg.query("select current_database() as d")).rows[0] as any).d);
    const run = runnerFor(pg);
    let applied = 0;
    for (const f of pickFiles()) {
      await applyFile(run, name, readFileSync(f, "utf8"));
      applied++;
      const r = await migrationStatus((sql: string) => pg.query(sql) as any);
      expect(r.filter((x: any) => x.status === "applied").length).toBeGreaterThanOrEqual(applied);
      expect(r.slice(0, applied).every((x: any) => x.status === "applied")).toBe(true);
    }
    expect(pending(await migrationStatus((sql: string) => pg.query(sql) as any))).toEqual([]);
  });
});

describe("constraints that must keep holding", () => {
  const ds = (uploader: string, category: string, status: string, n: number) =>
    q(`insert into service_datasets (uploaded_by, original_filename, file_sha256, row_count, status, category) values ($1,$2,repeat('b',64),1,$3::varchar(20),$4)`, [uploader, `f${n}.xlsx`, status, category]);

  it("allows one active dataset per category, several categories at once, and many non-active versions", async () => {
    const u = (await seedUser({ email: "a@example.com", role: "admin" })).id;
    await ds(u, "atl-labs", "active", 1);
    await ds(u, "stem-labs", "active", 2);
    await ds(u, "atl-labs", "superseded", 3);
    await ds(u, "atl-labs", "superseded", 4);
    await ds(u, "atl-labs", "staged", 5);
    await expect(ds(u, "atl-labs", "active", 6)).rejects.toThrow(/service_datasets_one_active_per_category|duplicate key/);
    await expect(ds(u, "not-a-category", "staged", 7)).rejects.toThrow(/service_datasets_category_check/);
  });

  it("keeps the foreign keys on the new tables", async () => {
    const fks = (await q(`select conrelid::regclass::text t, confrelid::regclass::text r, confdeltype d from pg_constraint where contype = 'f' and conrelid::regclass::text in ('login_events','upload_attachments','upload_attachment_blobs','upload_audit_log') order by 1, 2`)).rows as any[];
    expect(fks).toEqual(expect.arrayContaining([
      { t: "login_events", r: "users", d: "n" },
      { t: "upload_attachments", r: "users", d: "a" },
      { t: "upload_attachment_blobs", r: "upload_attachments", d: "c" },
      { t: "upload_audit_log", r: "upload_attachments", d: "n" },
    ]));
  });

  it("rolling 007 back and forward again keeps every dataset and puts it back in the ATL Labs list", async () => {
    const u = (await seedUser({ email: "a@example.com", role: "admin" })).id;
    await ds(u, "atl-labs", "active", 1);
    const before = (await q("select original_filename, status from service_datasets")).rows;
    const run = runnerFor(testDb().raw as unknown as PGlite);
    await applyFile(run, await dbName(), rollback("007"));
    try { expect(byId(await status(), "007").status).toBe("missing"); } finally { await reapply("007"); }
    expect(byId(await status(), "007").status).toBe("applied");
    expect((await q("select original_filename, status from service_datasets")).rows).toEqual(before);
  });
});

describe("runner command line", () => {
  const run = (args: string[]) => {
    const r = spawnSync(process.execPath, [resolve("scripts/migrate.mjs"), ...args], {
      encoding: "utf8", timeout: 20_000,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DATABASE_URL: TEST_DATABASE_URL } as unknown as NodeJS.ProcessEnv,
    });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
  };

  it("--status cannot be combined with anything that writes", () => {
    for (const extra of [["--apply"], ["--force"], ["--only", "008"], ["--file", "db/rollback/008_down.sql"]]) {
      const r = run(["--expect-db", "never_connects", "--status", ...extra]);
      expect(r.code, extra.join(" ")).toBe(1);
      expect(r.out).toMatch(/--status only reads/);
      expect(r.out).toMatch(/Nothing was changed/);
    }
  });

  it("--status still needs the database name to be confirmed", () => {
    expect(run(["--status"]).out).toMatch(/Missing --expect-db/);
    expect(run(["--status", "--expect-db", "wrong_name"]).out).toMatch(/points to database "never_connects" but you confirmed "wrong_name"/);
  });

  it("--status against an unreachable database fails with one clear line and changes nothing", () => {
    const r = run(["--expect-db", "never_connects", "--status"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Nothing further was changed|Nothing was changed/);
    expect(r.out).not.toMatch(/tests-only|127\.0\.0\.1/); // no user name, host or URL
  });

  it("the dry run points at --status and still connects to nothing", () => {
    const r = run(["--expect-db", "never_connects", "--only", "008"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/DRY RUN/);
    expect(r.out).toMatch(/--status/);
  });

  it("explains common failures in plain English", () => {
    expect(hintFor({ code: "42P01" })).toMatch(/earlier migration is probably missing/);
    expect(hintFor({ code: "23514" })).toMatch(/Nothing was changed/);
    expect(hintFor(new Error("x"))).toBe("");
  });
});
