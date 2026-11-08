#!/usr/bin/env node
// Pre-loads EVERY Indian pin code from the GeoNames postal file into pincode_locations, so the Find a Service widget no longer needs the live
// Nominatim lookup for a pin code that no school uses yet. No schema change: the table (migration 006) already exists.
//
// Rules (conservative on purpose):
//   * a pin code that is NOT in the table yet                      -> inserted (source 'geonames', the same "first row per pin code" centre the earlier fill used)
//   * a row with source 'missing' that GeoNames can now resolve    -> filled in
//   * a row that already has coordinates (geonames or nominatim)   -> NEVER touched, even if GeoNames differs (the difference is only counted)
// Licence: GeoNames postal codes are CC BY 4.0 (https://download.geonames.org/export/zip/). The map footer already credits GeoNames.
//
// SAFETY (same model as scripts/migrate.mjs): --expect-db <name> must equal the database in DATABASE_URL; without --apply it is a DRY RUN that only
// READS (in a read-only transaction) and prints AGGREGATES (counts, never a pin code list); it prints no passwords, hosts or URLs.
// --apply writes in ONE transaction and writes a rollback file (pincode-preload-rollback-<time>.sql) BEFORE changing anything. Take a fresh backup first.
//
//   node scripts/preload-pincode-locations.mjs --geonames <IN.txt> --file-only                                (no database at all: statistics of the file)
//   node --env-file=<env file> scripts/preload-pincode-locations.mjs --geonames <IN.txt> --expect-db <name>   (dry run against the database, read-only)
//   node --env-file=<env file> scripts/preload-pincode-locations.mjs --geonames <IN.txt> --expect-db <name> --apply

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseGeonames } from "./fill-pincode-locations.mjs";

const SAME = 0.001; // degrees: a stored centre this close to the GeoNames one counts as "the same"
const PIN = /^[1-9][0-9]{5}$/;

/** Statistics of the GeoNames file itself (aggregates only). */
export function fileStats(text) {
  const rows = text.split("\n").filter(Boolean).map((l) => l.split("\t")).filter((f) => f.length >= 11 && f[0] === "IN");
  const pins = new Set(), bad = new Set(), usable = parseGeonames(text);
  for (const f of rows) {
    pins.add(f[1]);
    if (!PIN.test(f[1])) bad.add(f[1]);
  }
  const withoutCoords = [...pins].filter((p) => PIN.test(p) && !usable.has(p)).length;
  return { fileRows: rows.length, distinctPinCodes: pins.size, badFormatPinCodes: bad.size, usable: usable.size, withoutUsableCoordinates: withoutCoords };
}

/** existing: Map<pincode, {lat, lng, source}>. Returns the plan (pin lists) and aggregate counts. */
export function planPreload(geo, existing) {
  const insert = [], fillMissing = [];
  let existingWithCoords = 0, existingMissing = 0, sameCentre = 0, differentCentre = 0, notInFile = 0;
  for (const [pin, g] of geo) {
    const e = existing.get(pin);
    if (!e) { insert.push(pin); continue; }
    if (e.source === "missing" || e.lat == null) { fillMissing.push(pin); continue; }
    if (Math.abs(e.lat - g.lat) <= SAME && Math.abs(e.lng - g.lng) <= SAME) sameCentre++; else differentCentre++;
  }
  for (const [pin, e] of existing) {
    if (e.source === "missing" || e.lat == null) existingMissing++; else existingWithCoords++;
    if (!geo.has(pin)) notInFile++;
  }
  return {
    insert, fillMissing,
    counts: {
      geonamesUsable: geo.size, existingRows: existing.size, existingWithCoords, existingMissing,
      wouldInsert: insert.length, wouldFillMissing: fillMissing.length,
      existingUntouchedSameCentre: sameCentre, existingUntouchedDifferentCentre: differentCentre, existingNotInGeonames: notInFile,
      finalRowsAfter: existing.size + insert.length,
    },
  };
}

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

