// "Schools near a pin code": pincode / lat / lng / radius on GET /api/services/search. Real route and real SQL (Haversine,
// bounding box, pincode_locations join) on the in-process PostgreSQL (PGlite); no real database, no network.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });

import { GET as search } from "../src/app/api/services/search/route";
import { parseSearchParams } from "../src/lib/serviceDatasets";

const sql = async (q: string, p?: unknown[]) => (await testDb().raw.query(q, p as never)).rows as any[];
const get = async (qs: string) => { const r = await search(new Request("http://localhost/api/services/search" + qs)); return { status: r.status, body: await r.json() }; };
const names = async (qs: string) => (await get(qs)).body.results.map((r: any) => r.schoolName);

// Centres (Delhi area, roughly north of 110001): 110002 ~3.6 km, 110003 ~11 km, 110004 ~30 km, 110005 ~49 km, 110006 ~56 km.
const PINS: Array<[string, number | null, number | null, string]> = [
  ["110001", 28.6139, 77.209, "geonames"], ["110002", 28.64, 77.23, "geonames"], ["110003", 28.7139, 77.209, "geonames"],
  ["110004", 28.8839, 77.209, "geonames"], ["110005", 29.0539, 77.209, "geonames"], ["110006", 29.1139, 77.209, "geonames"],
  ["143004", null, null, "missing"],
];
const SCHOOLS: Array<[string, string]> = [
  ["Centre School", "110001"], ["Centre School Two", "110001"], ["Near School", "110002"], ["Ten Km School", "110003"],
  ["Thirty Km School", "110004"], ["Edge School", "110005"], ["Far School", "110006"], ["Missing Pin School", "143004"],
  ["Unlisted Pin School", "560001"], ["<script>alert(1)</script> School", "110002"],
];

async function seed(withData = true) {
  const admin = await seedUser({ email: "ai@symbiosystech.com", role: "admin" });
  if (!withData) return;
  const ds = await sql(
    `INSERT INTO service_datasets (uploaded_by, original_filename, file_sha256, row_count, invalid_row_count, columns, status, activated_at)
     VALUES ($1, 'x.csv', 'abc', $2, 0, '[]'::jsonb, 'active', now()) RETURNING id`, [admin.id, SCHOOLS.length]);
  let n = 0;
  for (const [name, pin] of SCHOOLS) {
    await sql(`INSERT INTO service_dataset_rows (dataset_id, row_number, school_name, pincode, data, search_name, search_loc) VALUES ($1, $2, $3, $4, '{}'::jsonb, $5, $6)`,
      [ds[0].id, ++n, name, pin, name.toLowerCase(), pin]);
  }
  for (const [pin, lat, lng, source] of PINS) await sql("INSERT INTO pincode_locations (pincode, lat, lng, source) VALUES ($1, $2, $3, $4)", [pin, lat, lng, source]);
}

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("near a pin code", () => {
  beforeEach(() => seed());

  it("the schools in that pin code come first at distance 0, then nearest first", async () => {
    const { status, body } = await get("?pincode=110001&radius=50");
    expect(status).toBe(200);
    expect(body.results.map((r: any) => r.schoolName)).toEqual([
      "Centre School", "Centre School Two", "<script>alert(1)</script> School", "Near School", "Ten Km School", "Thirty Km School", "Edge School",
    ]);
    expect(body.results.slice(0, 2).map((r: any) => r.distanceKm)).toEqual([0, 0]);
    const d = body.results.map((r: any) => r.distanceKm);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
    expect(body.near).toMatchObject({ center: { lat: 28.6139, lng: 77.209 }, pincodeKnown: true, radiusKm: 50, limit: 50 });
    expect(body.results[3]).toMatchObject({ pincode: "110002", lat: 28.64, lng: 77.23 });
  });

  it("the radius decides which schools are shown (1, 10, 25 and 50 km)", async () => {
    expect(await names("?pincode=110001&radius=1")).toEqual(["Centre School", "Centre School Two"]);
    expect(await names("?pincode=110001&radius=10")).toEqual(["Centre School", "Centre School Two", "<script>alert(1)</script> School", "Near School"]);
    expect(await names("?pincode=110001&radius=25")).toContain("Ten Km School");
    expect(await names("?pincode=110001&radius=25")).not.toContain("Thirty Km School");
    expect(await names("?pincode=110001&radius=50")).toContain("Edge School");
    expect(await names("?pincode=110001&radius=50")).not.toContain("Far School");
  });

  it("the default radius is 25 km", async () => {
    expect((await get("?pincode=110001")).body.near.radiusKm).toBe(25);
  });

  it("distances are real great-circle kilometres", async () => {
    const r = (await get("?pincode=110001&radius=50")).body.results.find((x: any) => x.schoolName === "Thirty Km School");
    expect(r.distanceKm).toBeGreaterThan(29.5);
    expect(r.distanceKm).toBeLessThan(30.5);
  });

  it("a pin code with no stored position: its own schools only, centre null (the widget then looks it up and asks again with lat/lng)", async () => {
    const { body } = await get("?pincode=143004&radius=50");
    expect(body.results.map((r: any) => r.schoolName)).toEqual(["Missing Pin School"]);
    expect(body.results[0]).toMatchObject({ distanceKm: 0, lat: null, lng: null });
    expect(body.near).toMatchObject({ center: null, pincodeKnown: true });
  });

  it("a 'missing' school never shows up in a radius search from another pin code", async () => {
    expect(await names("?pincode=110001&radius=50")).not.toContain("Missing Pin School");
  });

  it("a pin code that is not in the table at all: centre null, pincodeKnown false; its own schools still listed", async () => {
    const { body } = await get("?pincode=560001&radius=10");
    expect(body.near).toMatchObject({ center: null, pincodeKnown: false });
    expect(body.results.map((r: any) => r.schoolName)).toEqual(["Unlisted Pin School"]);
    expect((await get("?pincode=400001")).body).toMatchObject({ total: 0, results: [] });
  });

  it("lat/lng supply the centre when the pin code has no stored position", async () => {
    const { body } = await get("?pincode=400001&lat=28.6139&lng=77.209&radius=5");
    expect(body.near.center).toEqual({ lat: 28.6139, lng: 77.209 });
    expect(body.results.map((r: any) => r.schoolName)).toEqual(["Centre School", "Centre School Two", "<script>alert(1)</script> School", "Near School"]);
    expect((await names("?lat=28.6139&lng=77.209&radius=1"))).toEqual(["Centre School", "Centre School Two"]);
  });

  it("a stored position wins over client-supplied lat/lng", async () => {
    const { body } = await get("?pincode=110001&lat=19.07&lng=72.87&radius=1");
    expect(body.near.center).toEqual({ lat: 28.6139, lng: 77.209 });
  });

  it("at most 50 schools are returned, with the full count in total", async () => {
    const ds = (await sql("select id from service_datasets"))[0].id;
    for (let i = 0; i < 60; i++) {
      await sql(`INSERT INTO service_dataset_rows (dataset_id, row_number, school_name, pincode, data, search_name, search_loc) VALUES ($1, $2, $3, '110002', '{}'::jsonb, 'x', '110002')`, [ds, 100 + i, "Bulk " + i]);
    }
    const { body } = await get("?pincode=110001&radius=50");
    expect(body.results).toHaveLength(50);
    expect(body.total).toBe(67);
  });

  it("school names come back as plain strings (the widget renders them with textContent)", async () => {
    const hit = (await get("?pincode=110002&radius=1")).body.results.find((r: any) => r.schoolName.includes("<script>"));
    expect(hit.schoolName).toBe("<script>alert(1)</script> School");
  });

  it("is public: no sign-in is needed", async () => {
    expect((await get("?pincode=110001")).status).toBe(200);
  });
});

