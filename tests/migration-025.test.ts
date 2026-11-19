// Migration 025 (the robot a contribution is about, one per sector) and its rollback, on in-process PostgreSQL (PGlite).
// Throwaway in-memory databases only; no real or shared database is involved.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyFile, pickFiles } from "../scripts/migrate.mjs";
import { MIGRATIONS, migrationStatus, statusOf } from "../scripts/migration-status.mjs";

const read = (p: string) => readFileSync(resolve(p), "utf8");
const runner = (pg: PGlite) => ({ setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]), exec: (sql: string) => pg.exec(sql) });
const UP = "db/migrations/025_contribution_robots.sql";
const DOWN = "db/rollback/025_down.sql";

/** Everything up to 024, two sectors with robot types, and a member's contribution in both sectors (saved before 025). */
async function build(apply025 = true) {
  const pg = new PGlite();
  await pg.exec(read("tests/helpers/baseSchema.sql"));
  const name = String(((await pg.query("select current_database() d")).rows[0] as any).d);
  for (const f of pickFiles().filter((f) => f.split(/[\\/]/).pop()!.slice(0, 3) < "025")) await applyFile(runner(pg), name, read(f));
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

  it("the rollback file is not in db/migrations, so the runner can never pick it", () => {
    expect(pickFiles().some((f) => f.includes("025_down"))).toBe(false);
  });
});
