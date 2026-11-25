// Migration 022 (contributions.from_sector_page) and its rollback, on in-process PostgreSQL (PGlite).
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
const UP = "db/migrations/022_contribution_origin.sql";
const DOWN = "db/rollback/022_down.sql";

/** Everything up to 021 applied, with one member and two contributions saved before 022. */
async function build(apply022 = true) {
  const { pg, name } = await migratedClone((id) => id < "022"); // built once per file, a fresh copy per test (tests/helpers/migratedClone.ts)
  await pg.exec("insert into users (full_name,email,role,password_hash) values ('Asha','a@example.com','TC','x')");
  await pg.exec("insert into contributions (user_id, type, title, body) select id, 'resource', 'First title here', 'A long enough body.' from users");
  await pg.exec("insert into contributions (user_id, type, title, body, share_contact_with_moderators) select id, 'resource', 'Second title here', 'A long enough body.', true from users");
  if (apply022) await applyFile(runner(pg), name, read(UP));
  return { pg, name };
}
const col = async (pg: PGlite) => (await pg.query("select data_type, is_nullable, column_default from information_schema.columns where table_name='contributions' and column_name='from_sector_page'")).rows[0] as any;
const rows = async (pg: PGlite) => JSON.stringify((await pg.query("select id, user_id, title, status, share_contact_with_moderators from contributions order by id")).rows);
const status = async (pg: PGlite, id = "022") => statusOf(await migrationStatus((sql: string) => pg.query(sql)), id);
const columns = async (pg: PGlite) => JSON.stringify((await pg.query("select column_name, data_type, is_nullable, column_default from information_schema.columns where table_name = 'contributions' order by ordinal_position")).rows);
const has = async (pg: PGlite, column: string) => ((await pg.query("select count(*)::int n from information_schema.columns where table_name = 'contributions' and column_name = $1", [column])).rows[0] as any).n === 1;

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
  it("rollback REFUSES while any contribution was started from a sector page, and changes nothing (column, values, rows and 021's column stay)", async () => {
    const { pg, name } = await build(true);
    await pg.exec("update contributions set from_sector_page = true where title = 'First title here'");
    const before = await rows(pg);
    const schemaBefore = await columns(pg);
    await expect(applyFile(runner(pg), name, read(DOWN))).rejects.toThrow(/1 contribution\(s\) were started from a sector page/);
    await pg.exec("ROLLBACK").catch(() => undefined);
    expect(await col(pg)).toBeDefined();
    expect(await columns(pg)).toBe(schemaBefore);
    expect(await rows(pg)).toBe(before);
    expect((await pg.query("select count(*)::int n from contributions where from_sector_page")).rows[0]).toEqual({ n: 1 }); // the value itself is kept
    expect((await status(pg))?.status).toBe("applied");
    await pg.close();
  });
  it("rollback with only false values removes only from_sector_page; the rows and 021's column stay; running it twice is harmless", async () => {
    const { pg, name } = await build(true);
    const before = await rows(pg);
    await expect(applyFile(runner(pg), name + "_wrong", read(DOWN))).rejects.toThrow(/Wrong database/);
    await pg.exec("ROLLBACK").catch(() => undefined);
    expect(await col(pg)).toBeDefined();
    await applyFile(runner(pg), name, read(DOWN));
    expect(await col(pg)).toBeUndefined();
    expect(await rows(pg)).toBe(before); // rows untouched, share_contact_with_moderators (021) still there
    expect((await status(pg))?.status).toBe("missing");
    expect((await status(pg, "021"))?.status).toBe("applied");
    await applyFile(runner(pg), name, read(DOWN)); // running it twice is harmless
    await pg.close();
  });
  it("each rollback owns one column: 021_down never touches from_sector_page, 022_down never touches share_contact_with_moderators", async () => {
    const sqlOf = (p: string) => read(p).replace(/--.*$/gm, "");
    expect(sqlOf("db/rollback/021_down.sql")).not.toMatch(/from_sector_page/);
    expect(sqlOf(DOWN)).not.toMatch(/share_contact_with_moderators/);
    // with 022 still applied, undoing 021 leaves 022's column and its true values alone
    const { pg, name } = await build(true);
    await pg.exec("update contributions set from_sector_page = true where title = 'First title here'");
    await pg.exec("update contributions set share_contact_with_moderators = false"); // 021_down refuses ticked boxes (its own check)
    await applyFile(runner(pg), name, read("db/rollback/021_down.sql"));
    expect(await has(pg, "share_contact_with_moderators")).toBe(false);
    expect((await pg.query("select count(*)::int n from contributions where from_sector_page")).rows[0]).toEqual({ n: 1 });
    expect((await status(pg))?.status).toBe("applied");
    await pg.close();
  });
  it("reverse order works: 022_down, then 021_down, each removing only its own column", async () => {
    const { pg, name } = await build(true);
    await pg.exec("update contributions set share_contact_with_moderators = false");
    await applyFile(runner(pg), name, read(DOWN));
    expect(await has(pg, "from_sector_page")).toBe(false);
    expect(await has(pg, "share_contact_with_moderators")).toBe(true);
    await applyFile(runner(pg), name, read("db/rollback/021_down.sql"));
    expect(await has(pg, "share_contact_with_moderators")).toBe(false);
    expect((await pg.query("select count(*)::int n from contributions")).rows[0]).toEqual({ n: 2 }); // no row lost
    await pg.close();
  });
  it("the rollback file is not in db/migrations, so the runner can never pick it", () => {
    expect(pickFiles().some((f) => f.includes("022_down"))).toBe(false);
  });
});
