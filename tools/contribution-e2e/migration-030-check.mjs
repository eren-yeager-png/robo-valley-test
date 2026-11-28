#!/usr/bin/env node
// Migration 030 (the Contribution Portal's data) on a COPY OF EXISTING DATA, in the throw-away Postgres container of rig.mjs only:
//   1. rvcw_copy = a copy of the e2e database (rvcw_e2e: 001-029 and the made-up people, ideas and current-form items of the e2e runs),
//      made with pg_dump | psql; nothing else is touched (the copy is dropped at the end; keep it with --keep)
//   2. before: row counts, and a content hash of every column earlier migrations made (sectors, sector_robot_types, cw_contributions:
//      only their pre-030 columns; every other table: whole rows), the schema, and --status (030 missing)
//   3. the runner: a dry run, then --only 030 --apply; after: the same hashes must be unchanged, 030 applied, the backfill counted
//   4. a second, FORCED run (--only 030 --force --apply): every row of every table and the whole schema must be identical
//   5. the rollback (db/rollback/030_down.sql): the schema and every pre-030 hash are back to step 2, 030 missing; then re-applied:
//      identical to step 3 again
//   6. the server's log: no ERROR line during the whole run
// It writes out/migration-030/report.json, report.md and report.html (the PR's schema and row-count pictures are taken from the
// HTML with --shots <folder>). The empty-database case (every migration twice on a fresh database) is migrations-twice.mjs.
//   node tools/contribution-e2e/migration-030-check.mjs [--keep] [--shots docs/pr-screenshots]
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { C, OUT, ROOT, assertLocal, baseEnv, databaseUrl } from "./lib/config.mjs";
import { run, running, sql } from "./lib/docker.mjs";

const COPY = "rvcw_copy", SOURCE = C.pg.db, keep = process.argv.includes("--keep");
const shotsAt = process.argv.indexOf("--shots") >= 0 ? process.argv[process.argv.indexOf("--shots") + 1] : "";
const outDir = join(OUT, "migration-030"); mkdirSync(outDir, { recursive: true });
if (!running(C.pg.container)) { console.error("Start the Postgres container first: node tools/contribution-e2e/rig.mjs pg-up"); process.exit(1); }
const url = databaseUrl(COPY);
assertLocal(url);
if (COPY === SOURCE) throw new Error("ABORT: the copy must not be the e2e database itself");
const checks = [];
const say = (ok, line) => { checks.push({ ok, line }); console.log(`${ok ? "PASS" : "FAIL"} ${line}`); };
const migrate = (args) => spawnSync(process.execPath, ["scripts/migrate.mjs", "--expect-db", COPY, ...args], { cwd: ROOT, env: { ...baseEnv(), DATABASE_URL: url }, encoding: "utf8" });
const started = new Date(Date.now() - 2000).toISOString();

// the columns each altered table had before 030 (the hash of these must never change)
const PRE030 = {
  sectors: "id, slug, name, sort_order, is_active, is_demo, created_at",
  sector_robot_types: "id, sector_id, slug, name, sort_order, is_active, created_at, updated_at, updated_by",
  cw_contributions: "id, user_id, contributor_name, contributor_type, contributor_minor, kind, resource, reference_links, original, proposed, notes, status, moderator_id, moderator_name, previewed_version, published_version, published_at, publish_error, publish_attempts, row_version, submitted_at, updated_at, is_demo",
};
const NEW_TABLES = ["field_suggestions", "plugins", "plugin_fields", "moderator_sectors", "audit_log"];
const COUNTED = ["users", "sectors", "sector_robot_types", "contributions", "contribution_scopes", "contribution_reviews", "cw_contributions", "cw_contribution_versions", "cw_contribution_history", "cw_contribution_feedback", "cw_public_contributions", ...NEW_TABLES];
const SNAP_SCHEMA = `
SELECT * FROM (
  SELECT 'col ' || table_name || '.' || column_name || ' ' || data_type || ' default=' || coalesce(column_default, '-') || ' null=' || is_nullable FROM information_schema.columns WHERE table_schema = 'public'
  UNION ALL SELECT 'con ' || conrelid::regclass::text || '.' || conname || ' ' || pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace = 'public'::regnamespace
  UNION ALL SELECT 'idx ' || indexname || ' ' || indexdef FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL SELECT 'trg ' || tgrelid::regclass::text || '.' || tgname || ' ' || pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal
  UNION ALL SELECT 'fn ' || p.proname || ' ' || md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE pronamespace = 'public'::regnamespace AND p.prokind = 'f'
) x(line) ORDER BY 1`;

