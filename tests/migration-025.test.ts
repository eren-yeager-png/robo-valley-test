// Migration 025 (the robot a contribution is about, one per sector) and its rollback, on in-process PostgreSQL (PGlite).
// Throwaway in-memory databases only; no real or shared database is involved.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyFile, pickFiles } from "../scripts/migrate.mjs";
import { MIGRATIONS, migrationStatus, statusOf } from "../scripts/migration-status.mjs";
import { migratedClone } from "./helpers/migratedClone";

const read = (p: string) => readFileSync(resolve(p), "utf8");
const runner = (pg: PGlite) => ({ setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]), exec: (sql: string) => pg.exec(sql) });
const UP = "db/migrations/025_contribution_robots.sql";
const DOWN = "db/rollback/025_down.sql";

/** Everything up to 024, two sectors with robot types, and a member's contribution in both sectors (saved before 025). */
async function build(apply025 = true) {
  const { pg, name } = await migratedClone((id) => id < "025"); // built once per file, a fresh copy per test (tests/helpers/migratedClone.ts)
  await pg.exec("insert into sectors (slug, name, sort_order) values ('education', 'Education', 20)");
  await pg.exec("insert into users (full_name,email,role,password_hash) values ('Asha','a@example.com','TC','x')");
  await pg.exec("insert into sector_robot_types (sector_id, slug, name) select id, 'milking-robots', 'Milking robots' from sectors where slug = 'agriculture-dairy'");
  await pg.exec("insert into sector_robot_types (sector_id, slug, name) select id, 'tutor-robots', 'Tutor robots' from sectors where slug = 'education'");
  await pg.exec("insert into contributions (user_id, type, title, body) select id, 'problem', 'Milking by hand', 'A long enough body.' from users");
  await pg.exec("insert into contribution_scopes (contribution_id, sector_id) select c.id, s.id from contributions c, sectors s where s.slug in ('agriculture-dairy','education')");
  if (apply025) await applyFile(runner(pg), name, read(UP));
  return { pg, name };
}
const id = async (pg: PGlite, sql: string) => Number(((await pg.query(sql)).rows[0] as any).id);
const robot = (pg: PGlite, slug: string) => id(pg, `select id from sector_robot_types where slug = '${slug}'`);
const sector = (pg: PGlite, slug: string) => id(pg, `select id from sectors where slug = '${slug}'`);
const cols = async (pg: PGlite) => (await pg.query("select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where (table_name = 'contribution_scopes' and column_name = 'robot_type_id') or (table_name = 'contributions' and column_name = 'from_robot_page') order by table_name")).rows;
const rows = async (pg: PGlite) => JSON.stringify((await pg.query("select (select json_agg(c order by c.id) from (select id, user_id, title, status from contributions) c) a, (select json_agg(s order by s.contribution_id, s.sector_id) from (select contribution_id, sector_id from contribution_scopes) s) b, (select count(*) from sector_robot_types) r")).rows);
const status = async (pg: PGlite, mid = "025") => statusOf(await migrationStatus((sql: string) => pg.query(sql)), mid);

