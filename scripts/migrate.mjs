#!/usr/bin/env node
// RoboValley migration runner. Applies db/migrations/*.sql in order, to the database named by DATABASE_URL.
//
// SAFETY MODEL (fails closed):
//   * It never reads .env.local by itself. You pass the connection explicitly (see "Usage"), so it cannot
//     silently pick up the wrong database.
//   * --expect-db <name> is REQUIRED and must equal the database name in DATABASE_URL, and again equal
//     current_database() on the server. Each migration file repeats that check inside the database.
//   * Without --apply it is a DRY RUN: it prints the target and the files, connects to nothing, changes nothing.
//   * It never prints passwords or full URLs. Of the host it prints only Neon's endpoint ID (e.g. ep-cool-darkness-123456): not a
//     secret (it cannot connect without the password), and the only way to tell a staging branch from production, because
//     both databases are called neondb. --expect-host <endpoint ID> makes the runner refuse any other server, even for a dry run.
//
// Usage (PowerShell, from the project folder):
//   $env:DATABASE_URL = "<connection string for the TARGET database>"     # this window only
//   npm run db:migrate -- --expect-db <database name>                      # dry run
//   npm run db:migrate -- --expect-db <database name> --only 003 --apply   # really run migration 003
// Local database (explicitly loading .env.local):
//   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 003
//
// Options:  --only <number>   run only that one migration (e.g. 003; "3" also means 003). Exact: "01" is refused, it does not mean 010-019
//           --file <path>     run one specific SQL file (e.g. db/rollback/003_down.sql). A file in db/migrations gets the same checks
//                             as --only <its number> (skipped when applied, refused when a migration it needs or an earlier one is missing)
//           --apply           actually execute (default is a dry run)
//           --status          READ-ONLY: connect and report which migrations are applied / missing / partial (never applies anything)
//           --force           with --apply: run a migration even though its objects already exist (normally skipped)
//           --allow-gaps      with --only: run it even though an EARLIER migration is missing or partly applied (normally refused,
//                             with the list of what is missing; apply those first, lowest number first)
//           --expect-host <endpoint ID>   refuse unless DATABASE_URL points to this Neon endpoint (shown in the Neon console)
// Every option that takes a value refuses to start without one (an empty value, or the option last on the line).
// Fails closed on the migration files too: a .sql file in db/migrations that is not named NNN_name.sql, two files with the same
// number, or a migration file without an entry in scripts/migration-status.mjs stop the run instead of being skipped or run blind.

import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DISABLED_NOTE, earlierGaps, formatStatus, migrationStatus, statusOf } from "./migration-status.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = resolve(here, "..", "db", "migrations");

/** How a migration file must be named: three digits, an underscore, a name, ".sql" (e.g. 024_sector_robot_types.sql). */
export const MIGRATION_NAME = /^\d{3}_.+\.sql$/;

/**
 * The migration files among the names in db/migrations, in order. Fails closed (throws, so nothing runs) when a .sql file does not
 * follow the naming rule (it would otherwise be skipped without a word) or when two files share a number (both would run, and the
 * status check could not tell them apart). Files that are not .sql (a README, .gitkeep) are ignored.
 * @param {string[]} names file names in the folder
 * @returns {string[]}
 */
export function checkMigrationNames(names) {
  const sqlFiles = names.filter((f) => /\.sql$/i.test(f)).sort();
  const misnamed = sqlFiles.filter((f) => !MIGRATION_NAME.test(f));
  if (misnamed.length) {
    throw new Error(`db/migrations holds .sql files that are not named NNN_name.sql (three digits, underscore, name, lower-case .sql): ${misnamed.join(", ")}. Rename or move them first; nothing was run.`);
  }
  const byNumber = new Map();
  for (const f of sqlFiles) byNumber.set(f.slice(0, 3), [...(byNumber.get(f.slice(0, 3)) ?? []), f]);
  const shared = [...byNumber.values()].filter((group) => group.length > 1);
  if (shared.length) {
    throw new Error(`Migration numbers must be used once, but ${shared.map((group) => group.join(" and ")).join("; ")} share one. Renumber one of them first; nothing was run.`);
  }
  return sqlFiles;
}

/**
 * Migration files in order. `only` filters by filename prefix; `file` selects exactly one file. The folder is always checked first
 * (see checkMigrationNames), so a misnamed or duplicate migration stops every run, including a --file run.
 * @param {{ dir?: string, only?: string, file?: string }} [opts]
 * @returns {string[]}
 */
