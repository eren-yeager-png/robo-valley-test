// Find a Service categories: the fixed allow-list, one live dataset PER category, the categories endpoint, the category
// parameter on search, and migration 007 with its rollback. Real routes and real SQL on the in-process PostgreSQL (PGlite).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";
import { createSessionToken } from "../src/lib/session";
import { applyFile, pickFiles } from "../scripts/migrate.mjs";

const m = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "rv_session" && m.cookie ? { name: n, value: m.cookie } : undefined) }),
}));

import { POST as upload } from "../src/app/api/services/upload/route";
import { POST as confirm } from "../src/app/api/services/upload/confirm/route";
import { GET as search } from "../src/app/api/services/search/route";
import { GET as categories } from "../src/app/api/services/categories/route";
import { CATEGORIES, CATEGORY_SLUGS, parseCategory } from "../src/lib/serviceCategories";
import { parseSearchParams } from "../src/lib/serviceDatasets";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const sql = async (q: string, p?: unknown[]) => (await testDb().raw.query(q, p as never)).rows as any[];
const read = (p: string) => readFileSync(resolve(p), "utf8");

const HEAD = "School Name,State,District,Pincode,UDISE Code\n";
const ATL = HEAD + ["Atl One,Andhra Pradesh,Guntur,522005,1", "Atl Two,Andhra Pradesh,Guntur,522005,2", "Atl Three,Telangana,Warangal,506002,3"].join("\n");
const STEM = HEAD + ["Stem One,Telangana,Hyderabad,500001,10", "Stem Two,Telangana,Hyderabad,500001,11"].join("\n");
const ATL2 = HEAD + ["Atl Replacement,Andhra Pradesh,Guntur,522005,99"].join("\n");

