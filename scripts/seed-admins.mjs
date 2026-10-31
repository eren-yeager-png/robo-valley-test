#!/usr/bin/env node
// RoboValley admin seeding. Creates (or promotes) administrator accounts in the database named by DATABASE_URL.
//
// Credentials come ONLY from environment variables (never from files in the repo, never printed):
//   ADMIN1_EMAIL / ADMIN1_PASSWORD, ADMIN2_EMAIL / ADMIN2_PASSWORD  (ADMIN3..ADMIN9 work the same way)
//
// SAFETY MODEL (same as scripts/migrate.mjs, fails closed):
//   * --expect-db <name> is REQUIRED and must equal the database name in DATABASE_URL, and again equal current_database().
//   * Without --apply it is a DRY RUN: it prints the target and the admin emails, connects to nothing, changes nothing.
//   * It never prints passwords, hashes, full URLs or host names.
//
// Behaviour (idempotent):
//   * Email is trimmed and lower-cased. An account is looked up by that email.
//   * New account  -> created with role 'admin', a bcrypt hash of the env password, must_change_password = true.
//   * Existing account -> role set to 'admin' if it was not. The password is NOT touched (so a password the admin
//     has changed since is never overwritten) unless --reset-password is passed, which also sets must_change_password.
//   * Everything happens in one transaction: all admins are seeded, or none.
//   * Admins are provisioned by an operator, not by the signup OTP, so email_verification is stored as 'email'
//     (the sign-in policy refuses 'none'; the operator vouches for the address by supplying it).
//
// Usage (needs migration 004 applied first):
//   Local:       npm run seed:admins -- --expect-db robovalley_dev            (dry run)
//                npm run seed:admins -- --expect-db robovalley_dev --apply
//   Production:  set DATABASE_URL and the ADMINn_* variables in the host's environment (never in the repo), then
//                npm run seed:admins -- --expect-db <production database name> --apply
//   Option:      --reset-password   also replace the password of EXISTING admins (they must change it at next sign-in)

import bcrypt from "bcryptjs";
import { pathToFileURL } from "node:url";

const BCRYPT_ROUNDS = 12; // same cost as src/lib/signup.ts
const MIN_PASSWORD = 8;
const MAX_PASSWORD_BYTES = 72; // bcrypt only reads the first 72 bytes
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Admin entries from the environment. Throws a clear error that names variables, never values. */
export function readAdminsFromEnv(env = process.env) {
  const admins = [];
  for (let n = 1; n <= 9; n++) {
    const eName = `ADMIN${n}_EMAIL`, pName = `ADMIN${n}_PASSWORD`;
    const e = env[eName], p = env[pName];
    if (!e && !p) continue;
    if (!e || !p) throw new Error(`${!e ? eName : pName} is missing (${eName} and ${pName} must be set together).`);
    const email = e.trim().toLowerCase();
    if (email.length > 254 || !EMAIL_RE.test(email)) throw new Error(`${eName} is not a valid email address.`);
    if (p.length < MIN_PASSWORD) throw new Error(`${pName} must have at least ${MIN_PASSWORD} characters.`);
    if (new TextEncoder().encode(p).length > MAX_PASSWORD_BYTES) throw new Error(`${pName} is too long (max ${MAX_PASSWORD_BYTES} bytes).`);
    if (admins.some((a) => a.email === email)) throw new Error(`${eName} repeats another admin's email.`);
    admins.push({ email, password: p, vars: [eName, pName] });
  }
  if (!admins.length) throw new Error("No admin variables are set. Set ADMIN1_EMAIL and ADMIN1_PASSWORD (and optionally ADMIN2_EMAIL / ADMIN2_PASSWORD).");
  return admins;
}

/**
 * Seeds the admins into `db` (anything with query(text, params)), inside one transaction.
 * @returns {Promise<Array<{ email: string, action: "created" | "promoted" | "password-reset" | "unchanged" }>>}
 */
