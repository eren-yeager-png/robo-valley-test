// Migration 006 (pincode_locations), its rollback and the pure parts of the fill script, on an in-process PostgreSQL (PGlite).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { applyFile, pickFiles } from "../scripts/migrate.mjs";
import { inIndia, parseGeonames, plan } from "../scripts/fill-pincode-locations.mjs";

const read = (p: string) => readFileSync(resolve(p), "utf8");
const runner = (pg: PGlite) => ({
  setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]),
  exec: (sql: string) => pg.exec(sql),
});
const tables = async (pg: PGlite) =>
  (await pg.query("select table_name t from information_schema.tables where table_schema='public' order by 1")).rows.map((r: any) => r.t);

describe("migration 006", () => {
  let pg: PGlite; let name: string;
  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(read("tests/helpers/baseSchema.sql"));
    name = String((await pg.query("select current_database() d")).rows[0]!["d" as never]);
    for (const f of pickFiles()) await applyFile(runner(pg), name, read(f));
  });

  it("adds only pincode_locations, and is safe to run twice", async () => {
    expect(await tables(pg)).toContain("pincode_locations");
    await applyFile(runner(pg), name, read("db/migrations/006_pincode_locations.sql"));
    expect((await tables(pg)).filter((t) => t === "pincode_locations")).toHaveLength(1);
  });

  it("refuses to run without a confirmed database name", async () => {
    const other = new PGlite();
    await other.exec(read("tests/helpers/baseSchema.sql"));
    await expect(other.exec(read("db/migrations/006_pincode_locations.sql"))).rejects.toThrow(/not set/);
    await other.exec("ROLLBACK");
    await other.close();
  });

  it("accepts a resolved pin code and a 'missing' one, and rejects bad data", async () => {
    await pg.exec("insert into pincode_locations (pincode, lat, lng, source) values ('110001', 28.6, 77.2, 'geonames'), ('143004', null, null, 'missing')");
    const bad = (sql: string) => expect(pg.exec(sql)).rejects.toThrow();
    await bad("insert into pincode_locations (pincode, lat, lng, source) values ('11000', 28.6, 77.2, 'geonames')");
    await bad("insert into pincode_locations (pincode, lat, lng, source) values ('010001', 28.6, 77.2, 'geonames')");
    await bad("insert into pincode_locations (pincode, lat, lng, source) values ('110002', 51.5, -0.1, 'geonames')"); // outside India
    await bad("insert into pincode_locations (pincode, lat, lng, source) values ('110003', null, null, 'geonames')"); // resolved needs a position
    await bad("insert into pincode_locations (pincode, lat, lng, source) values ('110004', 28.6, 77.2, 'missing')"); // missing must not have one
    await bad("insert into pincode_locations (pincode, lat, lng, source) values ('110001', 28.6, 77.2, 'geonames')"); // one row per pin code
    await bad("insert into pincode_locations (pincode, lat, lng, source) values ('110005', 28.6, 77.2, 'guess')");
  });

  it("the rollback removes only this table", async () => {
    await applyFile(runner(pg), name, read("db/rollback/006_down.sql"));
    const t = await tables(pg);
    expect(t).not.toContain("pincode_locations");
    expect(t).toEqual(expect.arrayContaining(["service_datasets", "service_dataset_rows", "upload_audit_log", "users"]));
  });
});

describe("fill script (pure parts)", () => {
  const row = (pin: string, lat: string, lng: string, place = "Place", state = "Delhi") =>
    ["IN", pin, place, state, "DL", "New Delhi", "", "", "", lat, lng, "4"].join("\t");

  it("parses GeoNames rows, keeps the first entry per pin code, drops bad and out-of-India rows", () => {
    const m = parseGeonames([row("110001", "28.6", "77.2", "A"), row("110001", "1", "1", "B"), row("11000", "28", "77"), row("110002", "51.5", "-0.1"), "garbage", ""].join("\n"));
    expect([...m.keys()]).toEqual(["110001"]);
    expect(m.get("110001")).toMatchObject({ lat: 28.6, lng: 77.2 });
  });

  it("splits the dataset's pin codes into GeoNames-known and Nominatim-needed", () => {
    expect(plan(["110001", "143004"], new Map([["110001", {}]]))).toEqual({ fromGeonames: ["110001"], needLookup: ["143004"] });
  });

  it("inIndia rejects NaN and coordinates outside the country", () => {
    expect(inIndia(28.6, 77.2)).toBe(true);
    expect(inIndia(NaN, 77)).toBe(false);
    expect(inIndia(51.5, -0.1)).toBe(false);
  });
});
