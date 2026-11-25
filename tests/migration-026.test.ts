// Migration 026 (sector_questions) and its rollback, on in-process PostgreSQL (PGlite). Throwaway in-memory databases only.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyFile, pickFiles } from "../scripts/migrate.mjs";
import { MIGRATIONS, migrationStatus, statusOf } from "../scripts/migration-status.mjs";
import { migratedClone } from "./helpers/migratedClone";

const read = (p: string) => readFileSync(resolve(p), "utf8");
const runner = (pg: PGlite) => ({ setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]), exec: (sql: string) => pg.exec(sql) });
const UP = "db/migrations/026_sector_questions.sql";
const DOWN = "db/rollback/026_down.sql";

/** Every migration before 026, and one administrator. */
async function build(apply026 = true) {
  const { pg, name } = await migratedClone((id) => id < "026"); // built once per file, a fresh copy per test (tests/helpers/migratedClone.ts)
  await pg.exec("insert into users (full_name,email,role,password_hash) values ('Boss','boss@example.com','admin','x')");
  if (apply026) await applyFile(runner(pg), name, read(UP));
  return { pg, name };
}
const agri = async (pg: PGlite) => Number(((await pg.query("select id from sectors where slug = 'agriculture-dairy'")).rows[0] as any).id);
const add = (pg: PGlite, sector: number, label: string, kind: string, options: unknown) =>
  pg.query("insert into sector_questions (sector_id, label, kind, options) values ($1, $2, $3, $4::jsonb)", [sector, label, kind, options === null ? null : JSON.stringify(options)]);
const exists = async (pg: PGlite) => ((await pg.query("select to_regclass('sector_questions') is not null as t")).rows[0] as any).t as boolean;
const others = async (pg: PGlite) => JSON.stringify((await pg.query("select (select count(*) from sectors) a, (select count(*) from users) b, (select count(*) from contributions) c")).rows);
const status = async (pg: PGlite) => statusOf(await migrationStatus((sql: string) => pg.query(sql)), "026");

