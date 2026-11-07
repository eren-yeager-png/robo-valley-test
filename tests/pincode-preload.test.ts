// scripts/preload-pincode-locations.mjs: statistics of the GeoNames file, the plan (insert / fill missing / never touch existing), the write on a
// real PostgreSQL engine (PGlite) with migration 006's table, idempotence, and the generated rollback. No real database and no network.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { applyFile, pickFiles } from "../scripts/migrate.mjs";
import { applyPlan, fileStats, planPreload, rollbackSql } from "../scripts/preload-pincode-locations.mjs";
import { parseGeonames } from "../scripts/fill-pincode-locations.mjs";

const read = (p: string) => readFileSync(resolve(p), "utf8");
const row = (pin: string, lat: number | string, lng: number | string, name = "Place") => ["IN", pin, name, "State", "01", "District", "1", "", "", String(lat), String(lng), "4"].join("\t");
// 110001 twice (the first row wins), 522005, 560001, a bad coordinate (0,0 is outside India) and a bad pin code.
const TEXT = [row("110001", 28.63, 77.21, "A"), row("110001", 28.7, 77.3, "B"), row("522005", 16.3, 80.4), row("560001", 12.97, 77.59), row("600001", 0, 0), row("12345", 20, 80)].join("\n") + "\n";

describe("the GeoNames file statistics", () => {
  it("counts rows, distinct pin codes, bad formats and pin codes without usable coordinates (aggregates only)", () => {
    expect(fileStats(TEXT)).toEqual({ fileRows: 6, distinctPinCodes: 5, badFormatPinCodes: 1, usable: 3, withoutUsableCoordinates: 1 });
  });
  it("the first row per pin code wins (the same rule the earlier fill used, so stored centres never move)", () => {
    expect(parseGeonames(TEXT).get("110001")).toMatchObject({ lat: 28.63, lng: 77.21 });
  });
});

describe("the plan", () => {
  const geo = parseGeonames(TEXT);
  const existing = new Map<string, { lat: number | null; lng: number | null; source: string }>([
    ["110001", { lat: 28.63, lng: 77.21, source: "geonames" }], // same centre: untouched
    ["522005", { lat: 17.0, lng: 81.0, source: "nominatim" }], // different centre: untouched, only counted
    ["999999", { lat: null, lng: null, source: "missing" }], // not in the file: stays missing
  ]);
  it("inserts only what is absent, fills only 'missing' rows, never touches a row that has coordinates", () => {
    const p = planPreload(geo, existing);
    expect(p.insert).toEqual(["560001"]);
    expect(p.fillMissing).toEqual([]);
    expect(p.counts).toEqual({
      geonamesUsable: 3, existingRows: 3, existingWithCoords: 2, existingMissing: 1, wouldInsert: 1, wouldFillMissing: 0,
      existingUntouchedSameCentre: 1, existingUntouchedDifferentCentre: 1, existingNotInGeonames: 1, finalRowsAfter: 4,
    });
  });
  it("a 'missing' row that GeoNames knows is filled in", () => {
    const e = new Map(existing); e.set("560001", { lat: null, lng: null, source: "missing" });
    const p = planPreload(geo, e);
    expect(p.fillMissing).toEqual(["560001"]);
    expect(p.insert).toEqual([]);
  });
  it("with an empty table everything usable is inserted", () => {
    expect(planPreload(geo, new Map()).counts).toMatchObject({ wouldInsert: 3, finalRowsAfter: 3 });
  });
});

