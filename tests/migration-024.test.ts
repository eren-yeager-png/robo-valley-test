// Migration 024 (sector_robot_types) and its rollback, on in-process PostgreSQL (PGlite).
// Throwaway in-memory databases only; no real or shared database is involved.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyFile, pickFiles } from "../scripts/migrate.mjs";
import { MIGRATIONS, migrationStatus, statusOf } from "../scripts/migration-status.mjs";

const read = (p: string) => readFileSync(resolve(p), "utf8");
const runner = (pg: PGlite) => ({ setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]), exec: (sql: string) => pg.exec(sql) });
const UP = "db/migrations/024_sector_robot_types.sql";
const DOWN = "db/rollback/024_down.sql";

/** Everything up to 023 applied (016 seeds Agriculture & Dairy), one more sector and one administrator. */
async function build(apply024 = true) {
  const pg = new PGlite();
  await pg.exec(read("tests/helpers/baseSchema.sql"));
  const name = String(((await pg.query("select current_database() d")).rows[0] as any).d);
  for (const f of pickFiles().filter((f) => f.split(/[\\/]/).pop()!.slice(0, 3) < "024")) await applyFile(runner(pg), name, read(f));
  await pg.exec("insert into sectors (slug, name, sort_order) values ('education', 'Education', 20)");
  await pg.exec("insert into users (full_name,email,role,password_hash) values ('Boss','boss@example.com','admin','x')");
  if (apply024) await applyFile(runner(pg), name, read(UP));
  return { pg, name };
}
const sector = async (pg: PGlite, slug: string) => Number(((await pg.query("select id from sectors where slug = $1", [slug])).rows[0] as any).id);
const robot = (pg: PGlite, sectorId: number, slug: string, name: string) => pg.query("insert into sector_robot_types (sector_id, slug, name) values ($1, $2, $3)", [sectorId, slug, name]);
const tableExists = async (pg: PGlite) => ((await pg.query("select to_regclass('sector_robot_types') is not null as t")).rows[0] as any).t as boolean;
const others = async (pg: PGlite) => JSON.stringify((await pg.query("select (select json_agg(s order by s.id) from sectors s) a, (select count(*) from users) b, (select count(*) from contributions) c")).rows);
const status = async (pg: PGlite, id = "024") => statusOf(await migrationStatus((sql: string) => pg.query(sql)), id);

