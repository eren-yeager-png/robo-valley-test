// Migration 022 (contributions.from_sector_page) and its rollback, on in-process PostgreSQL (PGlite).
// Throwaway in-memory databases only; no real or shared database is involved.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyFile, pickFiles } from "../scripts/migrate.mjs";
import { MIGRATIONS, migrationStatus, statusOf } from "../scripts/migration-status.mjs";

const read = (p: string) => readFileSync(resolve(p), "utf8");
const runner = (pg: PGlite) => ({ setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]), exec: (sql: string) => pg.exec(sql) });
const UP = "db/migrations/022_contribution_origin.sql";
const DOWN = "db/rollback/022_down.sql";

/** Everything up to 021 applied, with one member and two contributions saved before 022. */
async function build(apply022 = true) {
  const pg = new PGlite();
  await pg.exec(read("tests/helpers/baseSchema.sql"));
  const name = String(((await pg.query("select current_database() d")).rows[0] as any).d);
  for (const f of pickFiles().filter((f) => f.split(/[\\/]/).pop()!.slice(0, 3) < "022")) await applyFile(runner(pg), name, read(f));
  await pg.exec("insert into users (full_name,email,role,password_hash) values ('Asha','a@example.com','TC','x')");
  await pg.exec("insert into contributions (user_id, type, title, body) select id, 'resource', 'First title here', 'A long enough body.' from users");
  await pg.exec("insert into contributions (user_id, type, title, body, share_contact_with_moderators) select id, 'resource', 'Second title here', 'A long enough body.', true from users");
  if (apply022) await applyFile(runner(pg), name, read(UP));
  return { pg, name };
}
const col = async (pg: PGlite) => (await pg.query("select data_type, is_nullable, column_default from information_schema.columns where table_name='contributions' and column_name='from_sector_page'")).rows[0] as any;
const rows = async (pg: PGlite) => JSON.stringify((await pg.query("select id, user_id, title, status, share_contact_with_moderators from contributions order by id")).rows);
const status = async (pg: PGlite, id = "022") => statusOf(await migrationStatus((sql: string) => pg.query(sql)), id);

describe("migration 022", () => {
  it("is the only 022 file and adds one boolean column, NOT NULL, default false; existing contributions get false (origin never recorded: Edit shows the list)", async () => {
    expect(pickFiles().map((f) => f.split(/[\\/]/).pop()).filter((f) => f!.startsWith("022"))).toEqual(["022_contribution_origin.sql"]);
    const { pg, name } = await build(false);
    const before = await rows(pg);
    expect(await col(pg)).toBeUndefined();
    await applyFile(runner(pg), name, read(UP));
    expect(await col(pg)).toEqual({ data_type: "boolean", is_nullable: "NO", column_default: "false" });
    expect(await rows(pg)).toBe(before); // nothing else changed, the contact choice included
    expect((await pg.query("select count(*)::int n from contributions where from_sector_page")).rows[0]).toEqual({ n: 0 });
    await applyFile(runner(pg), name, read(UP)); // again: nothing breaks
    expect(await rows(pg)).toBe(before);
    await pg.close();
  });
  it("leaves migration 021 as it was on main (it may already be applied): 021 still adds only the contact column", () => {
    const m021 = read("db/migrations/021_contact_share.sql");
    expect(m021).not.toMatch(/from_sector_page/);
    expect(MIGRATIONS.find((m: any) => m.id === "021")!.checks).toEqual([{ kind: "column", table: "contributions", column: "share_contact_with_moderators" }]);
  });
  it("the status check knows it: missing before, applied after; 021 stays applied either way", async () => {
    expect(MIGRATIONS.find((m: any) => m.id === "022")).toMatchObject({ requires: ["012"], checks: [{ kind: "column", table: "contributions", column: "from_sector_page" }] });
    const { pg } = await build(false);
    expect((await status(pg))?.status).toBe("missing");
    expect((await status(pg, "021"))?.status).toBe("applied");
    const { pg: pg2 } = await build(true);
    expect((await status(pg2))?.status).toBe("applied");
    expect((await status(pg2, "021"))?.status).toBe("applied");
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
  it("rollback removes only the column, even when some contributions were started from a sector page; the rows and 021's column stay", async () => {
    const { pg, name } = await build(true);
    await pg.exec("update contributions set from_sector_page = true where title = 'First title here'");
    const before = await rows(pg);
    await expect(applyFile(runner(pg), name + "_wrong", read(DOWN))).rejects.toThrow(/Wrong database/);
    await pg.exec("ROLLBACK").catch(() => undefined);
    expect(await col(pg)).toBeDefined();
    await applyFile(runner(pg), name, read(DOWN));
    expect(await col(pg)).toBeUndefined();
    expect(await rows(pg)).toBe(before); // rows untouched, share_contact_with_moderators (021) still there
    expect((await status(pg))?.status).toBe("missing");
    await applyFile(runner(pg), name, read(DOWN)); // running it twice is harmless
    await pg.close();
  });
  it("the rollback file is not in db/migrations, so the runner can never pick it", () => {
    expect(pickFiles().some((f) => f.includes("022_down"))).toBe(false);
  });
});
