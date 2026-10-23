// In-process PostgreSQL (PGlite = real Postgres compiled to WebAssembly) for tests.
// It is created empty, receives the test base tables, then the REAL migrations (001, 002, 003) through the
// same code path the migration runner uses. It never touches any real database.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyFile, pickFiles } from "../../scripts/migrate.mjs";

export type Call = { sql: string; params?: unknown[] };
type Failer = (sql: string, params?: unknown[]) => Error | undefined;

export async function createHarness() {
  // bigint (OID 20) as string, exactly like node-postgres returns it
  const pg = new PGlite({ parsers: { 20: (v: string) => v } } as never);
  await pg.exec(readFileSync(resolve("tests/helpers/baseSchema.sql"), "utf8"));
  const dbName = String((await pg.query("select current_database() as d")).rows[0]!["d" as never]);
  const run = {
    setExpected: (name: string) => pg.query("select set_config('rv.expected_db', $1, false)", [name]),
    exec: (sql: string) => pg.exec(sql),
  };
  for (const f of pickFiles()) await applyFile(run, dbName, readFileSync(f, "utf8"));

  const calls: Call[] = [];
  let failer: Failer | undefined;
  let released = 0;

  // PGlite has one connection. A held "client" (transaction) blocks other statements until released,
  // which is how a one-connection pool would behave.
  let tail: Promise<void> = Promise.resolve();
  const lock = () => {
    let release!: () => void;
    const prev = tail;
    tail = new Promise<void>((r) => (release = r));
    return prev.then(() => release);
  };

  const exec = async (sql: string, params?: unknown[], record = true) => {
    if (record) {
      calls.push({ sql, params });
      const err = failer?.(sql, params);
      if (err) throw err;
    }
    const r = await pg.query(sql, params as never);
    return { rows: r.rows as any[], rowCount: r.affectedRows ?? r.rows.length };
  };

  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      const release = await lock();
      try { return await exec(sql, params); } finally { release(); }
    },
    connect: async () => {
      const release = await lock();
      return {
        query: (sql: string, params?: unknown[]) => exec(sql, params),
        release: () => { released++; release(); },
      };
    },
  };

  // Same database and same one-connection discipline, but statements are neither recorded nor failed on purpose.
  // Used to ARRANGE state (e.g. get a verification token) without polluting the assertions about what the app ran.
  const quiet = {
    query: async (sql: string, params?: unknown[]) => {
      const release = await lock();
      try { return await exec(sql, params, false); } finally { release(); }
    },
    connect: async () => {
      const release = await lock();
      return { query: (sql: string, params?: unknown[]) => exec(sql, params, false), release };
    },
  };

  return {
    pool,
    quiet,
    /** Direct access for arranging/inspecting data (not recorded in `calls`). */
    raw: pg,
    dbName,
    calls,
    released: () => released,
    /** Make matching statements throw (to simulate database failures). */
    failOn: (f: Failer | undefined) => { failer = f; },
    /** Empties every table and forgets recorded calls. Uses only the in-process database. */
    reset: async () => {
      await pg.exec("TRUNCATE users, guardian_details, otp_challenges, email_verifications, login_attempts RESTART IDENTITY CASCADE");
      calls.length = 0; failer = undefined; released = 0;
    },
    close: () => pg.close(),
  };
}
export type Harness = Awaited<ReturnType<typeof createHarness>>;