describe("migration 024", () => {
  it("is the only 024 file and adds one table; nothing that existed changes, and running it twice is harmless", async () => {
    expect(pickFiles().map((f) => f.split(/[\\/]/).pop()).filter((f) => f!.startsWith("024"))).toEqual(["024_sector_robot_types.sql"]);
    const { pg, name } = await build(false);
    const before = await others(pg);
    expect(await tableExists(pg)).toBe(false);
    await applyFile(runner(pg), name, read(UP));
    expect(await tableExists(pg)).toBe(true);
    const cols = (await pg.query("select column_name, data_type, is_nullable from information_schema.columns where table_name = 'sector_robot_types' order by ordinal_position")).rows;
    expect(cols).toEqual([
      { column_name: "id", data_type: "integer", is_nullable: "NO" },
      { column_name: "sector_id", data_type: "integer", is_nullable: "NO" },
      { column_name: "slug", data_type: "character varying", is_nullable: "NO" },
      { column_name: "name", data_type: "character varying", is_nullable: "NO" },
      { column_name: "sort_order", data_type: "integer", is_nullable: "NO" },
      { column_name: "is_active", data_type: "boolean", is_nullable: "NO" },
      { column_name: "created_at", data_type: "timestamp with time zone", is_nullable: "NO" },
      { column_name: "updated_at", data_type: "timestamp with time zone", is_nullable: "NO" },
      { column_name: "updated_by", data_type: "bigint", is_nullable: "YES" },
    ]);
    expect(await others(pg)).toBe(before);
    await applyFile(runner(pg), name, read(UP));
    expect(await others(pg)).toBe(before);
    expect(read(UP).replace(/--.*$/gm, "")).not.toMatch(/\bDROP\b|\bRENAME\b|ALTER TABLE (contributions|sectors|users)/i); // the SQL, not the comments
    await pg.close();
  });

  it("names are unique within a sector, whatever the capitals or spacing; the same name may exist in another sector", async () => {
    const { pg } = await build(true);
    const agri = await sector(pg, "agriculture-dairy"), edu = await sector(pg, "education");
    await robot(pg, agri, "drone-sprayers", "Drone sprayers");
    await expect(robot(pg, agri, "drone-sprayers-2", "drone  SPRAYERS")).rejects.toThrow(/sector_robot_types_name_uq/);
    await expect(robot(pg, agri, "drone-sprayers", "Something else")).rejects.toThrow(/sector_robot_types_slug_uq/);
    await robot(pg, edu, "drone-sprayers", "Drone sprayers"); // another sector: fine
    expect((await pg.query("select count(*)::int n from sector_robot_types")).rows[0]).toEqual({ n: 2 });
    await pg.close();
  });

  it("refuses a bad link code, a too-short or padded name, and a sector that does not exist; a used sector cannot be deleted", async () => {
    const { pg } = await build(true);
    const agri = await sector(pg, "agriculture-dairy");
    await expect(robot(pg, agri, "Drone Sprayers", "Drone sprayers")).rejects.toThrow(/sector_robot_types_slug_ck/);
    await expect(robot(pg, agri, "x", "x")).rejects.toThrow(/sector_robot_types_name_ck/);
    await expect(robot(pg, agri, "padded", " Padded ")).rejects.toThrow(/sector_robot_types_name_ck/);
    await expect(robot(pg, 999999, "lost", "Lost robot")).rejects.toThrow(/foreign key/);
    await robot(pg, agri, "milking-robots", "Milking robots");
    await expect(pg.exec(`delete from sectors where id = ${agri}`)).rejects.toThrow(/foreign key/);
    const r = (await pg.query("select sort_order, is_active, updated_by from sector_robot_types")).rows[0];
    expect(r).toEqual({ sort_order: 100, is_active: true, updated_by: null });
    await pg.close();
  });

  it("the administrator who changed a robot can be deleted; the robot stays and only loses the name of who changed it", async () => {
    const { pg } = await build(true);
    const agri = await sector(pg, "agriculture-dairy");
    const boss = Number(((await pg.query("select id from users where email = 'boss@example.com'")).rows[0] as any).id);
    await pg.query("insert into sector_robot_types (sector_id, slug, name, updated_by) values ($1, 'drones', 'Drones', $2)", [agri, boss]);
    await pg.exec(`delete from users where id = ${boss}`);
    expect((await pg.query("select name, updated_by from sector_robot_types")).rows).toEqual([{ name: "Drones", updated_by: null }]);
    await pg.close();
  });

  it("the status check knows it: missing before, applied after; it needs only 012", async () => {
    expect(MIGRATIONS.find((m: any) => m.id === "024")).toMatchObject({ requires: ["012"], checks: [{ kind: "table", table: "sector_robot_types" }, { kind: "index", name: "sector_robot_types_name_uq" }] });
    const { pg } = await build(false);
    expect((await status(pg))?.status).toBe("missing");
    expect((await status(pg, "023"))?.status).toBe("applied");
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
    expect(await tableExists(pg)).toBe(false);
    await pg.close();
  });

  it("rollback refuses while any robot type exists (it would erase the administrators' lists), and drops the empty table", async () => {
    const { pg, name } = await build(true);
    const agri = await sector(pg, "agriculture-dairy");
    await robot(pg, agri, "drones", "Drones");
    await pg.exec("update sector_robot_types set is_active = false"); // switched off still counts: it is kept on purpose
    await expect(applyFile(runner(pg), name, read(DOWN))).rejects.toThrow(/Robot types have been entered/);
    await pg.exec("ROLLBACK").catch(() => undefined);
    expect(await tableExists(pg)).toBe(true);
    await expect(applyFile(runner(pg), name + "_wrong", read(DOWN))).rejects.toThrow(/Wrong database/);
    await pg.exec("ROLLBACK").catch(() => undefined);
    await pg.exec("delete from sector_robot_types"); // a person decides the lists may go
    const before = await others(pg);
    await applyFile(runner(pg), name, read(DOWN));
    expect(await tableExists(pg)).toBe(false);
    expect(await others(pg)).toBe(before);
    expect((await status(pg))?.status).toBe("missing");
    await applyFile(runner(pg), name, read(DOWN)); // running it twice is harmless
    await pg.close();
  });

  it("the rollback file is not in db/migrations, so the runner can never pick it", () => {
    expect(pickFiles().some((f) => f.includes("024_down"))).toBe(false);
  });
});
