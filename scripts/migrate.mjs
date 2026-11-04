#!/usr/bin/env node
// RoboValley migration runner. Applies db/migrations/*.sql in order, to the database named by DATABASE_URL.
//
// SAFETY MODEL (fails closed):
//   * It never reads .env.local by itself. You pass the connection explicitly (see "Usage"), so it cannot
//     silently pick up the wrong database.
//   * --expect-db <name> is REQUIRED and must equal the database name in DATABASE_URL, and again equal
//     current_database() on the server. Each migration file repeats that check inside the database.
//   * Without --apply it is a DRY RUN: it prints the target and the files, connects to nothing, changes nothing.
//   * It never prints passwords, full URLs or host names.
//
// Usage (PowerShell, from the project folder):
//   $env:DATABASE_URL = "<connection string for the TARGET database>"     # this window only
//   npm run db:migrate -- --expect-db <database name>                      # dry run
//   npm run db:migrate -- --expect-db <database name> --only 003 --apply   # really run migration 003
// Local database (explicitly loading .env.local):
//   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 003
//
// Options:  --only <prefix>   run only files whose name starts with this (e.g. 003)
//           --file <path>     run one specific SQL file (e.g. db/rollback/003_down.sql)
//           --apply           actually execute (default is a dry run)
//           --status          READ-ONLY: connect and report which migrations are applied / missing / partial (never applies anything)
//           --force           with --apply: run a migration even though its objects already exist (normally skipped)

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { formatStatus, migrationStatus, statusOf } from "./migration-status.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = resolve(here, "..", "db", "migrations");

/**
 * Migration files in order. `only` filters by filename prefix; `file` selects exactly one file.
 * @param {{ dir?: string, only?: string, file?: string }} [opts]
 * @returns {string[]}
 */
export function pickFiles({ dir = MIGRATIONS_DIR, only, file } = {}) {
  if (file) return [resolve(file)];
  const all = readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const chosen = only ? all.filter((f) => f.startsWith(only)) : all;
  return chosen.map((f) => join(dir, f));
}

/**
 * Database name from a connection string, without touching anything else in it.
 * @param {string} url
 * @returns {string | null}
 */
export function dbNameFromUrl(url) {
  try {
    const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
    return name || null;
  } catch {
    return null;
  }
}

/**
 * Runs one SQL file after telling the database which database the operator confirmed.
 * `run` must provide: setExpected(name) and exec(sqlText). Used by the CLI (pg) and by the tests (PGlite).
 * If the file fails part-way (for example the database-name guard refuses), the open transaction is rolled back
 * explicitly before the error is rethrown, so the session is never left in an aborted state.
 * @param {{ setExpected: (name: string) => Promise<unknown>, exec: (sql: string) => Promise<unknown> }} run
 * @param {string} expectDb
 * @param {string} sqlText
 */
export async function applyFile(run, expectDb, sqlText) {
  await run.setExpected(expectDb);
  try {
    await run.exec(sqlText);
  } catch (err) {
    try { await run.exec("ROLLBACK"); } catch { /* nothing to roll back */ }
    throw err;
  }
}

/** A short, plain-English next step for common failures. No SQL, values or connection details. */
export function hintFor(e) {
  const code = e && e.code;
  if (code === "42P01") return "\nHint: a table it needs does not exist. An earlier migration is probably missing - run with --status.";
  if (code === "42703") return "\nHint: a column it needs does not exist. An earlier migration is probably missing - run with --status.";
  if (code === "23505") return "\nHint: existing data conflicts with a new unique rule. Nothing was changed; look at the data before retrying.";
  if (code === "23514") return "\nHint: existing data breaks a new rule. Nothing was changed; look at the data before retrying.";
  if (code === "42501") return "\nHint: this database user is not allowed to do that. Use an account that owns the tables.";
  return "";
}

