#!/usr/bin/env node
// RoboValley single-administrator seeding. Makes exactly ONE account the administrator and demotes every other admin.
//
// Credentials come ONLY from environment variables (never from files in the repo, never printed):
//   ADMIN_EMAIL / ADMIN_PASSWORD
//   If ADMIN_EMAIL is not set, the pair ADMIN1..ADMIN9_EMAIL / _PASSWORD whose email is ai@symbiosystech.com is used.
//
// SAFETY MODEL (same as scripts/migrate.mjs and seed-admins.mjs, fails closed):
//   * --expect-db <name> is REQUIRED and must equal the database name in DATABASE_URL, and again equal current_database().
//   * Without --apply it is a DRY RUN: it prints the target and the admin email, connects to nothing, changes nothing.
//   * It never prints passwords, hashes, full URLs or host names.
//
// Behaviour (idempotent, one transaction):
//   * The account with ADMIN_EMAIL is created (role 'admin', bcrypt hash of ADMIN_PASSWORD) or, if it exists, promoted to 'admin'.
//     An existing account's password is only replaced with --reset-password.
//   * Every OTHER account that currently has role 'admin' is demoted to role 'user'. Accounts with any other role
//     (students, teachers ...) are left exactly as they are: their role holds their sign-up profile.
//
// Usage:
//   npm run seed:admin -- --expect-db robovalley_dev            (dry run)
//   npm run seed:admin -- --expect-db robovalley_dev --apply

import bcrypt from "bcryptjs";
import { pathToFileURL } from "node:url";

const BCRYPT_ROUNDS = 12; // same cost as src/lib/signup.ts
const MIN_PASSWORD = 8;
const MAX_PASSWORD_BYTES = 72; // bcrypt only reads the first 72 bytes
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const DEFAULT_ADMIN_EMAIL = "ai@symbiosystech.com";

/** { email, password, vars } from the environment. Errors name variables, never values. */
export function readAdminFromEnv(env = process.env) {
  let eName = "ADMIN_EMAIL", pName = "ADMIN_PASSWORD";
  if (!env.ADMIN_EMAIL && !env.ADMIN_PASSWORD) {
    let found = false;
    for (let n = 1; n <= 9 && !found; n++) {
      if ((env[`ADMIN${n}_EMAIL`] ?? "").trim().toLowerCase() === DEFAULT_ADMIN_EMAIL) { eName = `ADMIN${n}_EMAIL`; pName = `ADMIN${n}_PASSWORD`; found = true; }
    }
    if (!found) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD (no ADMINn_EMAIL pair with the default admin address was found either).");
  }
  const e = env[eName], p = env[pName];
  if (!e || !p) throw new Error(`${!e ? eName : pName} is missing (${eName} and ${pName} must be set together).`);
  const email = e.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new Error(`${eName} is not a valid email address.`);
  if (p.length < MIN_PASSWORD) throw new Error(`${pName} must have at least ${MIN_PASSWORD} characters.`);
  if (new TextEncoder().encode(p).length > MAX_PASSWORD_BYTES) throw new Error(`${pName} is too long (max ${MAX_PASSWORD_BYTES} bytes).`);
  return { email, password: p, vars: [eName, pName] };
}

/**
 * @param {{ db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }, env?: NodeJS.ProcessEnv, resetPassword?: boolean }} args
 * @returns {Promise<{ email: string, action: "created" | "promoted" | "password-reset" | "unchanged", demoted: number }>}
 */
export async function seedAdmin({ db, env = process.env, resetPassword = false }) {
  const admin = readAdminFromEnv(env);
  await db.query("BEGIN");
  try {
    let action = "unchanged";
    let row = (await db.query("SELECT id, role FROM users WHERE lower(email) = $1", [admin.email])).rows[0];
    if (!row) {
      const hash = await bcrypt.hash(admin.password, BCRYPT_ROUNDS);
      const ins = await db.query(
        `INSERT INTO users (full_name, email, role, password_hash, email_verification, must_change_password)
         VALUES ('Administrator', $1, 'admin', $2, 'email', false)
         ON CONFLICT DO NOTHING RETURNING id`,
        [admin.email, hash]
      );
      if (ins.rows.length) action = "created";
      else {
        row = (await db.query("SELECT id, role FROM users WHERE lower(email) = $1", [admin.email])).rows[0]; // created by a parallel run
        if (!row) throw new Error("Could not create or find the account.");
      }
    }
    if (row) {
      if (row.role !== "admin") {
        await db.query("UPDATE users SET role = 'admin' WHERE id = $1", [row.id]);
        action = "promoted";
      }
      if (resetPassword) {
        const hash = await bcrypt.hash(admin.password, BCRYPT_ROUNDS);
        await db.query("UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1", [row.id, hash]);
        action = "password-reset";
      }
    }
    const demoted = await db.query("UPDATE users SET role = 'user' WHERE role = 'admin' AND lower(email) <> $1 RETURNING id", [admin.email]);
    await db.query("COMMIT");
    return { email: admin.email, action, demoted: demoted.rows.length };
  } catch (err) {
    try { await db.query("ROLLBACK"); } catch { /* nothing to roll back */ }
    throw err;
  }
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

  let admin;
  try { admin = readAdminFromEnv(); } catch (e) { fail(e.message); }

  console.log("Target database name :", urlDb);
  console.log("Server location      :", isLocal ? "this computer (loopback)" : "remote server");
  console.log("You confirmed        :", args.expectDb);
  console.log("The only admin       :", admin.email, `(from ${admin.vars.join(" / ")})`);
  console.log("Other admins         : will be demoted to role 'user'");
  console.log("Reset password       :", args.resetPassword ? "yes" : "no (only a new account gets a password)");
  if (urlDb !== args.expectDb) fail(`DATABASE_URL points to database "${urlDb}" but you confirmed "${args.expectDb}".`);
  if (!args.apply) {
    console.log("\nDRY RUN: nothing was connected or changed. Add --apply to make this the only admin.");
    return;
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query("select current_database() as d");
    if (rows[0].d !== args.expectDb) fail(`Connected to database "${rows[0].d}" but you confirmed "${args.expectDb}".`);
    const r = await seedAdmin({ db: client, resetPassword: args.resetPassword });
    console.log(`\n${r.email}: ${r.action}. Other admins demoted: ${r.demoted}.`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("\n✖ " + (e && e.message ? String(e.message).split("\n")[0] : "Unexpected error") + "\nNothing further was changed."); process.exit(1); });
}
