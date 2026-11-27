#!/usr/bin/env node
// Every migration TWICE on a FRESH database (rvcw_mig, in the throw-away Postgres container of rig.mjs; nothing else is touched):
//   1. a new empty database, the base schema, then every migration in db/migrations (first run: each must run without an error)
//   2. real rows for the newest tables (a published idea, a declined one, an unpublished one, a demo-flagged one, versions, history,
//      feedback and a public card), so the second run meets data, not empty tables
//   3. snapshot: row count and content hash of every table, every sequence, and the whole schema (columns, constraints, indexes,
//      triggers, functions, views)
//   4. a normal rerun: every migration must be skipped as already applied
//   5. a forced rerun: each migration really executed again (--only NNN --force --apply), none may fail
//   6. --status: every migration applied
//   7. snapshot again: the rows and content of every table and the whole schema must be identical (a sequence that only moved
//      forward with no row added is listed as a note). Then the database is dropped (keep it with --keep).
//   node tools/contribution-e2e/migrations-twice.mjs [--keep]
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { C, ROOT, STATE, assertLocal, baseEnv, databaseUrl } from "./lib/config.mjs";
import { running, sql, sqlFile } from "./lib/docker.mjs";

const DB = C.pg.migDb, keep = process.argv.includes("--keep");
const outDir = join(STATE, "migrations-twice"); mkdirSync(outDir, { recursive: true });
let failed = 0;
const say = (ok, line) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${line}`); };
if (!running(C.pg.container)) { console.error("Start the Postgres container first: node tools/contribution-e2e/rig.mjs pg-up"); process.exit(1); }
const url = databaseUrl(DB);
assertLocal(url);
const migrate = (args) => spawnSync(process.execPath, ["scripts/migrate.mjs", "--expect-db", DB, ...args], { cwd: ROOT, env: { ...baseEnv(), DATABASE_URL: url }, encoding: "utf8" });
const ids = readdirSync(join(ROOT, "db", "migrations")).filter((f) => /^\d{3}_.+\.sql$/.test(f)).map((f) => f.slice(0, 3)).sort();

const SNAP_DATA = `
SELECT c.relname || ' rows=' ||
       (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text || ' md5=' ||
       (xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(t::text, ''|'' order by t::text), '''')) as h from public.%I t', c.relname), false, true, '')))[1]::text AS line
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r', 'p') AND n.nspname = 'public'
UNION ALL SELECT 'seq ' || sequencename || ' last=' || coalesce(last_value::text, 'unused') FROM pg_sequences WHERE schemaname = 'public'
ORDER BY 1`;
const SNAP_SCHEMA = `
SELECT * FROM (
  SELECT 'col ' || table_name || '.' || column_name || ' ' || data_type || ' default=' || coalesce(column_default, '-') || ' null=' || is_nullable FROM information_schema.columns WHERE table_schema = 'public'
  UNION ALL SELECT 'con ' || conrelid::regclass::text || '.' || conname || ' ' || pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace = 'public'::regnamespace
  UNION ALL SELECT 'idx ' || indexname || ' ' || indexdef FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL SELECT 'trg ' || tgrelid::regclass::text || '.' || tgname || ' ' || pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal
  UNION ALL SELECT 'fn ' || p.proname || ' ' || md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE pronamespace = 'public'::regnamespace AND p.prokind = 'f'
  UNION ALL SELECT 'view ' || viewname || ' ' || md5(definition) FROM pg_views WHERE schemaname = 'public'
) x(line) ORDER BY 1`;
async function snapshot(label) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const data = (await client.query(SNAP_DATA)).rows.map((r) => r.line), schema = (await client.query(SNAP_SCHEMA)).rows.map((r) => r.line);
    writeFileSync(join(outDir, `${label}-data.txt`), data.join("\n")); writeFileSync(join(outDir, `${label}-schema.txt`), schema.join("\n"));
    return { data, schema };
  } finally { await client.end(); }
}

try {
  // 1. fresh database, base schema, first run
  sql(`DROP DATABASE IF EXISTS ${DB}`);
  sql(`CREATE DATABASE ${DB} OWNER ${C.pg.db}`);
  sqlFile(readFileSync(join(ROOT, "db", "base_schema_local.sql"), "utf8").replaceAll("robovalley_dev", DB), DB);
  const first = migrate(["--apply"]);
  writeFileSync(join(outDir, "first-run.log"), first.stdout + first.stderr);
  const ran = (first.stdout.match(/^Applying \S+ \.\.\. done$/gm) || []).length;
  say(first.status === 0 && ran === ids.length, `first run on a fresh database: ${ran} of ${ids.length} migrations applied without an error`);

  // 2. real rows in the newest tables
  sqlFile(`
INSERT INTO users (full_name, email, role, password_hash) VALUES ('Meera Kumar', 'mig-member@example.com', 'PA', 'x');
INSERT INTO cw_contributions (user_id, contributor_name, contributor_type, kind, original, proposed, status, published_version, published_at, previewed_version)
SELECT id, 'Meera Kumar', 'PA', 'New idea', '{"title":"Solar weeder"}', '{"title":"Solar weeder"}', 'published', 1, now(), 1 FROM users WHERE email = 'mig-member@example.com';
INSERT INTO cw_contribution_versions (contribution_id, v, role, by_name, data, notes) SELECT max(id), 1, 'Moderator', 'Moderator One', '{"title":"Solar weeder"}', '' FROM cw_contributions;
INSERT INTO cw_contribution_history (contribution_id, actor, text) SELECT max(id), 'System', 'Published.' FROM cw_contributions;
INSERT INTO cw_public_contributions (contribution_id, version, title, description, sector_slug, sector_name, robot_type_name, kind, contributor_first_name, contributor_type, published_at)
SELECT max(id), 1, 'Solar weeder', 'A small solar powered weeding robot.', 'agriculture-dairy', 'Agriculture & Dairy', 'Not sure', 'New idea', 'Meera', 'Parent', now() FROM cw_contributions;
INSERT INTO cw_contributions (user_id, contributor_name, contributor_type, kind, original, proposed, status)
SELECT id, 'Meera Kumar', 'PA', 'New idea', '{"title":"Egg counter"}', '{"title":"Egg counter"}', 'rejected' FROM users WHERE email = 'mig-member@example.com';
INSERT INTO cw_contribution_feedback (contribution_id, type, text, by_name) SELECT max(id), 'decline', 'Already covered.', 'Moderator One' FROM cw_contributions;
INSERT INTO cw_contributions (user_id, contributor_name, contributor_type, kind, original, proposed, status, published_version, published_at)
SELECT id, 'Meera Kumar', 'PA', 'New idea', '{"title":"Seed drone"}', '{"title":"Seed drone"}', 'unpublished', 1, now() - interval '1 day' FROM users WHERE email = 'mig-member@example.com';
INSERT INTO cw_contributions (user_id, contributor_name, contributor_type, kind, original, proposed, is_demo)
SELECT id, 'Meera Kumar', 'PA', 'New idea', '{"title":"Demo idea"}', '{"title":"Demo idea"}', true FROM users WHERE email = 'mig-member@example.com';
`, DB);
  say(true, `rows added before the second run: ${sql("SELECT (SELECT count(*) FROM cw_contributions) || ' ideas (published, rejected by a decline, unpublished, demo), ' || (SELECT count(*) FROM cw_public_contributions) || ' public card'", DB)}`);

  // 3. snapshot
  const before = await snapshot("before");

  // 4. a normal rerun skips everything
  const again = migrate(["--apply"]);
  writeFileSync(join(outDir, "rerun-normal.log"), again.stdout + again.stderr);
  const skipped = (again.stdout.match(/^Skipping /gm) || []).length, executed = (again.stdout.match(/^Applying /gm) || []).length;
  say(again.status === 0 && skipped === ids.length && executed === 0, `normal rerun: ${skipped} of ${ids.length} skipped as already applied, ${executed} executed`);

  // 5. a forced rerun executes each one again
  const bad = [];
  for (const id of ids) {
    const r = migrate(["--only", id, "--force", "--apply"]);
    writeFileSync(join(outDir, `force-${id}.log`), r.stdout + r.stderr);
    if (r.status !== 0 || !/ \.\.\. done$/m.test(r.stdout)) bad.push(`${id}: ${(r.stdout + r.stderr).trim().split("\n").slice(-2).join(" ").slice(0, 300)}`);
  }
  say(bad.length === 0, `forced rerun: ${ids.length - bad.length} of ${ids.length} executed again without an error${bad.length ? "\n  " + bad.join("\n  ") : ""}`);

  // 6. status
  const st = migrate(["--status"]);
  writeFileSync(join(outDir, "status.log"), st.stdout + st.stderr);
  const applied = (st.stdout.match(/^ {2}\d{3} {2}applied /gm) || []).length;
  say(st.status === 0 && applied === ids.length && /Everything is applied\./.test(st.stdout), `--status: ${applied} of ${ids.length} applied`);

  // 7. nothing changed: every table's rows and content and the whole schema identical. A sequence may only move FORWARD with no row
  //    added (an INSERT ... ON CONFLICT DO NOTHING run again uses up an id, e.g. 016's default sector); that is listed, not a failure.
  const after = await snapshot("after");
  const diff = (a, b) => [...a.filter((x) => !b.includes(x)).map((x) => "- " + x), ...b.filter((x) => !a.includes(x)).map((x) => "+ " + x)];
  const isSeq = (l) => l.startsWith("seq ");
  const d = [...diff(before.data.filter((l) => !isSeq(l)), after.data.filter((l) => !isSeq(l))), ...diff(before.schema, after.schema)];
  const seqOf = (lines) => Object.fromEntries(lines.filter(isSeq).map((l) => { const m = l.match(/^seq (\S+) last=(\S+)$/); return [m[1], m[2]]; }));
  const s0 = seqOf(before.data), s1 = seqOf(after.data), moved = [];
  for (const name of new Set([...Object.keys(s0), ...Object.keys(s1)])) {
    if (s0[name] === s1[name]) continue;
    const a0 = s0[name] === "unused" ? 0 : Number(s0[name]), a1 = s1[name] === "unused" ? 0 : Number(s1[name]);
    if (name in s0 && name in s1 && Number.isFinite(a0) && Number.isFinite(a1) && a1 > a0) moved.push(`${name} ${s0[name]} -> ${s1[name]}`);
    else d.push(`sequence ${name}: ${s0[name] ?? "(absent)"} -> ${s1[name] ?? "(absent)"}`);
  }
  const tables = before.data.filter((l) => !isSeq(l)).length;
  say(d.length === 0, d.length === 0
    ? `identical after the second run: ${tables} tables (rows and content) and ${before.schema.length} schema objects`
    : `DIFFERENCES after the second run:\n  ${d.slice(0, 30).join("\n  ")}`);
  if (moved.length) console.log(`note: sequences that moved forward with no row added (a forced rerun of an INSERT ... ON CONFLICT DO NOTHING uses up an id): ${moved.join(", ")}`);
} catch (e) {
  say(false, `crashed: ${String((e && e.message) || e).slice(0, 600)}`);
} finally {
  if (!keep) { try { sql(`DROP DATABASE IF EXISTS ${DB}`); } catch { /* left for inspection */ } }
  console.log(`migrations twice: ${failed ? `${failed} FAILED` : "all passed"} (logs and snapshots in tools/contribution-e2e/.state/migrations-twice/)`);
  process.exitCode = failed ? 1 : 0;
}