async function withDb(fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const tableExists = async (c, t) => (await c.query("SELECT to_regclass($1) IS NOT NULL AS ok", [t])).rows[0].ok === true;
/** Row counts, the pre-030 hashes, every table's full-row hash, and the schema. */
async function snapshot(label) {
  return withDb(async (c) => {
    const counts = {}, pre = {}, full = {};
    for (const t of COUNTED) counts[t] = (await tableExists(c, t)) ? Number((await c.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n) : null;
    for (const [t, cols] of Object.entries(PRE030)) pre[t] = (await c.query(`SELECT md5(coalesce(string_agg(r::text, '|' ORDER BY r::text), '')) AS h FROM (SELECT ${cols} FROM ${t}) r`)).rows[0].h;
    const tables = (await c.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname = 'public' ORDER BY 1")).rows.map((r) => r.relname);
    for (const t of tables) full[t] = (await c.query(`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM public.${t} t`)).rows[0].h;
    const schema = (await c.query(SNAP_SCHEMA)).rows.map((r) => r.line);
    writeFileSync(join(outDir, `${label}-schema.txt`), schema.join("\n"));
    return { label, counts, pre, full, schema };
  });
}
/** What the backfill wrote (after 030). */
const backfill = () => withDb(async (c) => ({
  fieldStatus: (await c.query("SELECT status, count(*)::int AS n FROM sector_robot_types GROUP BY 1 ORDER BY 1")).rows,
  fieldSource: (await c.query("SELECT source, count(*)::int AS n FROM sector_robot_types GROUP BY 1 ORDER BY 1")).rows,
  suggestions: (await c.query("SELECT status, count(*)::int AS n FROM field_suggestions GROUP BY 1 ORDER BY 1")).rows,
  audit: (await c.query("SELECT action, target_type, count(*)::int AS n FROM audit_log GROUP BY 1, 2 ORDER BY 1, 2")).rows,
  ideas: (await c.query(`SELECT count(*) FILTER (WHERE field_id IS NOT NULL)::int AS with_field, count(*) FILTER (WHERE approved_by IS NOT NULL)::int AS approved_by,
    count(*) FILTER (WHERE publish_requested_at IS NOT NULL)::int AS requested, count(*) FILTER (WHERE published_by IS NOT NULL)::int AS published_by,
    count(*) FILTER (WHERE reject_reason IS NOT NULL)::int AS reject_reason, count(*) FILTER (WHERE edited_by IS NOT NULL)::int AS edited_by, count(*)::int AS ideas FROM cw_contributions`)).rows[0],
}));
const statusOf = () => { const r = migrate(["--status"]); const line = (r.stdout.match(/^\s+030\s+(\S+)/m) || [])[1] || "?"; return { ok: r.status === 0, s030: line, text: r.stdout }; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// A CHECK constraint is compared by its meaning: pg_dump | psql (how the copy is made) stores the same IN-list in another written form
// (ARRAY[('x'::character varying)::text, ...] instead of (ARRAY['x'::character varying, ...])::text[]); the allowed values are what count.
const meaning = (lines) => lines.map((l) => (l.startsWith("con ") && l.includes(" CHECK ") ? l.replace(/::character varying|::text\[\]|::text/g, "").replace(/[()\s]/g, "") : l));
const sameSchema = (a, b) => same(meaning(a), meaning(b));
const diff = (a, b) => [...a.filter((x) => !b.includes(x)).map((x) => `- ${x}`), ...b.filter((x) => !a.includes(x)).map((x) => `+ ${x}`)];

const report = { when: new Date().toISOString(), source: `${SOURCE} (the throw-away e2e database on 127.0.0.1:${C.pg.port})`, copy: COPY, steps: {} };
try {
  // 1. the copy
  sql(`DROP DATABASE IF EXISTS ${COPY}`);
  sql(`CREATE DATABASE ${COPY} OWNER ${C.pg.db}`);
  run("docker", ["exec", C.pg.container, "sh", "-c", `pg_dump -U ${C.pg.db} --no-owner ${SOURCE} | psql -q -v ON_ERROR_STOP=1 -U ${C.pg.db} ${COPY}`]);
  say(true, `copy made: ${COPY} from ${SOURCE} (pg_dump | psql)`);

  // 2. before
  const st0 = statusOf();
  say(st0.ok && st0.s030 === "MISSING", `before: --status says 030 ${st0.s030}`);
  const before = await snapshot("before");
  report.steps.before = before.counts;

  // 3. the dry run, then the real run
  const dry = migrate(["--only", "030"]);
  say(dry.status === 0 && /DRY RUN/i.test(dry.stdout + dry.stderr), "dry run: nothing changed");
  const first = migrate(["--only", "030", "--apply"]);
  writeFileSync(join(outDir, "first-run.log"), first.stdout + first.stderr);
  say(first.status === 0 && /030_contribution_portal\.sql/.test(first.stdout), "first run: 030 applied without an error");
  const st1 = statusOf();
  say(st1.s030 === "applied", `after: --status says 030 ${st1.s030}`);
  const after1 = await snapshot("after-first");
  report.steps.afterFirst = after1.counts;
  for (const t of Object.keys(PRE030)) say(after1.pre[t] === before.pre[t], `${t}: every value earlier migrations store is unchanged (hash of its pre-030 columns)`);
  const untouched = Object.keys(before.full).filter((t) => !Object.keys(PRE030).includes(t));
  const changed = untouched.filter((t) => after1.full[t] !== before.full[t]);
  say(changed.length === 0, `every other existing table is byte-identical (${untouched.length} tables)${changed.length ? `; changed: ${changed.join(", ")}` : ""}`);
  for (const t of COUNTED.filter((x) => !NEW_TABLES.includes(x))) say(after1.counts[t] === before.counts[t], `${t}: ${before.counts[t]} rows before, ${after1.counts[t]} after`);
  report.backfill = await backfill();
  report.schemaAdded = diff(before.schema, after1.schema);

  // 4. a second, forced run
  const second = migrate(["--only", "030", "--force", "--apply"]);
  writeFileSync(join(outDir, "second-run.log"), second.stdout + second.stderr);
  say(second.status === 0, "second (forced) run: 030 executed again without an error");
  const after2 = await snapshot("after-second");
  report.steps.afterSecond = after2.counts;
  const moved = Object.keys(after1.full).filter((t) => after2.full[t] !== after1.full[t]);
  say(moved.length === 0, `second run: every row of every table is identical${moved.length ? `; changed: ${moved.join(", ")}` : ""}`);
  say(same(after1.schema, after2.schema), "second run: the schema is identical");

  // 5. the rollback, then again
  const down = migrate(["--file", "db/rollback/030_down.sql", "--apply"]);
  writeFileSync(join(outDir, "rollback.log"), down.stdout + down.stderr);
  say(down.status === 0, "rollback: db/rollback/030_down.sql ran without an error");
  const st2 = statusOf();
  say(st2.s030 === "MISSING", `after the rollback: --status says 030 ${st2.s030}`);
  const rolled = await snapshot("after-rollback");
  report.steps.afterRollback = rolled.counts;
  say(sameSchema(rolled.schema, before.schema), "after the rollback: the schema is the one before 030 (every table, column, constraint, index, trigger and function)");
  for (const t of Object.keys(PRE030)) say(rolled.pre[t] === before.pre[t], `after the rollback: ${t} values unchanged`);
  const back = migrate(["--only", "030", "--apply"]);
  writeFileSync(join(outDir, "reapply.log"), back.stdout + back.stderr);
  say(back.status === 0 && statusOf().s030 === "applied", "re-applied after the rollback: 030 applied without an error");
  const again = await snapshot("after-reapply");
  report.steps.afterReapply = again.counts;
  const differ = Object.keys(after1.full).filter((t) => again.full[t] !== after1.full[t]);
  say(differ.length === 0 && same(again.schema, after1.schema), `re-applied: every table and the schema equal the first run${differ.length ? `; different: ${differ.join(", ")}` : ""}`);

  // 6. the server's log
  const logs = spawnSync("docker", ["logs", "--since", started, C.pg.container], { encoding: "utf8" });
  const errors = ((logs.stdout || "") + (logs.stderr || "")).split("\n").filter((l) => /\bERROR:/.test(l));
  writeFileSync(join(outDir, "server-errors.log"), errors.join("\n"));
  say(errors.length === 0, `the Postgres server logged ${errors.length} ERROR line(s) during the run`);
  report.serverErrors = errors.length;
} finally {
  if (!keep) { try { sql(`DROP DATABASE IF EXISTS ${COPY}`); } catch { /* left for a look */ } }
}

report.checks = checks;
report.passed = checks.filter((c) => c.ok).length;
report.failed = checks.filter((c) => !c.ok).length;
writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));

// the report as text and as a page (for the PR's pictures)
const steps = [["before", "Before (001-029)"], ["afterFirst", "After 030"], ["afterSecond", "After a second run"], ["afterRollback", "After the rollback"], ["afterReapply", "Re-applied"]];
const cell = (v) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("en-IN"));
const rowsMd = COUNTED.map((t) => `| ${t}${NEW_TABLES.includes(t) ? " (new)" : ""} | ${steps.map(([k]) => cell(report.steps[k]?.[t])).join(" | ")} |`);
writeFileSync(join(outDir, "report.md"), [
  `# Migration 030 on a copy of existing data (${report.when})`, "", `Source: ${report.source}. ${report.passed} passed, ${report.failed} failed.`, "",
  `| Table | ${steps.map(([, l]) => l).join(" | ")} |`, `|---|${steps.map(() => "---:").join("|")}|`, ...rowsMd, "",
  "## Checks", ...checks.map((c) => `- ${c.ok ? "PASS" : "FAIL"} ${c.line}`), "", "## Backfill", "```", JSON.stringify(report.backfill, null, 2), "```", "",
  "## Schema added by 030", "```", ...(report.schemaAdded || []), "```", ""].join("\n"));
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const touched = ["sectors", "sector_robot_types", "cw_contributions", ...NEW_TABLES];
const colsOf = (lines, t) => lines.filter((l) => l.startsWith(`col ${t}.`)).map((l) => l.slice(`col ${t}.`.length).split(" ")[0]);
const readLines = (label) => { try { return readFileSync(join(outDir, `${label}-schema.txt`), "utf8").split("\n"); } catch { return []; } };
const schemaRows = (side) => touched.map((t) => {
  const b = colsOf(readLines("before"), t), a = colsOf(readLines("after-first"), t);
  const list = side === "before" ? b : a;
  return `<tr><th scope="row">${esc(t)}${b.length ? "" : side === "after" ? ' <span class="new">new table</span>' : ""}</th><td>${list.length ? list.map((c) => `<code class="${side === "after" && !b.includes(c) ? "add" : ""}">${esc(c)}</code>`).join(" ") : '<span class="none">(not there)</span>'}</td></tr>`;
}).join("");
const page =(title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font-family:system-ui,"Segoe UI",Arial,sans-serif;margin:24px;color:#1f2937;background:#fff}h1{font-size:22px;margin:0 0 4px}p{margin:0 0 16px;color:#4b5563;font-size:14px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #e5e9e7;padding:6px 8px;text-align:left;vertical-align:top}thead th{background:#f3f6f4}
td.n{text-align:right;font-variant-numeric:tabular-nums}code{display:inline-block;margin:2px;padding:1px 6px;border-radius:6px;background:#f1f5f9;font-size:12px}
code.add{background:#dcfce7;color:#166534;font-weight:700}.new{color:#166534;font-weight:700;font-size:12px}.none{color:#9ca3af}.ok{color:#166534}.bad{color:#991b1b}li{font-size:13px;margin:2px 0}
</style></head><body>${body}</body></html>`;
writeFileSync(join(outDir, "schema-before.html"), page("Schema before 030", `<h1>Schema before migration 030</h1><p>The tables 030 changes or adds, on the copy of the e2e database (001-029).</p><table><thead><tr><th>Table</th><th>Columns</th></tr></thead><tbody>${schemaRows("before")}</tbody></table>`));
writeFileSync(join(outDir, "schema-after.html"), page("Schema after 030", `<h1>Schema after migration 030</h1><p>New columns and tables in green. Nothing was dropped or renamed.</p><table><thead><tr><th>Table</th><th>Columns</th></tr></thead><tbody>${schemaRows("after")}</tbody></table>`));
writeFileSync(join(outDir, "report.html"), page("Migration 030: row counts", `<h1>Migration 030 on a copy of existing data: row counts</h1><p>${esc(report.source)} · ${report.passed} checks passed, ${report.failed} failed · ${esc(report.when.slice(0, 16).replace("T", " "))} UTC</p>
<table><thead><tr><th>Table</th>${steps.map(([, l]) => `<th>${esc(l)}</th>`).join("")}</tr></thead><tbody>${COUNTED.map((t) => `<tr><th scope="row">${esc(t)}${NEW_TABLES.includes(t) ? ' <span class="new">new</span>' : ""}</th>${steps.map(([k]) => `<td class="n">${cell(report.steps[k]?.[t])}</td>`).join("")}</tr>`).join("")}</tbody></table>
<h2 style="font-size:16px">Checks</h2><ul>${checks.map((c) => `<li class="${c.ok ? "ok" : "bad"}">${c.ok ? "PASS" : "FAIL"} ${esc(c.line)}</li>`).join("")}</ul>`));
console.log(`\n${report.passed} passed, ${report.failed} failed. Report: ${join(outDir, "report.md")}`);

if (shotsAt) {
  const { startBrowser } = await import("./lib/browser.mjs");
  const b = await startBrowser({});
  try {
    await b.viewport(1440, 900);
    for (const [file, name] of [["schema-before.html", "B-admin-schema-1440-before.png"], ["schema-after.html", "B-admin-schema-1440-after.png"], ["report.html", "B-admin-row-counts-1440-after.png"]]) {
      await b.go(pathToFileURL(join(outDir, file)).href);
      await b.shot(join(resolve(ROOT, shotsAt), name), { full: true });
      console.log(`picture: ${join(shotsAt, name)}`);
    }
  } finally { b.close(); }
}
process.exit(report.failed ? 1 : 0);