const uploadReq = (text: string, category?: string | null, name = "data.csv") => {
  const fd = new FormData();
  fd.set("file", new File([text], name, { type: "text/csv" }));
  if (category !== null && category !== undefined) fd.set("category", category);
  return new Request("http://localhost/api/services/upload", { method: "POST", body: fd });
};
const confirmReq = (datasetId: unknown) => new Request("http://localhost/api/services/upload/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ datasetId }) });
const get = async (qs = "") => { const r = await search(new Request("http://localhost/api/services/search" + qs)); return { status: r.status, body: await r.json() }; };
const cats = async () => { const r = await categories(new Request("http://localhost/api/services/categories")); return { status: r.status, body: await r.json() }; };

let admin: { id: string };
beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  for (const fn of ["log", "error", "warn", "info"] as const) vi.spyOn(console, fn).mockImplementation(() => {});
  admin = await seedUser({ email: "ai@symbiosystech.com", role: "admin" });
  m.cookie = createSessionToken({ id: admin.id, role: "admin" }, false, Date.now(), { SESSION_SECRET: SECRET } as never).token;
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function goLive(text: string, category: string) {
  const up = await (await upload(uploadReq(text, category))).json();
  expect(up.success, JSON.stringify(up)).toBe(true);
  const ok = await confirm(confirmReq(up.datasetId));
  expect(ok.status).toBe(200);
  return up.datasetId as string;
}

describe("the fixed list of categories", () => {
  it("has exactly the six names with their slugs", () => {
    expect(CATEGORIES.map((c) => c.name)).toEqual(["ATL Labs", "Robotics Labs", "STEM Labs", "3D Printing Facilities", "Robotics Training Centres", "Innovation Centres"]);
    expect(CATEGORY_SLUGS).toEqual(["atl-labs", "robotics-labs", "stem-labs", "3d-printing-facilities", "robotics-training-centres", "innovation-centres"]);
  });
  it.each(["ATL Labs", "atl-labs ", "ATL-LABS", "atl_labs", "", "atl-labs'; drop table users;--", "<script>alert(1)</script>", "constructor", "__proto__"])("%j is not a category", (v) => {
    expect(parseCategory(v)).toBeNull();
  });
  it("accepts only an exact slug", () => { for (const s of CATEGORY_SLUGS) expect(parseCategory(s)).toBe(s); });
});

describe("upload needs a category from the list", () => {
  it.each([[undefined, "missing"], ["", "empty"], ["ATL Labs", "a display name instead of the slug"], ["atl-labz", "a typo"], ["x'; drop table service_datasets;--", "SQL"], ["<script>", "markup"]])("%j (%s) is refused with 400 and nothing is written", async (c) => {
    const res = await upload(uploadReq(ATL, c as string | undefined));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("VALIDATION_FAILED");
    expect(await sql("select count(*)::int n from service_datasets")).toEqual([{ n: 0 }]);
  });
  it("a valid category is stored on the staged dataset and echoed in the preview", async () => {
    const b = await (await upload(uploadReq(STEM, "stem-labs"))).json();
    expect(b.category).toEqual({ slug: "stem-labs", name: "STEM Labs" });
    expect(await sql("select category, status from service_datasets")).toEqual([{ category: "stem-labs", status: "staged" }]);
  });
  it("the database refuses a category outside the list even if the application did not", async () => {
    await expect(sql("insert into service_datasets (uploaded_by, original_filename, file_sha256, row_count, status, category) values ($1,'f',repeat('a',64),0,'staged','made-up')", [admin.id])).rejects.toThrow();
  });
});

describe("one active dataset per category", () => {
  it("two categories are live at once, and uploading one does not replace the other", async () => {
    await goLive(ATL, "atl-labs");
    await goLive(STEM, "stem-labs");
    expect(await sql("select category from service_datasets where status='active' order by category")).toEqual([{ category: "atl-labs" }, { category: "stem-labs" }]);
    const a = (await get("?category=atl-labs&pageSize=50")).body, s = (await get("?category=stem-labs&pageSize=50")).body;
    expect(a.results.map((r: any) => r.schoolName).sort()).toEqual(["Atl One", "Atl Three", "Atl Two"]);
    expect(s.results.map((r: any) => r.schoolName).sort()).toEqual(["Stem One", "Stem Two"]);
    expect(a.category).toEqual({ slug: "atl-labs", name: "ATL Labs", active: true });
    expect(s.dataset.rowCount).toBe(2);
  });
  it("re-uploading a category replaces only that category and keeps the old version for audit", async () => {
    await goLive(ATL, "atl-labs");
    await goLive(STEM, "stem-labs");
    await goLive(ATL2, "atl-labs");
    expect((await get("?category=atl-labs")).body.results.map((r: any) => r.schoolName)).toEqual(["Atl Replacement"]);
    expect((await get("?category=stem-labs")).body.total).toBe(2); // untouched
    expect(await sql("select category, status, count(*)::int n from service_datasets group by 1,2 order by 1,2")).toEqual([
      { category: "atl-labs", status: "active", n: 1 }, { category: "atl-labs", status: "superseded", n: 1 }, { category: "stem-labs", status: "active", n: 1 },
    ]);
  });
  it("the database itself allows only one active dataset per category", async () => {
    await goLive(ATL, "atl-labs");
    const second = (await (await upload(uploadReq(ATL2, "atl-labs"))).json()).datasetId;
    await expect(sql("update service_datasets set status='active' where id=$1", [second])).rejects.toThrow(/one_active|duplicate key/);
  });
  it("the confirm response and audit log name the category", async () => {
    const up = await (await upload(uploadReq(STEM, "stem-labs"))).json();
    const done = await (await confirm(confirmReq(up.datasetId))).json();
    expect(done.category).toBe("stem-labs");
    expect((await sql("select detail from upload_audit_log where action='confirm'"))[0].detail).toContain("stem-labs");
  });
});

describe("GET /api/services/categories", () => {
  it("nothing uploaded: all six inactive, no default", async () => {
    const { status, body } = await cats();
    expect(status).toBe(200);
    expect(body.categories.map((c: any) => [c.slug, c.active, c.count])).toEqual(CATEGORY_SLUGS.map((s) => [s, false, 0]));
    expect(body.defaultSlug).toBeNull();
  });
  it("an upload activates its category with the real count; the default is the first active in the fixed order", async () => {
    await goLive(STEM, "stem-labs");
    expect((await cats()).body.defaultSlug).toBe("stem-labs");
    await goLive(ATL, "atl-labs");
    const { body } = await cats();
    expect(body.defaultSlug).toBe("atl-labs");
    expect(body.categories.find((c: any) => c.slug === "atl-labs")).toMatchObject({ name: "ATL Labs", active: true, count: 3 });
    expect(body.categories.find((c: any) => c.slug === "stem-labs")).toMatchObject({ active: true, count: 2 });
    expect(body.categories.find((c: any) => c.slug === "robotics-labs")).toMatchObject({ active: false, count: 0, uploadedAt: null });
  });
  it("is public, cacheable for a minute (PR 2) and has no demo content", async () => {
    m.cookie = undefined;
    const r = await categories(new Request("http://localhost/api/services/categories"));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("public, s-maxage=60, stale-while-revalidate=30"); // PR 2: a shared cache may keep it for a minute
  });
});

describe("search by category", () => {
  it("with no category it answers for the first active one", async () => {
    await goLive(STEM, "stem-labs");
    await goLive(ATL, "atl-labs");
    expect((await get()).body.category.slug).toBe("atl-labs");
    expect((await get()).body.total).toBe(3);
  });
  it("a category that exists but has no upload answers 'not active' with no rows (the Coming Soon case)", async () => {
    await goLive(ATL, "atl-labs");
    const { status, body } = await get("?category=robotics-labs");
    expect(status).toBe(200);
    expect(body).toMatchObject({ dataset: null, total: 0, results: [], category: { slug: "robotics-labs", name: "Robotics Labs", active: false } });
  });
  it("nothing uploaded at all: dataset and category are null", async () => {
    expect((await get()).body).toMatchObject({ dataset: null, category: null, total: 0 });
  });
  it.each(["?category=nope", "?category=ATL-LABS", "?category=atl-labs%20", "?category=atl-labs;drop", "?category=%3Cscript%3E", "?category=__proto__"])("%s is rejected with 400", async (qs) => {
    const { status, body } = await get(qs);
    expect(status).toBe(400);
    expect(body.error).toBe("VALIDATION_FAILED");
  });
  it("the category also scopes a near-a-pin-code search, which returns the category name", async () => {
    await goLive(ATL, "atl-labs");
    await goLive(STEM, "stem-labs");
    await sql("insert into pincode_locations (pincode, lat, lng, source) values ('500001', 17.385, 78.4867, 'geonames'), ('522005', 16.3067, 80.4365, 'geonames')");
    const s = (await get("?category=stem-labs&pincode=500001&radius=5")).body;
    expect(s.results.map((r: any) => r.schoolName)).toEqual(["Stem One", "Stem Two"]);
    expect(s.category.name).toBe("STEM Labs");
    expect(s.near.center).toEqual({ lat: 17.385, lng: 78.4867 });
    expect((await get("?category=atl-labs&pincode=500001&radius=5")).body.results).toEqual([]); // ATL has none in that PIN code
  });
  it("parseSearchParams validates the category, and the radius cap is still 50", () => {
    expect(parseSearchParams(new URLSearchParams("category=stem-labs"))).toMatchObject({ value: { category: "stem-labs" } });
    expect(parseSearchParams(new URLSearchParams(""))).toMatchObject({ value: { category: null } });
    expect(parseSearchParams(new URLSearchParams("category=x"))).toEqual({ error: "category is not one of the available categories." });
    expect(parseSearchParams(new URLSearchParams("pincode=110001&radius=51"))).toHaveProperty("error");
  });
  it("responses never contain demo or sample content", async () => {
    await goLive(ATL, "atl-labs");
    for (const body of [(await cats()).body, (await get()).body, (await get("?category=stem-labs")).body]) {
      // The only mention of "demo" allowed is the explicit flag, and for real uploaded data it must be false.
      expect(JSON.stringify(body).replace(/"isDemo":false/g, "")).not.toMatch(/demo|Demonstration data|DEMO DATA|example\.org/i);
    }
  });
});

describe("migration 007 and its rollback", () => {
  const runner = (pg: PGlite) => ({ setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]), exec: (q: string) => pg.exec(q) });
  async function before007() {
    const pg = new PGlite();
    await pg.exec(read("tests/helpers/baseSchema.sql"));
    const name = String((await pg.query("select current_database() d")).rows[0]!["d" as never]);
    for (const f of pickFiles().filter((p) => !/007_/.test(p))) await applyFile(runner(pg), name, read(f));
    return { pg, name };
  }
  const file007 = "db/migrations/007_service_categories.sql";

  it("an existing active dataset (dataset 1) becomes ATL Labs, nothing is lost, and it can run twice", async () => {
    const { pg, name } = await before007();
    await pg.exec("insert into users (full_name,email,role,password_hash) values ('A','a@e.co','admin','x')");
    await pg.exec("insert into service_datasets (uploaded_by, original_filename, file_sha256, row_count, status) values (1,'Atl.xlsx',repeat('a',64),9716,'active'), (1,'old.xlsx',repeat('b',64),5,'superseded')");
    await pg.exec("insert into service_dataset_rows (dataset_id,row_number,school_name,data,search_name) values (1,1,'S','{}'::jsonb,'s')");
    await applyFile(runner(pg), name, read(file007));
    await applyFile(runner(pg), name, read(file007));
    expect((await pg.query("select id::int id, category, status, row_count from service_datasets order by id")).rows).toEqual([
      { id: 1, category: "atl-labs", status: "active", row_count: 9716 }, { id: 2, category: "atl-labs", status: "superseded", row_count: 5 },
    ]);
    expect((await pg.query("select count(*)::int n from service_dataset_rows")).rows).toEqual([{ n: 1 }]);
    const idx = (await pg.query("select indexname from pg_indexes where tablename='service_datasets'")).rows.map((r: any) => r.indexname);
    expect(idx).toContain("service_datasets_one_active_per_category");
    expect(idx).not.toContain("service_datasets_one_active");
    await pg.close();
  });
  it("refuses to run without a confirmed database name", async () => {
    const { pg } = await before007();
    await pg.query("select set_config('rv.expected_db', '', false)"); // forget the confirmation the earlier files used
    await expect(pg.exec(read(file007))).rejects.toThrow(/not set/);
    await pg.close();
  });
  it("the rollback puts back one-active-in-total and removes the column (it is guarded and not in the migrations folder)", async () => {
    const { pg, name } = await before007();
    await applyFile(runner(pg), name, read(file007));
    await pg.exec("insert into users (full_name,email,role,password_hash) values ('A','a@e.co','admin','x')");
    await pg.exec("insert into service_datasets (uploaded_by, original_filename, file_sha256, row_count, status, category) values (1,'a',repeat('a',64),1,'active','atl-labs'), (1,'s',repeat('b',64),1,'active','stem-labs')");
    // two categories are live: the old single-active index cannot hold them, so the rollback must fail and change nothing
    await expect(applyFile(runner(pg), name, read("db/rollback/007_down.sql"))).rejects.toThrow();
    expect((await pg.query("select column_name from information_schema.columns where table_name='service_datasets' and column_name='category'")).rows).toHaveLength(1);
    await pg.exec("update service_datasets set status='superseded' where category='stem-labs'");
    await applyFile(runner(pg), name, read("db/rollback/007_down.sql"));
    expect((await pg.query("select column_name from information_schema.columns where table_name='service_datasets' and column_name='category'")).rows).toHaveLength(0);
    expect((await pg.query("select indexname from pg_indexes where indexname='service_datasets_one_active'")).rows).toHaveLength(1);
    expect(pickFiles().map((f) => f.split(/[\\/]/).pop()).join()).not.toMatch(/down/);
    await pg.close();
  });
  it("the rollback refuses to run without the database confirmation", async () => {
    const { pg, name } = await before007();
    await applyFile(runner(pg), name, read(file007));
    await pg.query("select set_config('rv.expected_db', '', false)");
    await expect(pg.exec(read("db/rollback/007_down.sql"))).rejects.toThrow(/not set/);
    await pg.close();
  });
});