/** The rollback SQL for one run: removes the inserted rows (matched by the run's exact timestamp) and puts filled-in rows back to 'missing'. */
export function rollbackSql(dbName, runTs, inserted, filled) {
  return `-- Undo of one pincode preload run (${runTs}). Run it through the migration runner so the database name is confirmed:
--   node --env-file=<env file> scripts/migrate.mjs --expect-db ${dbName} --file <this file> --apply
BEGIN;
DO $$ BEGIN
  IF nullif(current_setting('rv.expected_db', true), '') IS NULL OR current_database() <> current_setting('rv.expected_db', true) THEN
    RAISE EXCEPTION 'Database name not confirmed. Nothing was changed.';
  END IF;
END $$;
DELETE FROM pincode_locations WHERE source = 'geonames' AND resolved_at = ${q(runTs)}::timestamptz
  AND pincode IN (${inserted.map(q).join(",") || "''"});
UPDATE pincode_locations SET lat = NULL, lng = NULL, place = NULL, source = 'missing'
 WHERE source = 'geonames' AND resolved_at = ${q(runTs)}::timestamptz AND pincode IN (${filled.map(q).join(",") || "''"});
COMMIT;
`;
}

/** Writes the plan into the database (used by --apply and by the tests). `db` needs query(). */
export async function applyPlan(db, geo, plan, runTs) {
  await db.query("BEGIN");
  try {
    for (const pin of plan.insert) {
      const g = geo.get(pin);
      await db.query("INSERT INTO pincode_locations (pincode, lat, lng, place, source, resolved_at) VALUES ($1,$2,$3,$4,'geonames',$5) ON CONFLICT (pincode) DO NOTHING", [pin, g.lat, g.lng, g.place, runTs]);
    }
    for (const pin of plan.fillMissing) {
      const g = geo.get(pin);
      await db.query("UPDATE pincode_locations SET lat=$2, lng=$3, place=$4, source='geonames', resolved_at=$5 WHERE pincode=$1 AND source='missing'", [pin, g.lat, g.lng, g.place, runTs]);
    }
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  }
}

async function main() {
  const a = process.argv.slice(2);
  const opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const apply = a.includes("--apply"), fileOnly = a.includes("--file-only");
  const geoPath = opt("--geonames"), expect = opt("--expect-db");
  if (!geoPath || (!fileOnly && !expect)) { console.error("Usage: --geonames <IN.txt> (--file-only | --expect-db <database name> [--apply])"); process.exit(2); }
  const text = readFileSync(geoPath, "utf8");
  console.log("GeoNames file:", JSON.stringify(fileStats(text)));
  if (fileOnly) return;
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set."); process.exit(2); }
  const dbInUrl = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (dbInUrl !== expect) { console.error(`Refusing: DATABASE_URL points at "${dbInUrl}", not "${expect}". Nothing was changed.`); process.exit(2); }
  const { default: pg } = await import("pg");
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    const cur = (await db.query("SELECT current_database() AS d")).rows[0].d;
    if (cur !== expect) throw new Error(`Connected to "${cur}", expected "${expect}". Nothing was changed.`);
    await db.query("BEGIN READ ONLY");
    const existing = new Map((await db.query("SELECT pincode, lat, lng, source FROM pincode_locations")).rows.map((r) => [r.pincode, { lat: r.lat, lng: r.lng, source: r.source }]));
    await db.query("ROLLBACK");
    const geo = parseGeonames(text), plan = planPreload(geo, existing);
    console.log(`Database: ${cur}  |  mode: ${apply ? "APPLY" : "DRY RUN (nothing is written)"}`);
    console.log("Plan:", JSON.stringify(plan.counts));
    if (!apply) { console.log("\nDry run only. Take a fresh backup, then add --apply to write."); return; }
    const runTs = new Date().toISOString();
    const file = `pincode-preload-rollback-${runTs.replace(/[:.]/g, "-")}.sql`;
    writeFileSync(file, rollbackSql(cur, runTs, plan.insert, plan.fillMissing)); // written BEFORE the change
    await applyPlan(db, geo, plan, runTs);
    console.log(`\nWritten: ${plan.insert.length} inserted, ${plan.fillMissing.length} filled in. Rollback file: ${file}`);
  } catch (e) {
    try { await db.query("ROLLBACK"); } catch { /* ignore */ }
    console.error("Failed:", e.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