describe("migration 025", () => {
  it("is the only 025 file; adds a nullable robot per sector row and from_robot_page (default false); nothing else changes; re-run is harmless", async () => {
    expect(pickFiles().map((f) => f.split(/[\\/]/).pop()).filter((f) => f!.startsWith("025"))).toEqual(["025_contribution_robots.sql"]);
    const { pg, name } = await build(false);
    const before = await rows(pg);
    expect(await cols(pg)).toEqual([]);
    await applyFile(runner(pg), name, read(UP));
    expect(await cols(pg)).toEqual([
      { table_name: "contribution_scopes", column_name: "robot_type_id", data_type: "integer", is_nullable: "YES", column_default: null },
      { table_name: "contributions", column_name: "from_robot_page", data_type: "boolean", is_nullable: "NO", column_default: "false" },
    ]);
    expect(await rows(pg)).toBe(before);
    expect((await pg.query("select count(*)::int n from contribution_scopes where robot_type_id is not null")).rows[0]).toEqual({ n: 0 }); // existing: Not sure
    await applyFile(runner(pg), name, read(UP));
    expect(await rows(pg)).toBe(before);
    expect(read(UP).replace(/--.*$/gm, "")).not.toMatch(/\bDROP\b|\bRENAME\b/i);
    await pg.close();
  });

  it("a robot must belong to the same sector; NULL is Not sure; a chosen robot type cannot be deleted, but can be switched off", async () => {
    const { pg } = await build(true);
    const agri = await sector(pg, "agriculture-dairy"), milk = await robot(pg, "milking-robots"), tutor = await robot(pg, "tutor-robots");
    await pg.query("update contribution_scopes set robot_type_id = $1 where sector_id = $2", [milk, agri]);
    await expect(pg.query("update contribution_scopes set robot_type_id = $1 where sector_id = $2", [tutor, agri])).rejects.toThrow(/contribution_scopes_robot_fk/);
    await pg.query("update contribution_scopes set robot_type_id = null where sector_id = (select id from sectors where slug = 'education')");
    await expect(pg.exec(`delete from sector_robot_types where id = ${milk}`)).rejects.toThrow(/contribution_scopes_robot_fk/);
    await pg.exec(`update sector_robot_types set is_active = false where id = ${milk}`); // switching off is fine; the choice stays
    expect((await pg.query("select robot_type_id from contribution_scopes where sector_id = $1", [agri])).rows).toEqual([{ robot_type_id: milk }]);
    await pg.close();
  });

  it("removing a sector from a contribution takes its robot with it (the row goes)", async () => {
    const { pg } = await build(true);
    const agri = await sector(pg, "agriculture-dairy");
    await pg.query("update contribution_scopes set robot_type_id = $1 where sector_id = $2", [await robot(pg, "milking-robots"), agri]);
    await pg.query("delete from contribution_scopes where sector_id = $1", [agri]);
    expect((await pg.query("select count(*)::int n from contribution_scopes where robot_type_id is not null")).rows[0]).toEqual({ n: 0 });
    await pg.close();
  });

  it("the status check knows it: missing before, applied after; it needs 012 and 024", async () => {
    expect(MIGRATIONS.find((m: any) => m.id === "025")).toMatchObject({ requires: ["012", "024"] });
    const { pg } = await build(false);
    expect((await status(pg))?.status).toBe("missing");
    expect((await status(pg, "024"))?.status).toBe("applied");
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
    expect(await cols(pg)).toEqual([]);
    await pg.close();
  });

  it("rollback refuses while any robot is chosen, then removes only 025's columns and rules (024's robot types stay)", async () => {
    const { pg, name } = await build(true);
    const agri = await sector(pg, "agriculture-dairy");
    await pg.query("update contribution_scopes set robot_type_id = $1 where sector_id = $2", [await robot(pg, "milking-robots"), agri]);
    await expect(applyFile(runner(pg), name, read(DOWN))).rejects.toThrow(/Some contributions have a robot chosen/);
    await pg.exec("ROLLBACK").catch(() => undefined);
    expect((await cols(pg)).length).toBe(2);
    await pg.exec("update contribution_scopes set robot_type_id = null"); // someone decides the answers may go
    const before = await rows(pg);
    await applyFile(runner(pg), name, read(DOWN));
    expect(await cols(pg)).toEqual([]);
    expect(await rows(pg)).toBe(before);
    expect((await pg.query("select count(*)::int n from pg_constraint where conname in ('sector_robot_types_id_sector_uq','contribution_scopes_robot_fk')")).rows[0]).toEqual({ n: 0 });
    expect((await status(pg))?.status).toBe("missing");
    expect((await status(pg, "024"))?.status).toBe("applied");
    await applyFile(runner(pg), name, read(DOWN)); // twice is harmless
    await pg.close();
  });

  it("with 025 applied, 024's rollback still refuses (robot types exist, and 025 points at them)", async () => {
    const { pg, name } = await build(true);
    await expect(applyFile(runner(pg), name, read("db/rollback/024_down.sql"))).rejects.toThrow(/Robot types have been entered/);
    await pg.close();
  });

  it("rollback REFUSES while any contribution was started from a robot card (no robot chosen needed), and changes nothing", async () => {
    const { pg, name } = await build(true);
    await pg.exec("update contributions set from_robot_page = true");
    const before = await rows(pg);
    await expect(applyFile(runner(pg), name, read(DOWN))).rejects.toThrow(/1 contribution\(s\) were started from a robot card/);
    await pg.exec("ROLLBACK").catch(() => undefined);
    expect((await cols(pg)).length).toBe(2);
    expect(await rows(pg)).toBe(before);
    expect((await pg.query("select count(*)::int n from contributions where from_robot_page")).rows[0]).toEqual({ n: 1 });
    expect((await status(pg))?.status).toBe("applied");
    await pg.exec("update contributions set from_robot_page = false"); // someone decided that record may go
    await applyFile(runner(pg), name, read(DOWN));
    expect(await cols(pg)).toEqual([]);
    await pg.close();
  });

  it("a same-named constraint on another table, in another schema, is not taken for 025's: both are still made on the right tables", async () => {
    const pg = new PGlite();
    await pg.exec(read("tests/helpers/baseSchema.sql"));
    await pg.exec("CREATE SCHEMA other; CREATE TABLE other.t (id int, CONSTRAINT contribution_scopes_robot_fk CHECK (id > 0), CONSTRAINT sector_robot_types_id_sector_uq UNIQUE (id))");
    const name = String(((await pg.query("select current_database() d")).rows[0] as any).d);
    for (const f of pickFiles()) await applyFile(runner(pg), name, read(f));
    expect((await pg.query(`select conrelid::regclass::text t, conname from pg_constraint where conname in ('contribution_scopes_robot_fk','sector_robot_types_id_sector_uq') order by 2, 1`)).rows)
      .toEqual([{ t: "contribution_scopes", conname: "contribution_scopes_robot_fk" }, { t: "other.t", conname: "contribution_scopes_robot_fk" },
        { t: "other.t", conname: "sector_robot_types_id_sector_uq" }, { t: "sector_robot_types", conname: "sector_robot_types_id_sector_uq" }]);
    expect((await status(pg))?.status).toBe("applied");
    await pg.close();
  });

  it("a constraint of the same name on the right table but with another definition stops 025, and nothing of 025 is applied", async () => {
    const { pg, name } = await build(false);
    await pg.exec("alter table sector_robot_types add constraint sector_robot_types_id_sector_uq check (sort_order >= 0)");
    await expect(applyFile(runner(pg), name, read(UP))).rejects.toThrow(/is not UNIQUE \(id, sector_id\)/);
    await pg.exec("ROLLBACK").catch(() => undefined);
    expect(await cols(pg)).toEqual([]); // the whole file rolled back: no column was added
    await pg.exec("alter table sector_robot_types drop constraint sector_robot_types_id_sector_uq");
    await pg.exec("alter table contribution_scopes add column robot_type_id integer, add constraint contribution_scopes_robot_fk check (robot_type_id > 0)");
    await expect(applyFile(runner(pg), name, read(UP))).rejects.toThrow(/is not the link \(robot_type_id, sector_id\)/);
    await pg.exec("ROLLBACK").catch(() => undefined);
    expect((await pg.query("select count(*)::int n from pg_constraint where conname = 'sector_robot_types_id_sector_uq'")).rows[0]).toEqual({ n: 0 });
    await pg.close();
  });

  it("partly applied (the link or the index missing): the status says partial, and running 025 again completes it", async () => {
    const { pg, name } = await build(true);
    await pg.exec("alter table contribution_scopes drop constraint contribution_scopes_robot_fk");
    expect((await status(pg))?.status).toBe("partial");
    expect((await status(pg))?.absent).toEqual(["constraint contribution_scopes_robot_fk"]);
    await applyFile(runner(pg), name, read(UP));
    expect((await status(pg))?.status).toBe("applied");
    await pg.exec("drop index contribution_scopes_robot_idx");
    expect((await status(pg))?.status).toBe("partial");
    await applyFile(runner(pg), name, read(UP));
    expect((await status(pg))?.status).toBe("applied");
    await pg.close();
  });

  it("rollback looks only at the tables it changes: a chosen robot in another schema neither blocks nor breaks it", async () => {
    const { pg, name } = await build(true);
    await pg.exec("CREATE SCHEMA other; CREATE TABLE other.contribution_scopes (robot_type_id int); INSERT INTO other.contribution_scopes VALUES (7)");
    await applyFile(runner(pg), name, read(DOWN)); // no robot chosen in THIS table: it goes ahead
    expect((await pg.query("select count(*)::int n from information_schema.columns where table_schema = 'public' and column_name in ('robot_type_id', 'from_robot_page')")).rows[0]).toEqual({ n: 0 });
    await applyFile(runner(pg), name, read(DOWN)); // again, with the column only in other.contribution_scopes: harmless
    expect((await pg.query("select count(*)::int n from other.contribution_scopes where robot_type_id is not null")).rows[0]).toEqual({ n: 1 });
    await pg.close();
  });

  it("rollback on a partly applied 025 removes what is there; rollback on an empty one is harmless", async () => {
    const { pg, name } = await build(true);
    await pg.exec("alter table contribution_scopes drop constraint contribution_scopes_robot_fk");
    await pg.exec("drop index contribution_scopes_robot_idx");
    await applyFile(runner(pg), name, read(DOWN));
    expect(await cols(pg)).toEqual([]);
    expect((await pg.query("select count(*)::int n from pg_constraint where conname = 'sector_robot_types_id_sector_uq'")).rows[0]).toEqual({ n: 0 });
    await applyFile(runner(pg), name, read(DOWN));
    await pg.close();
  });

  it("rollback removes only what 025 made: a same-named constraint or index with another definition is refused, never removed", async () => {
    const { pg, name } = await build(true);
    await pg.exec("alter table contribution_scopes drop constraint contribution_scopes_robot_fk");
    await pg.exec("alter table sector_robot_types drop constraint sector_robot_types_id_sector_uq");
    await pg.exec("alter table sector_robot_types add constraint sector_robot_types_id_sector_uq check (sort_order >= 0)"); // not 025's
    await expect(applyFile(runner(pg), name, read(DOWN))).rejects.toThrow(/sector_robot_types_id_sector_uq that is not UNIQUE \(id, sector_id\), so 025 did not make it/);
    await pg.exec("ROLLBACK").catch(() => undefined);
    expect((await pg.query("select contype from pg_constraint where conname = 'sector_robot_types_id_sector_uq'")).rows).toEqual([{ contype: "c" }]);
    expect((await cols(pg)).length).toBe(2); // nothing was removed
    await pg.exec("alter table sector_robot_types drop constraint sector_robot_types_id_sector_uq");
    await pg.exec("drop index contribution_scopes_robot_idx");
    await pg.exec("create index contribution_scopes_robot_idx on sector_robot_types (sort_order)"); // same name, another table
    await expect(applyFile(runner(pg), name, read(DOWN))).rejects.toThrow(/is not 025's index on contribution_scopes \(robot_type_id\)/);
    await pg.exec("ROLLBACK").catch(() => undefined);
    expect((await pg.query("select count(*)::int n from pg_indexes where indexname = 'contribution_scopes_robot_idx' and tablename = 'sector_robot_types'")).rows[0]).toEqual({ n: 1 });
    expect((await cols(pg)).length).toBe(2);
    await pg.close();
  });

  it("the rollback file is not in db/migrations, so the runner can never pick it", () => {
    expect(pickFiles().some((f) => f.includes("025_down"))).toBe(false);
  });
});