function parseArgs(argv) {
  const a = { apply: false, status: false, force: false, expectDb: undefined, only: undefined, file: undefined };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--status") a.status = true;
    else if (t === "--force") a.force = true;
    else if (t === "--apply") a.apply = true;
    else if (t === "--expect-db") a.expectDb = argv[++i];
    else if (t === "--only") a.only = argv[++i];
    else if (t === "--file") a.file = argv[++i];
    else throw new Error(`Unknown option: ${t}`);
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  const fail = (msg) => { console.error("\n✖ " + msg + "\nNothing was changed."); process.exit(1); };

  if (!args.expectDb) fail('Missing --expect-db <database name>. Type the name of the database you intend to change, e.g. --expect-db robovalley_auth');
  if (!url) fail("DATABASE_URL is not set in this window. This script does not read .env.local by itself (see the usage notes at the top of scripts/migrate.mjs).");

  const urlDb = dbNameFromUrl(url);
  if (!urlDb) fail("Could not read a database name from DATABASE_URL.");
  const isLocal = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(new URL(url).hostname);
  if (args.status && (args.apply || args.force || args.only || args.file)) fail("--status only reads the database. It cannot be combined with --apply, --force, --only or --file.");
  const files = args.status ? [] : pickFiles({ only: args.only, file: args.file });
  if (!args.status && !files.length) fail("No migration files matched.");

  console.log("Target database name :", urlDb);
  console.log("Server location      :", isLocal ? "this computer (loopback)" : "remote server");
  console.log("You confirmed        :", args.expectDb);
  if (!args.status) console.log("Files to run, in order:");
  for (const f of files) console.log("  -", f.replace(resolve(here, "..") + "\\", "").replace(resolve(here, "..") + "/", ""));

  if (urlDb !== args.expectDb) fail(`DATABASE_URL points to database "${urlDb}" but you confirmed "${args.expectDb}".`);
  if (!args.apply && !args.status) {
    console.log("\nDRY RUN: nothing was connected or changed. Add --apply to run these files.");
    console.log("To see which of them the database already has, run the same command with --status (read-only).");
    return;
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query("select current_database() as d");
    if (rows[0].d !== args.expectDb) fail(`Connected to database "${rows[0].d}" but you confirmed "${args.expectDb}".`);
    if (args.status) {
      await client.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY"); // the database itself refuses any write from here on
      console.log("\n" + formatStatus(await migrationStatus((sql) => client.query(sql))));
      return;
    }
    const run = {
      setExpected: (name) => client.query("select set_config('rv.expected_db', $1, false)", [name]),
      exec: (sql) => client.query(sql), // simple query protocol: the file's own BEGIN/COMMIT makes it all-or-nothing
    };
    for (const f of files) {
      const name = f.split(/[\\/]/).pop();
      // Skip what the database already has, and refuse to start one whose prerequisite is missing. (A --file run, e.g. a rollback, is exempt.)
      if (!args.file) {
        const st = statusOf(await migrationStatus((sql) => client.query(sql)), name.slice(0, 3));
        if (st && st.status === "applied" && !args.force) { console.log(`Skipping ${name} (already applied; --force runs it again)`); continue; }
        if (st && st.blockedBy.length) fail(`${name} needs migration ${st.blockedBy.join(", ")} first (its tables are not in this database). Run --status to see the state.`);
        if (st && st.status === "partial") console.log(`Note: ${name} is partly applied (${st.absent.join(", ")} missing); running it completes it.`);
      }
      process.stdout.write(`Applying ${name} ... `);
      try {
        await applyFile(run, args.expectDb, readFileSync(f, "utf8"));
        console.log("done");
      } catch (e) {
        console.log("FAILED");
        fail(`${name}: ${String(e.message).split("\n")[0]}${hintFor(e)}\nThe file runs as one transaction, so it left nothing half-applied.`);
      }
    }
    console.log("\nAll requested files applied.");
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    // Connection errors normally contain the server address and port; say what happened without them.
    const unreachable = e && ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN"].includes(e.code);
    const msg = unreachable ? `Could not connect to the database (${e.code}). Check DATABASE_URL and that the server is running.` : e && e.message ? String(e.message).split("\n")[0] : "Unexpected error";
    console.error("\n✖ " + msg + "\nNothing further was changed.");
    process.exit(1);
  });
}
