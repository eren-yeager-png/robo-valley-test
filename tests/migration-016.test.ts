// Migration 016 (the Agriculture & Dairy sector and unique sector names) and its rollback, on in-process PostgreSQL (PGlite).
// Throwaway in-memory databases only; no real or shared database is involved.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyFile, pickFiles } from "../scripts/migrate.mjs";
import { migrationStatus, statusOf } from "../scripts/migration-status.mjs";
import { migratedClone } from "./helpers/migratedClone";

const read = (p: string) => readFileSync(resolve(p), "utf8");
const runner = (pg: PGlite) => ({
  setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]),
  exec: (sql: string) => pg.exec(sql),
});
const UP = "db/migrations/016_sector_seed.sql";
const DOWN = "db/rollback/016_down.sql";
const n = async (pg: PGlite, sql: string) => Number(((await pg.query(sql)).rows[0] as any).n);

/** A database with every migration up to 015 (so 016 has not run). */
async function before016() {
  const { pg, name } = await migratedClone((id) => id !== "016"); // built once per file, a fresh copy per test (tests/helpers/migratedClone.ts)
  return { pg, name };
}

describe("migration 016", () => {
  it("adds exactly one sector (Agriculture & Dairy) and nothing else: no Education, no Healthcare", async () => {
    const { pg, name } = await before016();
    expect(await n(pg, "select count(*) n from sectors")).toBe(0);
    await applyFile(runner(pg), name, read(UP));
    const rows = (await pg.query("select slug, name, sort_order, is_active, is_demo from sectors")).rows as any[];
    expect(rows).toEqual([{ slug: "agriculture-dairy", name: "Agriculture & Dairy", sort_order: 10, is_active: true, is_demo: false }]);
    await pg.close();
  });

  it("is safe to run twice and never overwrites a name or order that was edited", async () => {
    const { pg, name } = await before016();
    await applyFile(runner(pg), name, read(UP));
    await pg.exec("update sectors set name = 'Agriculture and Dairy (edited)', sort_order = 5 where slug = 'agriculture-dairy'");
    await applyFile(runner(pg), name, read(UP));
    expect(await n(pg, "select count(*) n from sectors")).toBe(1);
    expect((await pg.query("select name, sort_order from sectors")).rows).toEqual([{ name: "Agriculture and Dairy (edited)", sort_order: 5 }]);
    await pg.close();
  });

  it("two sectors cannot share a name that differs only in capital letters or spaces", async () => {
    const { pg, name } = await before016();
    await applyFile(runner(pg), name, read(UP));
    await expect(pg.exec("insert into sectors (slug, name) values ('agri-2', '  AGRICULTURE & dairy ')")).rejects.toThrow(/sectors_name_lower_uq|duplicate/);
    await pg.exec("insert into sectors (slug, name) values ('education', 'Education')"); // a different name is fine
    await pg.close();
  });

  it("existing contributions and their sector are untouched", async () => {
    const { pg, name } = await before016();
    await pg.exec("insert into users (full_name,email,role,password_hash) values ('A','a@example.com','TC','x')");
    await pg.exec("insert into sectors (slug,name) values ('agriculture-dairy','Agriculture & Dairy')"); // already added by hand
    await pg.exec("insert into contributions (user_id,type,title,body) values (1,'problem','A title','A body that is long enough.')");
    await pg.exec("insert into contribution_scopes (contribution_id, sector_id) values (1, 1)");
    await applyFile(runner(pg), name, read(UP));
    expect(await n(pg, "select count(*) n from sectors")).toBe(1);
    expect(await n(pg, "select count(*) n from contribution_scopes")).toBe(1);
    await pg.close();
  });

  it("refuses to run without a confirmed database name, or with the wrong one", async () => {
    const { pg } = await before016();
    await pg.query("select set_config('rv.expected_db', '', false)");
    await expect(pg.exec(read(UP))).rejects.toThrow(/not set/);
    await pg.exec("ROLLBACK");
    await pg.query("select set_config('rv.expected_db', 'some_other_db', false)");
    await expect(pg.exec(read(UP))).rejects.toThrow(/Wrong database/);
    await pg.exec("ROLLBACK");
    expect(await n(pg, "select count(*) n from sectors")).toBe(0);
    await pg.close();
  });

  it("the status report sees it: missing before, applied after", async () => {
    const { pg, name } = await before016();
    const query = async (sql: string) => ({ rows: (await pg.query(sql)).rows as any[] });
    expect(statusOf(await migrationStatus(query), "016")?.status).toBe("missing");
    await applyFile(runner(pg), name, read(UP));
    expect(statusOf(await migrationStatus(query), "016")?.status).toBe("applied");
    await pg.close();
  });
});