describe("migration 026", () => {
  it("is the only 026 file and adds one table; nothing that existed changes; running it twice is harmless", async () => {
    expect(pickFiles().map((f) => f.split(/[\\/]/).pop()).filter((f) => f!.startsWith("026"))).toEqual(["026_sector_questions.sql"]);
    const { pg, name } = await build(false);
    const before = await others(pg);
    expect(await exists(pg)).toBe(false);
    await applyFile(runner(pg), name, read(UP));
    expect(await exists(pg)).toBe(true);
    expect((await pg.query("select column_name from information_schema.columns where table_name = 'sector_questions' order by ordinal_position")).rows.map((r: any) => r.column_name))
      .toEqual(["id", "sector_id", "label", "kind", "options", "is_required", "sort_order", "is_active", "created_at", "updated_at", "updated_by"]);
    expect(await others(pg)).toBe(before);
    await applyFile(runner(pg), name, read(UP));
    expect(await others(pg)).toBe(before);
    expect(read(UP).replace(/--.*$/gm, "")).not.toMatch(/\bDROP\b|\bRENAME\b|ALTER TABLE/i);
    await pg.close();
  });

  it("a text question has no choices; a pick-one question has 2 to 10; the wording is 5-200 characters, trimmed; kind is text or choice", async () => {
    const { pg } = await build(true);
    const s = await agri(pg);
    await add(pg, s, "How many animals?", "text", null);
    await add(pg, s, "Which shed?", "choice", ["North", "South"]);
    await expect(add(pg, s, "How many animals?", "text", ["a", "b"])).rejects.toThrow(/sector_questions_options_ck/);
    await expect(add(pg, s, "Which shed?", "choice", ["Only one"])).rejects.toThrow(/sector_questions_options_ck/);
    await expect(add(pg, s, "Which shed?", "choice", Array.from({ length: 11 }, (_, i) => `C${i}`))).rejects.toThrow(/sector_questions_options_ck/);
    await expect(add(pg, s, "Which shed?", "choice", null)).rejects.toThrow(/sector_questions_options_ck/);
    await expect(add(pg, s, "Hm?", "text", null)).rejects.toThrow(/sector_questions_label_ck/);
    await expect(add(pg, s, " Padded question ", "text", null)).rejects.toThrow(/sector_questions_label_ck/);
    await expect(add(pg, s, "How many animals?", "number", null)).rejects.toThrow(/sector_questions_kind_ck/);
    await expect(add(pg, 999999, "How many animals?", "text", null)).rejects.toThrow(/foreign key/);
    expect((await pg.query("select count(*)::int n from sector_questions")).rows[0]).toEqual({ n: 2 });
    await pg.close();
  });

  it("options, every shape for both kinds: text takes only SQL NULL; choice only an array of 2 to 10; every refusal is the check (23514), never a JSON error", async () => {
    const { pg } = await build(true);
    const s = await agri(pg);
    const arr = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => `C${i}`));
    // [shape, options as SQL] : the same 20 cases recorded on the unchanged 026 before the CASE rewrite (behaviour must not change)
    const shapes: Array<[string, string]> = [["object", `'{"a":1}'::jsonb`], ["string", `'"abc"'::jsonb`], ["number", "'7'::jsonb"], ["JSON null", "'null'::jsonb"],
      ["SQL NULL", "NULL"], ["[]", "'[]'::jsonb"], ["1 item", `'${arr(1)}'::jsonb`], ["2 items", `'${arr(2)}'::jsonb`], ["10 items", `'${arr(10)}'::jsonb`], ["11 items", `'${arr(11)}'::jsonb`]];
    const accepted = { text: ["SQL NULL"], choice: ["2 items", "10 items"] } as const;
    for (const kind of ["text", "choice"] as const) for (const [shape, v] of shapes) {
      const insert = pg.exec(`insert into sector_questions (sector_id, label, kind, options) values (${s}, 'Which one is it?', '${kind}', ${v})`);
      if ((accepted[kind] as readonly string[]).includes(shape)) await insert;
      else await expect(insert, `${kind} ${shape}`).rejects.toMatchObject({ code: "23514", message: expect.stringMatching(/sector_questions_options_ck/) });
    }
    expect((await pg.query("select kind, jsonb_array_length(coalesce(options, '[]'::jsonb))::int n from sector_questions order by id")).rows)
      .toEqual([{ kind: "text", n: 0 }, { kind: "choice", n: 2 }, { kind: "choice", n: 10 }]);
    // the length is read only inside CASE ... WHEN jsonb_typeof(options) = 'array', so it no longer depends on evaluation order
    expect(String((await pg.query("select pg_get_constraintdef(oid) d from pg_constraint where conname = 'sector_questions_options_ck'")).rows[0]!["d" as never])).toMatch(/CASE\s+WHEN \(jsonb_typeof\(options\) = 'array'::text\) THEN/);
    await pg.close();
  });

  it("a switched-off question can never be required (the database refuses it, too)", async () => {
    const { pg } = await build(true);
    const s = await agri(pg);
    await add(pg, s, "How many animals?", "text", null);
    await pg.exec("update sector_questions set is_required = true");
    await expect(pg.exec("update sector_questions set is_active = false")).rejects.toThrow(/sector_questions_required_on_ck/);
    await pg.exec("update sector_questions set is_active = false, is_required = false");
    expect((await pg.query("select is_active, is_required from sector_questions")).rows).toEqual([{ is_active: false, is_required: false }]);
    await pg.close();
  });

  it("the status check knows it: missing before, applied after; it needs only 012", async () => {
    expect(MIGRATIONS.find((m: any) => m.id === "026")).toMatchObject({ requires: ["012"] });
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
    expect(await exists(pg)).toBe(false);
    await pg.close();
  });

  it("rollback refuses while any question exists (switched off included), and drops the empty table", async () => {
    const { pg, name } = await build(true);
    await add(pg, await agri(pg), "How many animals?", "text", null);
    await pg.exec("update sector_questions set is_active = false");
    await expect(applyFile(runner(pg), name, read(DOWN))).rejects.toThrow(/Questions have been written/);
    await pg.exec("ROLLBACK").catch(() => undefined);
    expect(await exists(pg)).toBe(true);
    await pg.exec("delete from sector_questions");
    const before = await others(pg);
    await applyFile(runner(pg), name, read(DOWN));
    expect(await exists(pg)).toBe(false);
    expect(await others(pg)).toBe(before);
    await applyFile(runner(pg), name, read(DOWN)); // twice is harmless
    await pg.close();
  });

  it("the rollback file is not in db/migrations, so the runner can never pick it", () => {
    expect(pickFiles().some((f) => f.includes("026_down"))).toBe(false);
  });
});
