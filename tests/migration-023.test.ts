// Migration 023 (contributions.type_chosen) and its rollback, on in-process PostgreSQL (PGlite).
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
const UP = "db/migrations/023_contribution_type_chosen.sql";
const DOWN = "db/rollback/023_down.sql";

/** Everything up to 022 applied, with one member and two contributions saved before 023 (the old form: 'resource'). */
async function build(apply023 = true) {
  const { pg, name } = await migratedClone((id) => id < "023"); // built once per file, a fresh copy per test (tests/helpers/migratedClone.ts)
  await pg.exec("insert into users (full_name,email,role,password_hash) values ('Asha','a@example.com','TC','x')");
  await pg.exec("insert into contributions (user_id, type, title, body) select id, 'resource', 'First title here', 'A long enough body.' from users");
  await pg.exec("insert into contributions (user_id, type, title, body, from_sector_page) select id, 'resource', 'Second title here', 'A long enough body.', true from users");
  if (apply023) await applyFile(runner(pg), name, read(UP));
  return { pg, name };
}
const col = async (pg: PGlite) => (await pg.query("select data_type, is_nullable, column_default from information_schema.columns where table_name='contributions' and column_name='type_chosen'")).rows[0] as any;
const rows = async (pg: PGlite) => JSON.stringify((await pg.query("select id, user_id, type, title, status, from_sector_page from contributions order by id")).rows);
const status = async (pg: PGlite, id = "023") => statusOf(await migrationStatus((sql: string) => pg.query(sql)), id);

describe("migration 023", () => {
  it("is the only 023 file and adds one boolean column, NOT NULL, default false; existing contributions get false (shown as 'not asked (older form)')", async () => {
    expect(pickFiles().map((f) => f.split(/[\\/]/).pop()).filter((f) => f!.startsWith("023"))).toEqual(["023_contribution_type_chosen.sql"]);
    const { pg, name } = await build(false);
    const before = await rows(pg);
    expect(await col(pg)).toBeUndefined();
    await applyFile(runner(pg), name, read(UP));
    expect(await col(pg)).toEqual({ data_type: "boolean", is_nullable: "NO", column_default: "false" });
    expect(await rows(pg)).toBe(before); // nothing else changed: the stored type and 022's column included
    expect((await pg.query("select count(*)::int n from contributions where type_chosen")).rows[0]).toEqual({ n: 0 });
    await applyFile(runner(pg), name, read(UP)); // again: nothing breaks
    expect(await rows(pg)).toBe(before);
    await pg.close();
  });
  it("needs no new type: problem, improve and resource were already allowed by 012's check, and nothing else is added", async () => {
    const { pg } = await build(true);
    for (const t of ["problem", "improve", "resource"]) await pg.exec(`insert into contributions (user_id, type, title, body, type_chosen) select id, '${t}', 'A ${t} title here', 'A long enough body.', true from users`);
    await expect(pg.exec("insert into contributions (user_id, type, title, body) select id, 'idea', 'An idea title here', 'A long enough body.' from users")).rejects.toThrow(/contributions_type_ck/);
    expect(read(UP).replace(/--.*$/gm, "")).not.toMatch(/contributions_type_ck|DROP|RENAME/i); // the SQL, not the comments
    await pg.close();
  });
  it("leaves 021 and 022 as they were on main (they may already be applied)", () => {
    expect(read("db/migrations/021_contact_share.sql")).not.toMatch(/type_chosen/);
    expect(read("db/migrations/022_contribution_origin.sql")).not.toMatch(/type_chosen/);
    expect(MIGRATIONS.find((m: any) => m.id === "022")!.checks).toEqual([{ kind: "column", table: "contributions", column: "from_sector_page" }]);
  });
  it("the status check knows it: missing before, applied after; 022 stays applied either way", async () => {
    expect(MIGRATIONS.find((m: any) => m.id === "023")).toMatchObject({ requires: ["012"], checks: [{ kind: "column", table: "contributions", column: "type_chosen" }] });
    const { pg } = await build(false);
    expect((await status(pg))?.status).toBe("missing");
    expect((await status(pg, "022"))?.status).toBe("applied");
    const { pg: pg2 } = await build(true);
    expect((await status(pg2))?.status).toBe("applied");
    expect((await status(pg2, "022"))?.status).toBe("applied");
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
  it("rollback REFUSES while any type was chosen (it would erase which types are real choices), and changes nothing", async () => {
    const { pg, name } = await build(true);
    await pg.exec("update contributions set type = 'problem', type_chosen = true where title = 'First title here'");
    const before = await rows(pg);
    await expect(applyFile(runner(pg), name, read(DOWN))).rejects.toThrow(/1 contribution\(s\) have a type the member chose/);
    await pg.exec("ROLLBACK").catch(() => undefined);
    expect(await col(pg)).toEqual({ data_type: "boolean", is_nullable: "NO", column_default: "false" });
    expect(await rows(pg)).toBe(before); // 'problem', 022's column and every other row as they were
    expect((await pg.query("select count(*)::int n from contributions where type_chosen")).rows[0]).toEqual({ n: 1 }); // the choice is kept
    expect((await status(pg))?.status).toBe("applied");
    await pg.close();
  });
  it("rollback with only false values removes only the column; stored types and 022's column stay; running it twice is harmless", async () => {
    const { pg, name } = await build(true);
    await pg.exec("update contributions set type = 'problem' where title = 'First title here'"); // a stored type that was not marked chosen
    const before = await rows(pg);
    await expect(applyFile(runner(pg), name + "_wrong", read(DOWN))).rejects.toThrow(/Wrong database/);
    await pg.exec("ROLLBACK").catch(() => undefined);
    expect(await col(pg)).toBeDefined();
    await applyFile(runner(pg), name, read(DOWN));
    expect(await col(pg)).toBeUndefined();
    expect(await rows(pg)).toBe(before); // rows untouched: 'problem' kept, from_sector_page (022) still there
    expect((await status(pg))?.status).toBe("missing");
    await applyFile(runner(pg), name, read(DOWN)); // running it twice is harmless
    await pg.close();
  });
  it("the rollback file is not in db/migrations, so the runner can never pick it", () => {
    expect(pickFiles().some((f) => f.includes("023_down"))).toBe(false);
  });
});
