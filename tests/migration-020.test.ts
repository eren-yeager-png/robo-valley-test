// Migration 020 (password reset tokens + users.password_changed_at) and its rollback, on in-process PostgreSQL (PGlite).
// Throwaway in-memory databases only; no real or shared database is involved.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyFile, pickFiles } from "../scripts/migrate.mjs";

const read = (p: string) => readFileSync(resolve(p), "utf8");
const runner = (pg: PGlite) => ({ setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]), exec: (sql: string) => pg.exec(sql) });
const n = async (pg: PGlite, sql: string, p: unknown[] = []) => Number(((await pg.query(sql, p as any[])).rows[0] as any).n);
const UP = "db/migrations/020_password_reset.sql";
const DOWN = "db/rollback/020_down.sql";
const HASH = (c: string) => c.repeat(64);

/** Everything up to 018 applied (as production would be before 020), with two users. */
async function build(apply020 = true) {
  const pg = new PGlite();
  await pg.exec(read("tests/helpers/baseSchema.sql"));
  const name = String(((await pg.query("select current_database() d")).rows[0] as any).d);
  for (const f of pickFiles().filter((f) => f.split(/[\\/]/).pop()!.slice(0, 3) < "020")) await applyFile(runner(pg), name, read(f));
  await pg.exec("insert into users (full_name,email,role,password_hash) values ('Asha','a@example.com','TC','x'),('Ravi','r@example.com','TC','x')");
  if (apply020) await applyFile(runner(pg), name, read(UP));
  return { pg, name };
}
const tables = async (pg: PGlite) => (await pg.query("select table_name from information_schema.tables where table_schema='public' order by 1")).rows.map((r: any) => r.table_name);
const cols = async (pg: PGlite) => (await pg.query("select column_name from information_schema.columns where table_name='users' order by 1")).rows.map((r: any) => r.column_name);

describe("migration 020: schema", () => {
  it("is the only 020 file, runs after 018 and 019 would, and is safe to run twice", async () => {
    expect(pickFiles().map((f) => f.split(/[\\/]/).pop()).filter((f) => f!.startsWith("020"))).toEqual(["020_password_reset.sql"]);
    const { pg, name } = await build();
    expect(await tables(pg)).toContain("password_reset_tokens");
    expect(await cols(pg)).toContain("password_changed_at");
    await applyFile(runner(pg), name, read(UP)); // again: nothing breaks
    expect(await n(pg, "select count(*) n from information_schema.tables where table_name='password_reset_tokens'")).toBe(1);
    await pg.close();
  });

  it("changes no existing row: every user keeps their data and gets password_changed_at NULL (nobody is signed out by it)", async () => {
    const { pg, name } = await build(false);
    const before = JSON.stringify((await pg.query("select id, full_name, email, role, password_hash from users order by id")).rows);
    await applyFile(runner(pg), name, read(UP));
    expect(JSON.stringify((await pg.query("select id, full_name, email, role, password_hash from users order by id")).rows)).toBe(before);
    expect(await n(pg, "select count(*) n from users where password_changed_at is not null")).toBe(0);
    await pg.close();
  });

  it("refuses without a confirmed database name, and with the wrong one, and changes nothing", async () => {
    const { pg, name } = await build(false);
    const before = await tables(pg), colsBefore = await cols(pg);
    await pg.query("select set_config('rv.expected_db', '', false)"); // a session that never confirmed a name (build() confirmed one)
    await expect(pg.exec(read(UP))).rejects.toThrow(/rv\.expected_db is not set/);
    await pg.exec("ROLLBACK");
    await expect(applyFile(runner(pg), name + "_wrong", read(UP))).rejects.toThrow(/Wrong database/);
    expect(await tables(pg)).toEqual(before);
    expect(await cols(pg)).toEqual(colsBefore);
    await pg.close();
  });
});

