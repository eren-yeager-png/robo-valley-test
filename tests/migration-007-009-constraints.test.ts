// Migrations 007 and 009 look up their CHECK constraint on their own table and compare its EXACT definition (as PostgreSQL writes it)
// with their own rule, not by name alone and not by substrings, and their rollbacks remove only the constraint the migration made.
// In-process PostgreSQL (PGlite) only; no real database is involved.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyFile } from "../scripts/migrate.mjs";
import { migrationStatus, statusOf } from "../scripts/migration-status.mjs";
import { migratedClone } from "./helpers/migratedClone";

const read = (p: string) => readFileSync(resolve(p), "utf8");
const runner = (pg: PGlite) => ({ setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]), exec: (sql: string) => pg.exec(sql) });
const status = async (pg: PGlite, id: string) => statusOf(await migrationStatus((sql: string) => pg.query(sql) as any), id)!.status;
const owners = async (pg: PGlite, conname: string) =>
  (await pg.query("select conrelid::regclass::text t, contype from pg_constraint where conname = $1 order by 1", [conname])).rows;
const column = async (pg: PGlite, table: string, col: string) =>
  ((await pg.query("select count(*)::int n from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2", [table, col])).rows[0] as any).n === 1;

// nearMiss: a rule of the same name on the migration's own columns that a substring check took for the migration's own (review probes
// P2b and P2a); nearMissColumns: the columns it needs, made first, as in the probes.
const CASES = [
  { id: "007", up: "db/migrations/007_service_categories.sql", down: "db/rollback/007_down.sql", table: "service_datasets", con: "service_datasets_category_check",
    column: "category", foreign: "check (row_count >= 0)", refusedUp: /is not the category allow-list/, refusedDown: /is not the category allow-list 007 makes/,
    probe: "P2b, an extra allowed category", nearMissColumns: "add column category varchar(40) not null default 'atl-labs'",
    nearMiss: "check (category in ('atl-labs','robotics-labs','stem-labs','3d-printing-facilities','robotics-training-centres','innovation-centres','anything-else'))" },
  { id: "009", up: "db/migrations/009_upload_attachments.sql", down: "db/rollback/009_down.sql", table: "upload_audit_log", con: "upload_audit_log_attachment_kind_ck",
    column: "attachment_id", foreign: "check (action <> '')", refusedUp: /is not the attachment\/kind rule/, refusedDown: /is not the rule 009 makes/,
    probe: "P2a, the opposite rule kind <> 'attachment'", nearMissColumns: "add column kind varchar(12) not null default 'dataset', add column attachment_id bigint",
    nearMiss: "check (attachment_id is null or kind <> 'attachment')" },
] as const;
const definition = async (pg: PGlite, table: string, con: string) =>
  ((await pg.query("select pg_get_constraintdef(oid) d from pg_constraint where conrelid = $1::regclass and conname = $2", [table, con])).rows[0] as any)?.d;
const tempTables = async (pg: PGlite) => ((await pg.query("select count(*)::int n from pg_class where relpersistence = 't'")).rows[0] as any).n;

