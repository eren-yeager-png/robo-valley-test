// Migration 005 (service datasets) and its rollback, on an in-process PostgreSQL (PGlite). No real database.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { applyFile, pickFiles } from "../scripts/migrate.mjs";

const read = (p: string) => readFileSync(resolve(p), "utf8");
const runner = (pg: PGlite) => ({
  setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]),
  exec: (sql: string) => pg.exec(sql),
});
const dbOf = async (pg: PGlite) => String((await pg.query("select current_database() d")).rows[0]!["d" as never]);
const tables = async (pg: PGlite) =>
  (await pg.query("select table_name t from information_schema.tables where table_schema='public' order by 1")).rows.map((r: any) => r.t);
const NEW = ["service_dataset_rows", "service_datasets", "upload_audit_log"];

async function migrated() {
  const pg = new PGlite();
  await pg.exec(read("tests/helpers/baseSchema.sql"));
  const name = await dbOf(pg);
  for (const f of pickFiles()) await applyFile(runner(pg), name, read(f));
  return { pg, name };
}

describe("migration 005", () => {
  let pg: PGlite; let name: string;
  beforeAll(async () => { ({ pg, name } = await migrated()); });

  it("creates the three tables and is safe to run twice", async () => {
    expect(await tables(pg)).toEqual(expect.arrayContaining(NEW));
    await applyFile(runner(pg), name, read("db/migrations/005_service_datasets.sql"));
    expect(await tables(pg)).toEqual(expect.arrayContaining(NEW));
  });

  it("refuses to run when the target database was not confirmed", async () => {
    const other = new PGlite();
    await other.exec(read("tests/helpers/baseSchema.sql"));
    await expect(other.exec(read("db/migrations/005_service_datasets.sql"))).rejects.toThrow(/not set/);
    await other.exec("ROLLBACK");
    expect(await tables(other)).not.toContain("service_datasets");
    await other.close();
  });

  it("rejects an unknown status and a second active dataset", async () => {
    await pg.exec("insert into users (full_name,email,role,password_hash) values ('A','a@e.co','admin','x')");
    const ins = (status: string) => pg.query("insert into service_datasets (uploaded_by, original_filename, file_sha256, row_count, status) values (1, 'f.csv', repeat('a',64), 0, $1)", [status]);
    await expect(ins("bogus")).rejects.toThrow();
    await ins("active");
    await expect(ins("active")).rejects.toThrow();
    await ins("superseded");
    await ins("staged");
  });

  it("the rollback is guarded, removes only the three new tables and leaves accounts alone", async () => {
    const { pg: p, name: n } = await migrated();
    await p.exec("insert into users (full_name,email,role,password_hash) values ('A','a@e.co','ST','x')");
    await p.query("select set_config('rv.expected_db', '', false)");
    await expect(p.exec(read("db/rollback/005_down.sql"))).rejects.toThrow(/not set/);
    await p.exec("ROLLBACK");
    expect(await tables(p)).toEqual(expect.arrayContaining(NEW));
    await applyFile(runner(p), n, read("db/rollback/005_down.sql"));
    const left = await tables(p);
    for (const t of NEW) expect(left).not.toContain(t);
    expect(left).toEqual(expect.arrayContaining(["users", "guardian_details", "otp_challenges"]));
    expect(Number((await p.query("select count(*)::int n from users")).rows[0]!["n" as never])).toBe(1);
    await applyFile(runner(p), n, read("db/migrations/005_service_datasets.sql")); // and it can be re-applied
    expect(await tables(p)).toEqual(expect.arrayContaining(NEW));
    await p.close();
  });
});