describe("data for the Service search box (aliases, counts, district/state text with a position)", () => {
  it("the categories API returns each service's aliases (the page has no list of its own) and the unique count", async () => {
    await goLive(ATL, "atl-labs");
    const body = await (await categories(new Request("http://localhost/api/services/categories"))).json();
    const by = Object.fromEntries(body.categories.map((c: any) => [c.slug, c]));
    expect(by["atl-labs"].aliases).toEqual(["atl", "atal tinkering", "tinkering"]);
    expect(by["robotics-labs"].aliases).toEqual(["robot", "robotics", "lab", "labs"]);
    expect(by["stem-labs"].aliases).toEqual(["stem", "science", "lab", "labs"]);
    expect(by["3d-printing-facilities"].aliases).toEqual(["3d", "printing", "printer"]);
    expect(by["robotics-training-centres"].aliases).toEqual(["robot", "training", "coaching"]);
    expect(by["innovation-centres"].aliases).toEqual(["innovation"]);
    expect(by["atl-labs"].count).toBe(3);
    expect(by["atl-labs"].isDemo).toBe(false);
    expect(by["stem-labs"].count).toBe(0);
  });
  it("a district or state text search needs no PIN code: matches by name, with each school's PIN code position when it is stored", async () => {
    await goLive(ATL, "atl-labs");
    await sql("INSERT INTO pincode_locations (pincode, lat, lng, source) VALUES ('522005', 16.3, 80.4, 'geonames')");
    const r = await get("?category=atl-labs&location=guntur&pageSize=50");
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2);
    expect(r.body.results.map((x: any) => x.schoolName)).toEqual(["Atl One", "Atl Two"]); // sorted by name
    expect(r.body.results.every((x: any) => x.lat === 16.3 && x.lng === 80.4)).toBe(true);
    const t = await get("?category=atl-labs&location=telangana");
    expect(t.body.results).toHaveLength(1);
    expect(t.body.results[0].lat).toBeNull(); // no stored position for 506002: listed, not pinned
    expect(t.body.near).toBeUndefined();
  });
  it("two words are both required (state + district), text that matches nothing is an empty list", async () => {
    await goLive(ATL, "atl-labs");
    expect((await get("?category=atl-labs&location=andhra%20guntur")).body.total).toBe(2);
    expect((await get("?category=atl-labs&location=andhra%20warangal")).body.total).toBe(0);
    expect((await get("?category=atl-labs&location=atlantis")).body.results).toEqual([]);
  });
});