describe("near a pin code: input validation", () => {
  beforeEach(() => seed());

  it.each([
    ["5 digits", "?pincode=11000"], ["7 digits", "?pincode=1100011"], ["letters", "?pincode=11000a"], ["leading zero", "?pincode=010001"],
    ["injection", "?pincode=110001%27%3B%20DROP%20TABLE%20x%3B--"], ["radius 51", "?pincode=110001&radius=51"], ["radius 0", "?pincode=110001&radius=0"],
    ["radius -5", "?pincode=110001&radius=-5"], ["radius 2.5", "?pincode=110001&radius=2.5"], ["radius letters", "?pincode=110001&radius=abc"],
    ["radius 1000", "?pincode=110001&radius=1000"], ["radius alone", "?radius=10"], ["lat without lng", "?lat=28.6"],
    ["lat letters", "?lat=abc&lng=77"], ["outside India", "?lat=51.5&lng=-0.1"], ["lng out of range", "?lat=28.6&lng=200"],
  ])("rejects %s with 400", async (_n, qs) => {
    const { status, body } = await get(qs);
    expect(status).toBe(400);
    expect(body).toMatchObject({ success: false, error: "VALIDATION_FAILED" });
    expect(typeof body.message).toBe("string");
  });

  it("radius 1 and 50 are the accepted limits", async () => {
    expect((await get("?pincode=110001&radius=1")).status).toBe(200);
    expect((await get("?pincode=110001&radius=50")).status).toBe(200);
  });

  it("the plain text search is unchanged (no near block)", async () => {
    const { body } = await get("?q=centre");
    expect(body.near).toBeUndefined();
    expect(body.results.map((r: any) => r.schoolName)).toEqual(["Centre School", "Centre School Two"]);
    expect(body.results[0].distanceKm).toBeUndefined();
  });

  it("parseSearchParams only adds `near` when a pin code or centre is given", () => {
    const plain = parseSearchParams(new URLSearchParams("q=a"));
    expect("value" in plain && plain.value.near).toBeUndefined();
    const near = parseSearchParams(new URLSearchParams("pincode=110001&radius=7"));
    expect("value" in near && near.value.near).toEqual({ pincode: "110001", lat: null, lng: null, radiusKm: 7 });
  });
});

describe("near a pin code: edge states", () => {
  it("an empty database (no dataset yet): empty results, no error", async () => {
    await seed(false);
    const { status, body } = await get("?pincode=110001");
    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true, dataset: null, total: 0, results: [] });
  });

  it("a database failure answers 500 with a friendly message and no details", async () => {
    await seed();
    const { overridePool } = await import("./helpers");
    overridePool({ query: async () => { throw new Error("connection refused: secret-host"); } });
    const { status, body } = await get("?pincode=110001");
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("secret-host");
    expect(body).toMatchObject({ success: false, error: "SERVER_ERROR" });
  });
});
