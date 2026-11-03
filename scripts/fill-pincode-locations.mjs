#!/usr/bin/env node
// Fills pincode_locations (migration 006) with the centre of every distinct pin code in the ACTIVE school dataset.
//
//   1. GeoNames postal codes for India (https://download.geonames.org/export/zip/IN.zip, CC BY 4.0, credit: geonames.org).
//      Pass the extracted IN.txt with --geonames <path>.
//   2. Pin codes GeoNames does not know are looked up on OpenStreetMap Nominatim (India only, ONE request per second,
//      identifying User-Agent). Progress is saved to a checkpoint file, so an interrupted run resumes where it stopped.
//   3. Anything still unresolved is stored with lat/lng NULL and source 'missing'. Coordinates are never guessed.
//
// SAFETY (same model as scripts/migrate.mjs): --expect-db <name> is required and must equal the database in DATABASE_URL;
// without --apply it is a DRY RUN that only READS the pin codes (in a read-only transaction) and writes nothing; it prints
// no passwords, URLs or hosts. Re-running is safe: rows are upserted, and re-run it after a new upload brings new pin codes.
//
// Usage (the connection string comes from the environment, e.g. node --env-file=<file>):
//   node --env-file=<env file> scripts/fill-pincode-locations.mjs --expect-db <name> --geonames <IN.txt>            (dry run)
//   node --env-file=<env file> scripts/fill-pincode-locations.mjs --expect-db <name> --geonames <IN.txt> --apply
// Options: --checkpoint <file>   (default ./pincode-fill-checkpoint.json)   --no-nominatim   (skip step 2: leave them 'missing')

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const INDIA = { latMin: 6, latMax: 38, lngMin: 67, lngMax: 98 };
const PIN = /^[1-9][0-9]{5}$/;
const UA = "RoboValleyPincodeFill/1.0 (https://techytree.in)";

/** Parses GeoNames' tab-separated postal file into Map<pincode, {lat, lng, place}>. First entry per pin code wins. */
export function parseGeonames(text) {
  const out = new Map();
  for (const line of text.split("\n")) {
    const f = line.split("\t");
    if (f.length < 11 || f[0] !== "IN" || !PIN.test(f[1])) continue;
    const lat = Number(f[9]), lng = Number(f[10]);
    if (!inIndia(lat, lng) || out.has(f[1])) continue;
    out.set(f[1], { lat, lng, place: [f[2], f[5] || f[3]].filter(Boolean).join(", ").slice(0, 120) });
  }
  return out;
}

export function inIndia(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat > INDIA.latMin && lat < INDIA.latMax && lng > INDIA.lngMin && lng < INDIA.lngMax;
}

/** Splits the dataset's pin codes into those GeoNames resolves and those it does not. */
export function plan(pins, geo) {
  const fromGeonames = [], needLookup = [];
  for (const p of pins) (geo.has(p) ? fromGeonames : needLookup).push(p);
  return { fromGeonames, needLookup };
}

async function nominatim(pin) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=in&postalcode=${pin}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en" } });
  if (!res.ok) throw new Error("Nominatim HTTP " + res.status);
  const hit = (await res.json())[0];
  if (!hit) return null;
  const lat = Number(hit.lat), lng = Number(hit.lon);
  return inIndia(lat, lng) ? { lat, lng, place: String(hit.display_name || "").slice(0, 120) } : null;
}

async function main() {
  const a = process.argv.slice(2);
  const opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const apply = a.includes("--apply"), useNominatim = !a.includes("--no-nominatim");
  const expect = opt("--expect-db"), geoPath = opt("--geonames"), cpPath = opt("--checkpoint") || "./pincode-fill-checkpoint.json";
  if (!expect || !geoPath) { console.error("Usage: --expect-db <database name> --geonames <IN.txt> [--apply] [--checkpoint <file>] [--no-nominatim]"); process.exit(2); }
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
    const pins = (await db.query(`SELECT DISTINCT pincode FROM service_dataset_rows
        WHERE dataset_id = (SELECT id FROM service_datasets WHERE status = 'active') AND pincode ~ '^[1-9][0-9]{5}$' ORDER BY 1`)).rows.map((r) => r.pincode);
    const bad = (await db.query(`SELECT count(*)::int n FROM service_dataset_rows
        WHERE dataset_id = (SELECT id FROM service_datasets WHERE status = 'active') AND (pincode IS NULL OR pincode !~ '^[1-9][0-9]{5}$')`)).rows[0].n;
    await db.query("ROLLBACK");

    const geo = parseGeonames(readFileSync(geoPath, "utf8"));
    const { fromGeonames, needLookup } = plan(pins, geo);
    const checkpoint = existsSync(cpPath) ? JSON.parse(readFileSync(cpPath, "utf8")) : {};
    const todo = needLookup.filter((p) => !(p in checkpoint));
    console.log(`Database: ${cur}  |  mode: ${apply ? "APPLY" : "DRY RUN (nothing is written)"}`);
    console.log(`Active dataset: ${pins.length} distinct valid pin codes (${bad} rows have a missing/invalid pin code)`);
    console.log(`GeoNames file: ${geo.size} pin codes  ->  resolved from GeoNames: ${fromGeonames.length}`);
    console.log(`Not in GeoNames: ${needLookup.length} ${useNominatim ? `-> Nominatim lookups needed: ${todo.length} (about ${todo.length + 2} seconds at 1 request/second; ${needLookup.length - todo.length} already in the checkpoint)` : "-> will be stored as missing (--no-nominatim)"}`);
    console.log(`Pin codes needing Nominatim: ${needLookup.join(", ")}`);
    if (!apply) { console.log("\nDry run only. Add --apply to write."); return; }

    if (useNominatim) {
      for (const p of todo) {
        let r = null, failed = false;
        try { r = await nominatim(p); } catch (e) { failed = true; console.error(`  ${p}: ${e.message} (will be retried on the next run)`); }
        if (!failed) checkpoint[p] = r ? { ...r, source: "nominatim" } : { source: "missing" };
        writeFileSync(cpPath, JSON.stringify(checkpoint, null, 1));
        console.log(`  ${p}: ${failed ? "error" : r ? "found" : "not found"}`);
        await new Promise((ok) => setTimeout(ok, 1100));
      }
    }

    const rows = [
      ...fromGeonames.map((p) => ({ p, ...geo.get(p), source: "geonames" })),
      ...needLookup.map((p) => (checkpoint[p]?.source === "nominatim" ? { p, ...checkpoint[p] } : { p, lat: null, lng: null, place: null, source: "missing" })),
    ];
    await db.query("BEGIN");
    for (const r of rows) {
      await db.query(
        `INSERT INTO pincode_locations (pincode, lat, lng, place, source) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (pincode) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, place = EXCLUDED.place, source = EXCLUDED.source, resolved_at = now()`,
        [r.p, r.lat, r.lng, r.place, r.source]
      );
    }
    await db.query("COMMIT");
    const by = rows.reduce((m, r) => ((m[r.source] = (m[r.source] || 0) + 1), m), {});
    console.log(`\nWritten ${rows.length} rows:`, JSON.stringify(by));
  } catch (e) {
    try { await db.query("ROLLBACK"); } catch { /* ignore */ }
    console.error("Failed:", e.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