describe("migration 020: the rules the database itself enforces", () => {
  const add = (pg: PGlite, hash: string, minutes: number, user = 1) =>
    pg.query("insert into password_reset_tokens (user_id, token_hash, created_at, expires_at) values ($1,$2, now(), now() + ($3 || ' minutes')::interval)", [user, hash, String(minutes)]);

  it("a token lives at most 60 minutes, and cannot expire before it was made", async () => {
    const { pg } = await build();
    await add(pg, HASH("a"), 45);
    await add(pg, HASH("b"), 60);
    await expect(add(pg, HASH("c"), 61)).rejects.toThrow(/password_reset_tokens_expiry_ck/);
    await expect(add(pg, HASH("d"), 0)).rejects.toThrow(/password_reset_tokens_expiry_ck/);
    await expect(add(pg, HASH("e"), -5)).rejects.toThrow(/password_reset_tokens_expiry_ck/);
    await pg.close();
  });

  it("only a 64-character lowercase hex hash can be stored (a raw token cannot be)", async () => {
    const { pg } = await build();
    for (const bad of ["short", "G".repeat(64), "A".repeat(64), "a".repeat(63), "a".repeat(65), "x-".repeat(32)]) {
      await expect(add(pg, bad, 30), bad).rejects.toThrow();
    }
    await pg.close();
  });

  it("a hash is unique, a token belongs to a real user, and used_at cannot be before created_at", async () => {
    const { pg } = await build();
    await add(pg, HASH("a"), 30);
    await expect(add(pg, HASH("a"), 30, 2)).rejects.toThrow(/password_reset_tokens_hash_uq/);
    await expect(add(pg, HASH("b"), 30, 999)).rejects.toThrow(/foreign key|violates/i);
    await expect(pg.query("update password_reset_tokens set used_at = created_at - interval '1 minute' where token_hash = $1", [HASH("a")])).rejects.toThrow(/password_reset_tokens_used_ck/);
    await pg.query("update password_reset_tokens set used_at = now() where token_hash = $1", [HASH("a")]);
    await pg.close();
  });

  it("deleting a user deletes their tokens and nobody else's", async () => {
    const { pg } = await build();
    await add(pg, HASH("a"), 30, 1); await add(pg, HASH("b"), 30, 2);
    await pg.query("delete from users where id = 1");
    expect(await n(pg, "select count(*) n from password_reset_tokens")).toBe(1);
    expect(await n(pg, "select count(*) n from password_reset_tokens where user_id = 2")).toBe(1);
    await pg.close();
  });
});

describe("rollback 020", () => {
  it("removes the table and the column when no password was ever changed through a reset", async () => {
    const { pg, name } = await build();
    await pg.query("insert into password_reset_tokens (user_id, token_hash, created_at, expires_at) values (1, $1, now(), now() + interval '30 minutes')", [HASH("a")]);
    await applyFile(runner(pg), name, read(DOWN));
    expect(await tables(pg)).not.toContain("password_reset_tokens");
    expect(await cols(pg)).not.toContain("password_changed_at");
    expect(await n(pg, "select count(*) n from users")).toBe(2); // the users themselves are untouched
    await applyFile(runner(pg), name, read(DOWN)); // and a second undo is harmless
    await pg.close();
  });

  it("REFUSES, changing nothing, once a password has been changed through a reset (it would revive signed-out sessions)", async () => {
    const { pg, name } = await build();
    await pg.query("update users set password_changed_at = now() where id = 1");
    const before = await tables(pg), colsBefore = await cols(pg);
    await expect(applyFile(runner(pg), name, read(DOWN))).rejects.toThrow(/sessions that reset signed out valid again/);
    expect(await tables(pg)).toEqual(before);
    expect(await cols(pg)).toEqual(colsBefore);
    expect(await n(pg, "select count(*) n from users where password_changed_at is not null")).toBe(1);
    await pg.close();
  });

  it("is guarded like the migration: no confirmed database, or the wrong one, changes nothing", async () => {
    const { pg, name } = await build();
    await pg.query("select set_config('rv.expected_db', '', false)"); // a session that never confirmed a name
    await expect(pg.exec(read(DOWN))).rejects.toThrow(/rv\.expected_db is not set/);
    await pg.exec("ROLLBACK");
    await expect(applyFile(runner(pg), name + "_wrong", read(DOWN))).rejects.toThrow(/Wrong database/);
    expect(await tables(pg)).toContain("password_reset_tokens");
    await pg.close();
  });

  it("is not in the migrations folder, so the runner can never apply it by accident", () => {
    expect(pickFiles().some((f) => /020_down/.test(f))).toBe(false);
  });
});
