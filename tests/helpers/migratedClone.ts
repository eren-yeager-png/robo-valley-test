// A migrated in-process database (PGlite) built ONCE per test file and handed to each test as its own fresh clone.
//
// Why: the migration tests used to build every database from scratch (base tables + up to 26 migrations, about 2.8 s of CPU each).
// Hundreds of those builds, three test files at a time on a 4-CPU machine, kept the CPU at 95-100% for minutes, and a test that takes
// 6 s on its own once took 35 s and hit the 30 s limit. A clone of an already migrated database costs about a quarter of a build
// (0.66 s against 2.8 s, measured), and it is a separate database: a test still never sees another test's rows or changes.
//
// The template is keyed by exactly which migrations it contains, so two tests asking for "everything before 022" share one template
// and a test asking for something else gets its own. Throwaway in-memory databases only; nothing here can reach a real server.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll } from "vitest";
import { applyFile, pickFiles } from "../../scripts/migrate.mjs";

const idOf = (path: string) => path.split(/[\\/]/).pop()!.slice(0, 3);
const templates = new Map<string, Promise<PGlite>>();

async function buildTemplate(ids: string[]): Promise<PGlite> {
  const pg = new PGlite();
  await pg.exec(readFileSync(resolve("tests/helpers/baseSchema.sql"), "utf8"));
  const name = String(((await pg.query("select current_database() d")).rows[0] as { d: string }).d);
  const run = { setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]), exec: (sql: string) => pg.exec(sql) };
  for (const f of pickFiles()) if (ids.includes(idOf(f))) await applyFile(run, name, readFileSync(f, "utf8"));
  // Without a checkpoint a clone starts from the write-ahead log, where PostgreSQL logs sequence values 32 ahead: the next sector id
  // after 016's seed would be 34 instead of 2. After it, a clone continues every identity exactly as a from-scratch build does.
  await pg.exec("CHECKPOINT");
  return pg;
}

/** For tests/migrated-clone.test.ts: the same database built from scratch, without the template. */
export async function migratedFromScratch(include: (id: string) => boolean = () => true): Promise<PGlite> {
  return buildTemplate(pickFiles().map(idOf).filter(include));
}

/**
 * A fresh database with the tests' base tables and every migration whose number passes `include` (all of them by default), applied
 * through the runner's own applyFile, exactly as a from-scratch build would. Close it at the end of the test as before.
 */
export async function migratedClone(include: (id: string) => boolean = () => true): Promise<{ pg: PGlite; name: string }> {
  const ids = pickFiles().map(idOf).filter(include);
  const key = ids.join(",");
  if (!templates.has(key)) templates.set(key, buildTemplate(ids));
  const pg = (await (await templates.get(key)!).clone()) as unknown as PGlite;
  const name = String(((await pg.query("select current_database() d")).rows[0] as { d: string }).d);
  return { pg, name };
}

// The templates live as long as the test file that built them.
afterAll(async () => {
  for (const t of templates.values()) await (await t).close();
  templates.clear();
});