export async function seedAdmins({ db, env = process.env, resetPassword = false }) {
  const admins = readAdminsFromEnv(env);
  const results = [];
  await db.query("BEGIN");
  try {
    for (const a of admins) {
      let row = (await db.query("SELECT id, role FROM users WHERE lower(email) = $1", [a.email])).rows[0];
      if (!row) {
        const hash = await bcrypt.hash(a.password, BCRYPT_ROUNDS);
        const ins = await db.query(
          `INSERT INTO users (full_name, email, role, password_hash, email_verification, must_change_password)
           VALUES ('Administrator', $1, 'admin', $2, 'email', true)
           ON CONFLICT DO NOTHING RETURNING id`,
          [a.email, hash]
        );
        if (ins.rows.length) { results.push({ email: a.email, action: "created" }); continue; }
        row = (await db.query("SELECT id, role FROM users WHERE lower(email) = $1", [a.email])).rows[0]; // created by a parallel run
        if (!row) throw new Error("Could not create or find the account.");
      }
      let action = "unchanged";
      if (row.role !== "admin") {
        await db.query("UPDATE users SET role = 'admin' WHERE id = $1", [row.id]);
        action = "promoted";
      }
      if (resetPassword) {
        const hash = await bcrypt.hash(a.password, BCRYPT_ROUNDS);
        await db.query("UPDATE users SET password_hash = $2, must_change_password = true WHERE id = $1", [row.id, hash]);
        action = "password-reset";
      }
      results.push({ email: a.email, action });
    }
    await db.query("COMMIT");
  } catch (err) {
    try { await db.query("ROLLBACK"); } catch { /* nothing to roll back */ }
    throw err;
  }
  return results;
}

function parseArgs(argv) {
  const a = { apply: false, expectDb: undefined, resetPassword: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--apply") a.apply = true;
    else if (t === "--expect-db") a.expectDb = argv[++i];
    else if (t === "--reset-password") a.resetPassword = true;
    else throw new Error(`Unknown option: ${t}`);
  }
  return a;
}

function dbNameFromUrl(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, "")) || null;
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  const fail = (msg) => { console.error("\n✖ " + msg + "\nNothing was changed."); process.exit(1); };

  if (!args.expectDb) fail("Missing --expect-db <database name>. Type the name of the database you intend to change, e.g. --expect-db robovalley_dev");
  if (!url) fail("DATABASE_URL is not set.");
  const urlDb = dbNameFromUrl(url);
  if (!urlDb) fail("Could not read a database name from DATABASE_URL.");
  const isLocal = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(new URL(url).hostname);

  let admins;
  try { admins = readAdminsFromEnv(); } catch (e) { fail(e.message); }

  console.log("Target database name :", urlDb);
  console.log("Server location      :", isLocal ? "this computer (loopback)" : "remote server");
  console.log("You confirmed        :", args.expectDb);
  console.log("Admins to seed       :", admins.map((a) => a.email).join(", "));
  console.log("Reset passwords      :", args.resetPassword ? "yes (existing admins too)" : "no (only new accounts get a password)");
  if (urlDb !== args.expectDb) fail(`DATABASE_URL points to database "${urlDb}" but you confirmed "${args.expectDb}".`);
  if (!args.apply) {
    console.log("\nDRY RUN: nothing was connected or changed. Add --apply to seed these admins.");
    return;
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query("select current_database() as d");
    if (rows[0].d !== args.expectDb) fail(`Connected to database "${rows[0].d}" but you confirmed "${args.expectDb}".`);
    const col = await client.query("select 1 from information_schema.columns where table_name = 'users' and column_name = 'must_change_password'");
    if (!col.rows.length) fail("users.must_change_password does not exist. Apply migration 004 first (scripts/migrate.mjs --only 004).");
    const results = await seedAdmins({ db: client, resetPassword: args.resetPassword });
    for (const r of results) console.log(`  ${r.action.padEnd(14)} ${r.email}`);
    console.log("\nDone.");
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("\n✖ " + (e && e.message ? String(e.message).split("\n")[0] : "Unexpected error") + "\nNothing further was changed."); process.exit(1); });
}