describe("rollback 016", () => {
  it("removes the seeded sector and the index when nothing uses the sector, and leaves 015 and earlier alone", async () => {
    const { pg, name } = await before016();
    await applyFile(runner(pg), name, read(UP));
    await applyFile(runner(pg), name, read(DOWN));
    expect(await n(pg, "select count(*) n from sectors")).toBe(0);
    expect(await n(pg, "select count(*) n from pg_indexes where indexname = 'sectors_name_lower_uq'")).toBe(0);
    expect(await n(pg, "select count(*) n from information_schema.columns where table_name = 'users' and column_name = 'is_moderator'")).toBe(1);
    await pg.close();
  });

  it("stops with a plain message, and changes nothing, when a contribution is filed under the sector", async () => {
    const { pg, name } = await before016();
    await applyFile(runner(pg), name, read(UP));
    await pg.exec("insert into users (full_name,email,role,password_hash) values ('A','a@example.com','TC','x')");
    await pg.exec("insert into contributions (user_id,type,title,body) values (1,'problem','A title','A body that is long enough.')");
    await pg.exec("insert into contribution_scopes (contribution_id, sector_id) values (1, 1)");
    await expect(applyFile(runner(pg), name, read(DOWN))).rejects.toThrow(/Contributions are already filed under Agriculture & Dairy/);
    expect(await n(pg, "select count(*) n from sectors")).toBe(1);
    expect(await n(pg, "select count(*) n from pg_indexes where indexname = 'sectors_name_lower_uq'")).toBe(1);
    expect(await n(pg, "select count(*) n from contributions")).toBe(1);
    await pg.close();
  });

  it("keeps a seed row that existed BEFORE 016 ran, even one with exactly the values 016 inserts (a matching slug is no proof)", async () => {
    const { pg, name } = await before016();
    await pg.exec("insert into sectors (slug, name, sort_order, is_active, is_demo) values ('agriculture-dairy', 'Agriculture & Dairy', 10, true, false)");
    await applyFile(runner(pg), name, read(UP)); // ON CONFLICT DO NOTHING: 016 leaves that row alone and only adds its index
    await applyFile(runner(pg), name, read(DOWN));
    expect((await pg.query("select slug, name, sort_order, is_active, is_demo from sectors")).rows)
      .toEqual([{ slug: "agriculture-dairy", name: "Agriculture & Dairy", sort_order: 10, is_active: true, is_demo: false }]); // kept
    expect(await n(pg, "select count(*) n from pg_indexes where indexname = 'sectors_name_lower_uq'")).toBe(0); // 016's own index is removed
    await pg.close();
  });

  it("keeps a pre-existing row with other values, and a seeded row that was edited after 016 (it is the owner's now)", async () => {
    const a = await before016();
    await a.pg.exec("insert into sectors (slug, name, sort_order) values ('agriculture-dairy', 'Agriculture and Dairy', 5)");
    await applyFile(runner(a.pg), a.name, read(UP));
    await applyFile(runner(a.pg), a.name, read(DOWN));
    expect((await a.pg.query("select name, sort_order from sectors")).rows).toEqual([{ name: "Agriculture and Dairy", sort_order: 5 }]);
    await a.pg.close();
    const b = await before016();
    await applyFile(runner(b.pg), b.name, read(UP));
    await b.pg.exec("update sectors set sort_order = 20 where slug = 'agriculture-dairy'"); // an administrator moved it
    await applyFile(runner(b.pg), b.name, read(DOWN));
    expect((await b.pg.query("select slug, sort_order from sectors")).rows).toEqual([{ slug: "agriculture-dairy", sort_order: 20 }]);
    await b.pg.close();
  });

  it("is one transaction: a failure after the row is removed and the index dropped leaves both exactly as they were", async () => {
    const { pg, name } = await before016();
    await applyFile(runner(pg), name, read(UP));
    const failing = read(DOWN).replace(/COMMIT;\s*$/, "SELECT 1 / 0; -- a failure after every change in the file\nCOMMIT;\n");
    expect(failing).toContain("SELECT 1 / 0;");
    await expect(applyFile(runner(pg), name, failing)).rejects.toThrow(/division by zero/);
    expect(await n(pg, "select count(*) n from sectors where slug = 'agriculture-dairy'")).toBe(1);
    expect(await n(pg, "select count(*) n from pg_indexes where indexname = 'sectors_name_lower_uq'")).toBe(1);
    await applyFile(runner(pg), name, read(DOWN)); // and the real file still removes 016's row afterwards
    expect(await n(pg, "select count(*) n from sectors")).toBe(0);
    await pg.close();
  });

  it("up, down, up leaves exactly the same result", async () => {
    const { pg, name } = await before016();
    await applyFile(runner(pg), name, read(UP));
    const first = JSON.stringify((await pg.query("select slug, name, sort_order, is_active, is_demo from sectors")).rows);
    await applyFile(runner(pg), name, read(DOWN));
    await applyFile(runner(pg), name, read(UP));
    expect(JSON.stringify((await pg.query("select slug, name, sort_order, is_active, is_demo from sectors")).rows)).toBe(first);
    await pg.close();
  });

  it("needs the confirmed database name too, and says in plain words what it does", async () => {
    const { pg } = await before016();
    await pg.query("select set_config('rv.expected_db', '', false)");
    await expect(pg.exec(read(DOWN))).rejects.toThrow(/not set/);
    await pg.exec("ROLLBACK");
    const text = read(DOWN);
    expect(text).toContain("ONLY if no contribution uses it");
    expect(text).toContain("contributions are never deleted or detached by this undo");
    await pg.close();
  });

  it("is a rollback file, not a migration: the runner never lists it", () => {
    expect(pickFiles().some((f: string) => /016_down/.test(f))).toBe(false);
    expect(pickFiles().some((f: string) => /016_sector_seed/.test(f))).toBe(true);
  });
});