export function pickFiles({ dir = MIGRATIONS_DIR, only, file } = {}) {
  const all = checkMigrationNames(readdirSync(dir));
  if (file) return [resolve(file)];
  const chosen = only ? all.filter((f) => f.startsWith(only)) : all;
  return chosen.map((f) => join(dir, f));
}

/**
 * For --file: the file name when the path is a migration in db/migrations (it then gets the same checks as --only), or null for any
 * other file (a rollback in db/rollback, for example, which runs without the status checks). A path inside db/migrations that is not
 * a correctly named file directly in that folder is refused.
 * @param {string} file the --file value
 * @param {string} [dir]
 * @returns {string | null}
 */
export function forwardMigrationName(file, dir = MIGRATIONS_DIR) {
  const rel = relative(dir, resolve(file));
  if (rel === "" || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) return null;
  const name = basename(rel);
  if (rel !== name || !MIGRATION_NAME.test(name)) {
    throw new Error(`${file} is inside db/migrations but is not a migration file (NNN_name.sql directly in that folder). Nothing was run.`);
  }
  return name;
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
 * Neon's endpoint ID from a connection string: the first part of the host name without "-pooler" (e.g. "ep-cool-darkness-123456").
 * null for anything that is not a Neon address. Never returns the rest of the host, the user or the password.
 * @param {string} url
 * @returns {string | null}
 */
export function neonEndpointId(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const m = /^(ep-[a-z0-9]+(?:-[a-z0-9]+)*?)(?:-pooler)?\.(?:[a-z0-9-]+\.)*neon\.tech$/.exec(host);
    return m ? m[1] : null;
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

/**
 * What to do with one migration file before applying it, from the database's real schema (read-only). A decision only, no writes.
 *   skip   - it is already applied (unless --force)
 *   refuse - it has no entry in scripts/migration-status.mjs (always: its state and prerequisites cannot be checked); it is not yet
 *            fully applied and a migration it needs is missing OR only partly applied (even with --allow-gaps; an already-applied
 *            migration run again with --force is not checked against its prerequisites and still runs); or, for a --only run, an
 *            earlier migration is missing or partly applied (unless --allow-gaps); the message lists them
 *   run    - go ahead (note: what to tell the operator first, e.g. "partly applied", or a disabled trigger to enable by hand)
 * @param {(sql: string) => Promise<{ rows: any[] }>} query
 * @param {string} fileName e.g. "024_sector_robot_types.sql"
 * @param {{ force?: boolean, only?: boolean, allowGaps?: boolean, expectDb?: string }} opts
 * @returns {Promise<{ action: 'skip'|'run'|'refuse', message?: string, note?: string }>}
 */
export async function preflight(query, fileName, opts = {}) {
  const id = fileName.slice(0, 3);
  const results = await migrationStatus(query);
  const st = statusOf(results, id);
  if (!st) return { action: "refuse", message: `${fileName} has no entry in scripts/migration-status.mjs, so the runner cannot tell whether it is already applied or what it needs. Add its entry there first.` };
  if (st.status === "applied" && !opts.force) return { action: "skip", message: `Skipping ${fileName} (already applied; --force runs it again)` };
  if (st.blockedBy.length) return { action: "refuse", message: prerequisiteMessage(fileName, st.blockedBy, results) };
  if (opts.only && !opts.allowGaps) {
    const gaps = earlierGaps(results, id);
    if (gaps.length) return { action: "refuse", message: gapMessage(fileName, gaps, opts.expectDb) };
  }
  const note = st.status === "partial" ? partialNote(fileName, st.absent) : undefined;
  return { action: "run", note };
}

/**
 * The note before running a partly applied migration. A disabled trigger is not missing, and running the migration again does not
 * enable it (the files only create what does not exist), so it is named on its own line with what a person has to do.
 * @param {string} fileName
 * @param {string[]} absent the status check's list for this migration
 */
function partialNote(fileName, absent) {
  const isDisabled = (a) => a.endsWith(` ${DISABLED_NOTE}`);
  const notThere = absent.filter((a) => !isDisabled(a));
  const off = absent.filter(isDisabled).map((a) => a.slice(0, -(DISABLED_NOTE.length + 1)));
  if (!off.length) return `Note: ${fileName} is partly applied (${notThere.join(", ")} missing); running it completes it.`;
  const one = off.length === 1;
  return [
    `Note: ${fileName} is partly applied.`,
    ...(notThere.length ? [`  Not in the database yet: ${notThere.join(", ")}. Running the migration adds ${notThere.length === 1 ? "it" : "them"}.`] : []),
    `  Disabled: ${off.join(", ")}. ${one ? "This trigger exists but is" : "These triggers exist but are"} switched off, and running the migration again will NOT enable ${one ? "it" : "them"}.`,
    `  Find out why ${one ? "it was" : "they were"} disabled, then enable ${one ? "it" : "them"} by hand: ALTER TABLE <table> ENABLE TRIGGER <trigger>.`,
  ].join("\n");
}

/**
 * The decision for one file of a run. Every migration from db/migrations gets preflight, including one named with --file (as if it
 * were --only <its number>, so --force, a missing prerequisite and earlier gaps are handled the same way). Any other --file (a rollback)
 * runs without the status checks: its own SQL refuses what it must not do.
 * @param {(sql: string) => Promise<{ rows: any[] }>} query
 * @param {string} filePath the file about to run
 * @param {{ file?: string, only?: string, force?: boolean, allowGaps?: boolean, expectDb?: string }} args the command-line options
 * @returns {Promise<{ action: 'skip'|'run'|'refuse', message?: string, note?: string }>}
 */
export async function decideFile(query, filePath, args) {
  const name = args.file ? forwardMigrationName(args.file) : basename(filePath);
  if (!name) return { action: "run" };
  return preflight(query, name, { force: args.force, only: Boolean(args.only) || Boolean(args.file), allowGaps: args.allowGaps, expectDb: args.expectDb });
}

/**
 * The refusal for a migration whose prerequisite is not fully applied: each prerequisite, whether it is missing or partly applied,
 * and for a partly applied one exactly which objects are missing. --allow-gaps never overrides it. No connection details.
 */
export function prerequisiteMessage(fileName, blockedBy, results) {
  const detail = blockedBy.map((id) => {
    const p = statusOf(results, id);
    return p.status === "partial" ? `${id} is partly applied (missing: ${p.absent.join(", ")})` : `${id} is missing (none of its objects are in this database)`;
  });
  return [
    `${fileName} needs migration ${blockedBy.join(", ")} first, fully applied:`,
    ...detail.map((d) => `    ${d}`),
    `  Apply ${blockedBy.length === 1 ? "it" : "them"} first (a dry run, then --apply), for example: node scripts/migrate.mjs --expect-db <database name> --only ${blockedBy[0]} --apply`,
    "  Run --status to see the state.",
  ].join("\n");
}

/**
 * The --only value as one exact migration number, from the names in db/migrations. Accepted: three digits ("011"), or one or two
 * digits without a leading zero ("11" means 011, "7" means 007), which cannot mean anything else. Refused, so that nothing runs:
 * any other form (several numbers, letters, four digits), a short number with a leading zero ("01" used to select 010-019 as a name
 * prefix, so reading it as 001 now would silently change what runs), and a number that has no migration file.
 * @param {string} value
 * @param {string[]} names the migration file names (see checkMigrationNames)
 * @returns {string} the three-digit number
 */
export function parseOnly(value, names) {
  const v = String(value).trim();
  let id;
  if (/^\d{3}$/.test(v)) id = v;
  else if (/^[1-9]\d?$/.test(v)) id = v.padStart(3, "0");
  else if (/^0\d?$/.test(v)) throw new Error(`--only ${value} is ambiguous: write the full three-digit migration number (for example --only 010). --only selects exactly one migration; it is not a name prefix. Nothing was run.`);
  else throw new Error(`--only takes one migration number, for example --only 024 (got "${value}"). Nothing was run.`);
  if (!names.some((f) => f.slice(0, 3) === id)) throw new Error(`There is no migration ${id} in db/migrations (--only ${value}). Nothing was run.`);
  return id;
}

/** The refusal for a --only run that would skip earlier migrations: what is missing, and what to run instead. No connection details. */
export function gapMessage(fileName, gaps, expectDb = "<database name>") {
  const id = fileName.slice(0, 3);
  return [
    `${fileName} comes after ${gaps.length === 1 ? "a migration that is" : `${gaps.length} migrations that are`} not fully applied in this database:`,
    ...gaps.map((g) => `    ${g.id}  ${(g.status === "partial" ? "partly applied" : "missing").padEnd(14)}  ${g.title}`),
    "  Apply them first, lowest number first (a dry run, then --apply), for example:",
    `    node scripts/migrate.mjs --expect-db ${expectDb} --only ${gaps[0].id} --apply`,
    `  Only if you are sure ${id} does not need them, run it again with --allow-gaps.`,
  ].join("\n");
}

const VALUE_EXAMPLE = { "--expect-db": "--expect-db neondb", "--expect-host": "--expect-host ep-cool-darkness-123456", "--only": "--only 024", "--file": "--file db/rollback/024_down.sql" };

function parseArgs(argv) {
  const a = { apply: false, status: false, force: false, allowGaps: false, expectDb: undefined, expectHost: undefined, only: undefined, file: undefined };
  // An option that takes a value must get one. Without this, "--only" or "--file" as the last word became a run of EVERY migration,
  // and a bare "--expect-host" silently switched the endpoint check off.
  const value = (t, v) => {
    if (v === undefined || v.trim() === "" || v.startsWith("--")) throw new Error(`${t} needs a value, for example ${VALUE_EXAMPLE[t]}. Nothing was run.`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--status") a.status = true;
    else if (t === "--force") a.force = true;
    else if (t === "--allow-gaps") a.allowGaps = true;
    else if (t === "--apply") a.apply = true;
    else if (t === "--expect-db") a.expectDb = value(t, argv[++i]);
    else if (t === "--expect-host") a.expectHost = value(t, argv[++i]);
    else if (t === "--only") a.only = value(t, argv[++i]);
    else if (t === "--file") a.file = value(t, argv[++i]);
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
  if (args.status && (args.apply || args.force || args.allowGaps || args.only || args.file)) fail("--status only reads the database. It cannot be combined with --apply, --force, --allow-gaps, --only or --file.");
  if (args.allowGaps && !args.only) fail("--allow-gaps only goes with --only <number> (a full run applies every migration in order, so it cannot skip one).");
  if (args.only) args.only = parseOnly(args.only, checkMigrationNames(readdirSync(MIGRATIONS_DIR))); // exact number, or refused here
  const forward = args.file ? forwardMigrationName(args.file) : null; // a --file in db/migrations is checked like --only (refused here if misnamed)
  const files = args.status ? [] : pickFiles({ only: args.only, file: args.file });
  if (!args.status && !files.length) fail("No migration files matched.");

  console.log("Target database name :", urlDb);
  console.log("Server location      :", isLocal ? "this computer (loopback)" : "remote server");
  const endpoint = isLocal ? null : neonEndpointId(url);
  if (!isLocal) console.log("Neon endpoint ID     :", endpoint ?? "(not a Neon address)");
  console.log("You confirmed        :", args.expectDb);
  if (!args.status) console.log("Files to run, in order:");
  for (const f of files) console.log("  -", f.replace(resolve(here, "..") + "\\", "").replace(resolve(here, "..") + "/", ""));

  if (urlDb !== args.expectDb) fail(`DATABASE_URL points to database "${urlDb}" but you confirmed "${args.expectDb}".`);
  if (args.expectHost !== undefined && args.expectHost !== endpoint) fail(`DATABASE_URL points to Neon endpoint "${endpoint ?? "(not a Neon address)"}" but you confirmed "${args.expectHost}".`);
  if (!args.apply && !args.status) {
    console.log("\nDRY RUN: nothing was connected or changed. Add --apply to run these files.");
    console.log("To see which of them the database already has, run the same command with --status (read-only).");
    if ((args.only || forward) && !args.allowGaps) console.log("With --apply, it first checks that every earlier migration is applied, and refuses (listing them) if one is not.");
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
      // Skip what the database already has; refuse to start one without a status entry, one whose prerequisite is missing, or (for
      // --only, and for --file on a migration) one that comes after a migration that is not fully applied, unless --allow-gaps.
      // A --file run of anything outside db/migrations (e.g. a rollback) is exempt: decideFile returns "run" for it.
      const p = await decideFile((sql) => client.query(sql), f, args);
      if (p.action === "skip") { console.log(p.message); continue; }
      if (p.action === "refuse") fail(p.message);
      if (p.note) console.log(p.note);
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
