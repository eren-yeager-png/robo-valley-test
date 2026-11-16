// Migration 021 (contributions.share_contact_with_moderators) and its rollback, on in-process PostgreSQL (PGlite).
// Throwaway in-memory databases only; no real or shared database is involved.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyFile, pickFiles } from "../scripts/migrate.mjs";
import { MIGRATIONS, migrationStatus, statusOf } from "../scripts/migration-status.mjs";

const read = (p: string) => readFileSync(resolve(p), "utf8");
const runner = (pg: PGlite) => ({ setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]), exec: (sql: string) => pg.exec(sql) });
const UP = "db/migrations/021_contact_share.sql";
const DOWN = "db/rollback/021_down.sql";

/** Everything up to 020 applied, with one member and two contributions. */
async function build(apply021 = true) {
  const pg = new PGlite();
  await pg.exec(read("tests/helpers/baseSchema.sql"));
  const name = String(((await pg.query("select current_database() d")).rows[0] as any).d);
  for (const f of pickFiles().filter((f) => f.split(/[\\/]/).pop()!.slice(0, 3) < "021")) await applyFile(runner(pg), name, read(f));
  await pg.exec("insert into users (full_name,email,role,password_hash) values ('Asha','a@example.com','TC','x')");
  await pg.exec("insert into contributions (user_id, type, title, body) select id, 'resource', 'First title here', 'A long enough body.' from users");
  await pg.exec("insert into contributions (user_id, type, title, body) select id, 'resource', 'Second title here', 'A long enough body.' from users");
  if (apply021) await applyFile(runner(pg), name, read(UP));
  return { pg, name };
}
const col = async (pg: PGlite) => (await pg.query("select data_type, is_nullable, column_default from information_schema.columns where table_name='contributions' and column_name='share_contact_with_moderators'")).rows[0] as any;
const status = async (pg: PGlite) => statusOf(await migrationStatus((sql: string) => pg.query(sql)), "021");

describe("migration 021", () => {
  it("is the only 021 file and adds one boolean column, NOT NULL, default false; every existing contribution is 'not shared'", async () => {
    expect(pickFiles().map((f) => f.split(/[\\/]/).pop()).filter((f) => f!.startsWith("021"))).toEqual(["021_contact_share.sql"]);
    const { pg, name } = await build(false);
    const before = JSON.stringify((await pg.query("select id, user_id, title, status from contributions order by id")).rows);
    expect(await col(pg)).toBeUndefined();
    await applyFile(runner(pg), name, read(UP));
    expect(await col(pg)).toEqual({ data_type: "boolean", is_nullable: "NO", column_default: "false" });
    expect(JSON.stringify((await pg.query("select id, user_id, title, status from contributions order by id")).rows)).toBe(before);
    expect((await pg.query("select count(*)::int n from contributions where share_contact_with_moderators")).rows[0]).toEqual({ n: 0 });
    await applyFile(runner(pg), name, read(UP)); // again: nothing breaks
    await pg.close();
  });
  it("the status check knows it", async () => {
    expect(MIGRATIONS.find((m: any) => m.id === "021")).toMatchObject({ requires: ["012"] });
    const { pg } = await build(false);
    expect((await status(pg))?.status).toBe("missing");
    const { pg: pg2 } = await build(true);
    expect((await status(pg2))?.status).toBe("applied");
    await pg.close(); await pg2.close();
  });
  it("refuses without a confirmed database name, and with the wrong one, and changes nothing", async () => {
    const { pg, name } = await build(false);
    await pg.query("select set_config('rv.expected_db', '', false)");
    await expect(pg.exec(read(UP))).rejects.toThrow(/rv\.expected_db is not set/);
    await pg.exec("ROLLBACK");
    await expect(applyFile(runner(pg), name + "_wrong", read(UP))).rejects.toThrow(/Wrong database/);
    expect(await col(pg)).toBeUndefined();
    await pg.close();
  });
  it("rollback refuses while any box is ticked (it would erase the choice), and otherwise removes only the column", async () => {
    const { pg, name } = await build(true);
    await pg.exec("update contributions set share_contact_with_moderators = true where title = 'First title here'");
    await expect(applyFile(runner(pg), name, read(DOWN))).rejects.toThrow(/Dropping the column would erase their choice/);
    await pg.exec("ROLLBACK").catch(() => undefined);
    expect(await col(pg)).toBeDefined();
    await pg.exec("update contributions set share_contact_with_moderators = false");
    await applyFile(runner(pg), name, read(DOWN));
    expect(await col(pg)).toBeUndefined();
    expect((await pg.query("select count(*)::int n from contributions")).rows[0]).toEqual({ n: 2 }); // rows untouched
    await applyFile(runner(pg), name, read(DOWN)); // running it twice is harmless
    await pg.close();
  });
  it("the rollback file is not in db/migrations, so the runner can never pick it", () => {
    expect(pickFiles().some((f) => f.includes("021_down"))).toBe(false);
  });
});