describe("writing it (PGlite, the real table from migration 006)", () => {
  let pg: PGlite, db: string;
  const state = async () => (await pg.query("SELECT pincode, lat, lng, source, resolved_at FROM pincode_locations ORDER BY pincode")).rows as any[];
  beforeEach(async () => {
    pg = new PGlite();
    await pg.exec(read("tests/helpers/baseSchema.sql"));
    db = String((await pg.query("select current_database() d")).rows[0]!["d" as never]);
    const run = { setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]), exec: (s: string) => pg.exec(s) };
    for (const f of pickFiles()) await applyFile(run, db, read(f));
    await pg.exec(`INSERT INTO pincode_locations (pincode, lat, lng, place, source) VALUES
      ('110001', 28.63, 77.21, 'old', 'geonames'), ('522005', 17.0, 81.0, 'nom', 'nominatim'), ('560001', NULL, NULL, NULL, 'missing')`);
  });
  const geo = parseGeonames(TEXT);
  const TS = "2026-11-07T12:00:00.000Z";
  const client = () => ({ query: (s: string, p?: unknown[]) => pg.query(s, p as never) });

  it("fills the missing one, adds the new ones, leaves the rest exactly as it was", async () => {
    const before = await state();
    const plan = planPreload(geo, new Map(before.map((r) => [r.pincode, { lat: r.lat, lng: r.lng, source: r.source }])));
    await applyPlan(client(), geo, plan, TS);
    const after = await state();
    expect(after.map((r) => r.pincode)).toEqual(["110001", "522005", "560001"]);
    expect(after.find((r) => r.pincode === "560001")).toMatchObject({ lat: 12.97, lng: 77.59, source: "geonames" });
    expect(after.find((r) => r.pincode === "522005")).toMatchObject({ lat: 17, lng: 81, source: "nominatim" }); // untouched
    expect(after.find((r) => r.pincode === "110001")!.resolved_at).toEqual(before.find((r) => r.pincode === "110001")!.resolved_at); // untouched
  });
  it("a second run changes nothing (idempotent)", async () => {
    for (let i = 0; i < 2; i++) {
      const cur = await state();
      const plan = planPreload(geo, new Map(cur.map((r) => [r.pincode, { lat: r.lat, lng: r.lng, source: r.source }])));
      if (i === 1) { expect(plan.insert).toEqual([]); expect(plan.fillMissing).toEqual([]); }
      await applyPlan(client(), geo, plan, TS);
    }
  });
  it("the generated rollback restores the table exactly (removes inserts, puts filled rows back to 'missing') and needs the database name", async () => {
    await pg.exec("INSERT INTO pincode_locations (pincode, lat, lng, place, source) VALUES ('600002', NULL, NULL, NULL, 'missing')");
    const g2 = parseGeonames(TEXT + row("600002", 13.0, 80.2) + "\n" + row("700001", 22.5, 88.3) + "\n");
    const before = (await state()).map(({ resolved_at, ...r }) => r);
    const cur = await state();
    const plan = planPreload(g2, new Map(cur.map((r) => [r.pincode, { lat: r.lat, lng: r.lng, source: r.source }])));
    expect(plan.insert).toEqual(["700001"]);
    expect(plan.fillMissing).toEqual(["560001", "600002"]);
    const sql = rollbackSql(db, TS, plan.insert, plan.fillMissing);
    await applyPlan(client(), g2, plan, TS);
    expect((await state()).length).toBe(before.length + 1);
    await pg.query("select set_config('rv.expected_db', '', false)");
    await expect(pg.exec(sql)).rejects.toThrow(/not confirmed/);
    await pg.exec("ROLLBACK");
    const run = { setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]), exec: (s: string) => pg.exec(s) };
    await applyFile(run, db, sql);
    expect((await state()).map(({ resolved_at, ...r }) => r)).toEqual(before);
  });
  it("the script itself never deletes, never overwrites a row that has coordinates, and never contacts a network service", () => {
    const s = read("scripts/preload-pincode-locations.mjs");
    expect(s).not.toMatch(/fetch\(|nominatim\.openstreetmap/i);
    expect(s).toContain("ON CONFLICT (pincode) DO NOTHING");
    expect(s).toContain("AND source='missing'");
    expect(s).toContain("BEGIN READ ONLY");
  });
});
