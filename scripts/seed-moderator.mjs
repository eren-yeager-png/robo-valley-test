#!/usr/bin/env node
// RoboValley moderator seeding (item 4). Creates ONE moderator account in the database named by DATABASE_URL, or gives an existing
// member account the moderator flag.
//
// Credentials come ONLY from environment variables (never from files in the repo, never printed):
//   RV_MODERATOR_USER      the name shown for the account (e.g. "RoboValley Moderator"), 2 to 150 characters
//   RV_MODERATOR_EMAIL     the sign-in email
//   RV_MODERATOR_PASSWORD  a TEMPORARY password (8 to 72 bytes). The moderator must choose their own at the first sign-in.
//
// SAFETY MODEL (same as scripts/seed-admins.mjs and scripts/migrate.mjs, fails closed):
//   * --expect-db <name> is REQUIRED and must equal the database name in DATABASE_URL, and again equal current_database().
//   * Without --apply it is a DRY RUN: it prints the target and the email, connects to nothing, changes nothing.
//   * It never prints the password, the hash, the full URL or the host name.
//
// Behaviour (idempotent, one transaction):
//   * New email -> an account with role 'moderator' (not a member role, so it has no member dashboard and signup can never make one),
//     the moderator flag set, a bcrypt hash of the temporary password, must_change_password = true, email_verification 'email'
//     (the operator vouches for the address, as for administrators).
//   * Existing member account -> the moderator flag is set (their role and password are NOT touched), unless --reset-password is
//     passed, which also replaces the password with the temporary one and sets must_change_password.
//   * Existing administrator -> refused: an administrator already reviews everything; nothing is changed.
//   * The moderator flag change is recorded in moderator_audit by the database trigger of migration 015 (with no admin id: a manual step).
//
// Usage (needs migrations 004 and 015 applied):
//   Local:       npm run seed:moderator -- --expect-db robovalley_dev            (dry run)
//                npm run seed:moderator -- --expect-db robovalley_dev --apply
//   Production:  set DATABASE_URL and the three RV_MODERATOR_* variables in your own terminal (never in the repo), then
//                npm run seed:moderator -- --expect-db <production database name> --apply
//   Option:      --reset-password   also replace the password of an EXISTING account (they must change it at the next sign-in)

import bcrypt from "bcryptjs";
import { pathToFileURL } from "node:url";

const BCRYPT_ROUNDS = 12; // same cost as src/lib/signup.ts
const MIN_PASSWORD = 8;
const MAX_PASSWORD_BYTES = 72; // bcrypt only reads the first 72 bytes
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MODERATOR_ROLE = "moderator"; // the same value as src/lib/reviewerHome.ts

/** The moderator from the environment. Throws a clear error that names variables, never values. */
export function readModeratorFromEnv(env = process.env) {
  const name = (env.RV_MODERATOR_USER ?? "").replace(/\s+/g, " ").trim();
  const e = env.RV_MODERATOR_EMAIL, p = env.RV_MODERATOR_PASSWORD;
  const missing = [["RV_MODERATOR_USER", name], ["RV_MODERATOR_EMAIL", e], ["RV_MODERATOR_PASSWORD", p]].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set (all three RV_MODERATOR_* variables are needed).`);
  const control = [...name].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127);
  if (name.length < 2 || name.length > 150 || control || /[<>]/.test(name)) throw new Error("RV_MODERATOR_USER must be 2 to 150 characters, without < > or control characters.");
  const email = e.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new Error("RV_MODERATOR_EMAIL is not a valid email address.");
  if (p.length < MIN_PASSWORD) throw new Error(`RV_MODERATOR_PASSWORD must have at least ${MIN_PASSWORD} characters.`);
  if (new TextEncoder().encode(p).length > MAX_PASSWORD_BYTES) throw new Error(`RV_MODERATOR_PASSWORD is too long (max ${MAX_PASSWORD_BYTES} bytes).`);
  return { name, email, password: p };
}

/**
 * Seeds the moderator into `db` (anything with query(text, params)), inside one transaction.
 * @returns {Promise<{ email: string, action: "created" | "flagged" | "password-reset" | "unchanged" }>}
 */
export async function seedModerator({ db, env = process.env, resetPassword = false }) {
  const m = readModeratorFromEnv(env);
  await db.query("BEGIN");
  try {
    let row = (await db.query("SELECT id, role, is_moderator FROM users WHERE lower(email) = $1", [m.email])).rows[0];
    let action = "unchanged";
    if (!row) {
      const hash = await bcrypt.hash(m.password, BCRYPT_ROUNDS);
      const ins = await db.query(
        `INSERT INTO users (full_name, email, role, password_hash, email_verification, must_change_password, is_moderator)
         VALUES ($1, $2, $3, $4, 'email', true, true)
         ON CONFLICT DO NOTHING RETURNING id`,
        [m.name, m.email, MODERATOR_ROLE, hash]
      );
      if (ins.rows.length) { await db.query("COMMIT"); return { email: m.email, action: "created" }; }
      row = (await db.query("SELECT id, role, is_moderator FROM users WHERE lower(email) = $1", [m.email])).rows[0]; // made by a parallel run
      if (!row) throw new Error("Could not create or find the account.");
    }
    if (row.role === "admin") throw new Error("That email belongs to an administrator, who can already review everything. Nothing was changed.");
    if (row.is_moderator !== true) {
      await db.query("UPDATE users SET is_moderator = true WHERE id = $1", [row.id]);
      action = "flagged";
    }
    if (resetPassword) {
      const hash = await bcrypt.hash(m.password, BCRYPT_ROUNDS);
      await db.query("UPDATE users SET password_hash = $2, must_change_password = true WHERE id = $1", [row.id, hash]);
      action = "password-reset";
    }
    await db.query("COMMIT");
    return { email: m.email, action };
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

  let m;
  try { m = readModeratorFromEnv(); } catch (e) { fail(e.message); }

  console.log("Target database name :", urlDb);
  console.log("Server location      :", isLocal ? "this computer (loopback)" : "remote server");
  console.log("You confirmed        :", args.expectDb);
  console.log("Moderator email      :", m.email);
  console.log("Reset password       :", args.resetPassword ? "yes (also for an existing account)" : "no (only a new account gets the temporary password)");
  if (urlDb !== args.expectDb) fail(`DATABASE_URL points to database "${urlDb}" but you confirmed "${args.expectDb}".`);
  if (!args.apply) {
    console.log("\nDRY RUN: nothing was connected or changed. Add --apply to seed this moderator.");
    return;
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query("select current_database() as d");
    if (rows[0].d !== args.expectDb) fail(`Connected to database "${rows[0].d}" but you confirmed "${args.expectDb}".`);
    const cols = await client.query("select column_name from information_schema.columns where table_name = 'users' and column_name in ('must_change_password', 'is_moderator')");
    if (cols.rows.length < 2) fail("users.must_change_password or users.is_moderator does not exist. Apply migrations 004 and 015 first (scripts/migrate.mjs).");
    const r = await seedModerator({ db: client, resetPassword: args.resetPassword });
    console.log(`  ${r.action.padEnd(14)} ${r.email}`);
    console.log("\nDone. At the first sign-in the moderator lands on the Admin Portal and must choose their own password.");
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("\n✖ " + (e && e.message ? String(e.message).split("\n")[0] : "Unexpected error") + "\nNothing further was changed."); process.exit(1); });
}