for (const c of CASES) {
  describe(`migration ${c.id}: ${c.con}`, () => {
    const before = () => migratedClone((id) => id < c.id); // everything up to the one before, built once per file

    it("the correct constraint: made on the right table, safe to run again, status applied", async () => {
      const { pg, name } = await before();
      await applyFile(runner(pg), name, read(c.up));
      expect(await owners(pg, c.con)).toEqual([{ t: c.table, contype: "c" }]);
      await applyFile(runner(pg), name, read(c.up)); // the definition matches: it goes ahead without a change
      expect(await owners(pg, c.con)).toEqual([{ t: c.table, contype: "c" }]);
      expect(await status(pg, c.id)).toBe("applied");
      await pg.close();
    });

    it("a constraint of the same name on another table, or in another schema, is not taken for it: it is still made", async () => {
      const { pg, name } = await before();
      await pg.exec(`create table side_t (x int, constraint ${c.con} check (x > 0))`);
      await pg.exec(`create schema other; create table other.${c.table} (x int, constraint ${c.con} check (x > 0))`);
      await applyFile(runner(pg), name, read(c.up));
      expect(await owners(pg, c.con)).toEqual([{ t: "other." + c.table, contype: "c" }, { t: c.table, contype: "c" }, { t: "side_t", contype: "c" }]
        .sort((a, b) => (a.t < b.t ? -1 : 1))); // one on each table: the migration's own is there next to the two unrelated ones
      expect(await status(pg, c.id)).toBe("applied");
      await pg.close();
    });

    it("a constraint of the same name on the right table with another definition stops the migration, and nothing of it is applied", async () => {
      const { pg, name } = await before();
      await pg.exec(`alter table ${c.table} add constraint ${c.con} ${c.foreign}`);
      await expect(applyFile(runner(pg), name, read(c.up))).rejects.toThrow(c.refusedUp);
      await pg.exec("ROLLBACK").catch(() => undefined);
      expect(await column(pg, c.table, c.column)).toBe(false); // the whole file rolled back
      expect(await owners(pg, c.con)).toEqual([{ t: c.table, contype: "c" }]); // the other constraint is untouched
      await pg.close();
    });

    it("rollback removes the constraint the migration made, but refuses (removing nothing) one of the same name it did not make", async () => {
      const { pg, name } = await before();
      await applyFile(runner(pg), name, read(c.up));
      await pg.exec(`alter table ${c.table} drop constraint ${c.con}`);
      await pg.exec(`alter table ${c.table} add constraint ${c.con} ${c.foreign}`); // not the migration's
      await expect(applyFile(runner(pg), name, read(c.down))).rejects.toThrow(c.refusedDown);
      await pg.exec("ROLLBACK").catch(() => undefined);
      expect(await owners(pg, c.con)).toEqual([{ t: c.table, contype: "c" }]);
      expect(await column(pg, c.table, c.column)).toBe(true); // nothing was removed
      await pg.exec(`alter table ${c.table} drop constraint ${c.con}`);
      await applyFile(runner(pg), name, read(c.up)); // back to the migration's own constraint
      await applyFile(runner(pg), name, read(c.down)); // now it goes ahead
      expect(await owners(pg, c.con)).toEqual([]);
      expect(await column(pg, c.table, c.column)).toBe(false);
      await pg.close();
    });

    it(`a same-named rule on its own columns that is almost the rule (${c.probe}) is a mismatch: the migration stops and its status is never applied`, async () => {
      const { pg, name } = await before();
      await pg.exec(`alter table ${c.table} ${c.nearMissColumns}, add constraint ${c.con} ${c.nearMiss}`);
      const nearMiss = await definition(pg, c.table, c.con);
      await expect(applyFile(runner(pg), name, read(c.up))).rejects.toThrow(c.refusedUp);
      await pg.exec("ROLLBACK").catch(() => undefined);
      await expect(applyFile(runner(pg), name, read(c.up))).rejects.toThrow(nearMiss); // the message shows the rule it found
      await pg.exec("ROLLBACK").catch(() => undefined);
      expect(await definition(pg, c.table, c.con)).toBe(nearMiss); // left exactly as it was
      expect(await status(pg, c.id)).toBe("partial"); // its own columns and that name are there, the rest of the migration is not
      await pg.close();
    });

    it(`the rollback refuses (removing nothing) a same-named rule that is almost the rule (${c.probe}), and running the migration again stops too`, async () => {
      const { pg, name } = await before();
      await applyFile(runner(pg), name, read(c.up));
      await pg.exec(`alter table ${c.table} drop constraint ${c.con}`);
      await pg.exec(`alter table ${c.table} add constraint ${c.con} ${c.nearMiss}`); // looks like the migration's, means something else
      const nearMiss = await definition(pg, c.table, c.con);
      await expect(applyFile(runner(pg), name, read(c.down))).rejects.toThrow(c.refusedDown);
      await pg.exec("ROLLBACK").catch(() => undefined);
      expect(await definition(pg, c.table, c.con)).toBe(nearMiss);
      expect(await column(pg, c.table, c.column)).toBe(true); // nothing was removed
      await expect(applyFile(runner(pg), name, read(c.up))).rejects.toThrow(c.refusedUp);
      await pg.exec("ROLLBACK").catch(() => undefined);
      expect(await definition(pg, c.table, c.con)).toBe(nearMiss);
      await pg.close();
    });

    it("the exact comparison leaves nothing behind: no temporary table after a re-run or a rollback, in the same session", async () => {
      const { pg, name } = await before();
      await applyFile(runner(pg), name, read(c.up));
      expect(await tempTables(pg)).toBe(0);
      await applyFile(runner(pg), name, read(c.up)); // compares the rule it finds with its own (the throwaway copy is undone)
      await applyFile(runner(pg), name, read(c.up)); // and again in the same session: nothing of the first comparison is in the way
      expect(await tempTables(pg)).toBe(0);
      await applyFile(runner(pg), name, read(c.down)); // the rollback compares the same way before removing it
      expect(await tempTables(pg)).toBe(0);
      expect(await owners(pg, c.con)).toEqual([]);
      await pg.close();
    });
  });
}
