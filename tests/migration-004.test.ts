// Migration 004 (admin support) on an in-process PostgreSQL: additive, idempotent, touches nothing else.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyFile, pickFiles } from "../scripts/migrate.mjs";

const read = (p: string) => readFileSync(resolve(p), "utf8");
const runner = (pg: PGlite) => ({
  setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]),
  exec: (sql: string) => pg.exec(sql),
});
const cols = async (pg: PGlite) =>
  (await pg.query("select column_name c, data_type t, is_nullable n, column_default d from information_schema.columns where table_name='users' order by ordinal_position")).rows as any[];

async function upTo003() {
  const pg = new PGlite();
  await pg.exec(read("tests/helpers/baseSchema.sql"));
  const db = String((await pg.query("select current_database() d")).rows[0]!["d" as never]);
  for (const f of pickFiles({ only: "00" }).filter((f) => !/004/.test(f))) await applyFile(runner(pg), db, readFileSync(f, "utf8"));
  return { pg, db };
}

describe("004_admin_support.sql", () => {
  it("adds only users.must_change_password (boolean, NOT NULL, default false) and leaves role and everything else alone", async () => {
    const { pg, db } = await upTo003();
    const before = await cols(pg);
    await applyFile(runner(pg), db, read("db/migrations/004_admin_support.sql"));
    const after = await cols(pg);
    expect(after.filter((c) => !before.some((b) => b.c === c.c))).toEqual([
      { c: "must_change_password", t: "boolean", n: "NO", d: "false" },
    ]);
    expect(after.filter((c) => before.some((b) => b.c === c.c))).toEqual(before); // existing columns unchanged (role included)
    expect(after.find((c) => c.c === "role")).toMatchObject({ n: "NO" });
    await pg.close();
  });

  it("is safe to run twice and does not change existing rows", async () => {
    const { pg, db } = await upTo003();
    await pg.exec("insert into users (full_name,email,role,password_hash) values ('A','a@example.com','ST','x')");
    await applyFile(runner(pg), db, read("db/migrations/004_admin_support.sql"));
    await applyFile(runner(pg), db, read("db/migrations/004_admin_support.sql"));
    expect((await pg.query("select role, must_change_password m from users")).rows).toEqual([{ role: "ST", m: false }]);
    await pg.close();
  });

  it("refuses to run without the database-name confirmation", async () => {
    const { pg } = await upTo003();
    await pg.query("select set_config('rv.expected_db', '', false)"); // the earlier migrations' confirmation lives in the session
    await expect(pg.exec(read("db/migrations/004_admin_support.sql"))).rejects.toThrow(/rv\.expected_db is not set/);
    await pg.exec("ROLLBACK");
    await pg.close();
  });
});
