// Admin Categories and Datasets pages (stage 3). They must keep the one-live-dataset-PER-CATEGORY design.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";
import { createSessionToken } from "../src/lib/session";

const m = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "rv_session" && m.cookie ? { name: n, value: m.cookie } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error("REDIRECT:" + to); },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import CategoriesPage from "../src/app/admin/categories/page";
import DatasetsPage from "../src/app/admin/datasets/page";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const signIn = (id: string, role = "admin") => { m.cookie = createSessionToken({ id, role }, false, Date.now(), { SESSION_SECRET: SECRET } as never).token; };
const html = async (n: Promise<React.ReactElement | null>) => renderToStaticMarkup((await n) as React.ReactElement);
const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p);
let admin: { id: string };

async function dataset(file: string, category: string, status: string, rows = 10, ageHours = 0) {
  await q(`insert into service_datasets (uploaded_by, original_filename, file_sha256, row_count, status, category, uploaded_at, activated_at)
           values ($1,$2,repeat('a',64),$3,$4::varchar(20),$5, now() - ($6 || ' hours')::interval, case when $4::varchar(20) = 'active' then now() end)`, [admin.id, file, rows, status, category, String(ageHours)]);
}

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  m.cookie = undefined;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  admin = await seedUser({ email: "boss@robovalley.com", role: "admin" });
  signIn(admin.id);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("categories page", () => {
  it("shows all six categories, even those with no data", async () => {
    const h = await html(CategoriesPage());
    for (const n of ["ATL Labs", "Robotics Labs", "STEM Labs", "3D Printing Facilities", "Robotics Training Centres", "Innovation Centres"]) expect(h).toContain(n);
    expect((h.match(/No live data/g) ?? []).length).toBe(6);
  });

  it("shows a separate live dataset for each category (not one global active dataset)", async () => {
    await dataset("atl-2025.xlsx", "atl-labs", "active", 500);
    await dataset("atl-2024.xlsx", "atl-labs", "superseded", 400);
    await dataset("stem.xlsx", "stem-labs", "active", 70);
    await dataset("draft.xlsx", "robotics-labs", "staged", 9);
    const h = await html(CategoriesPage());
    expect(h).toContain("atl-2025.xlsx");
    expect(h).toContain("stem.xlsx");
    expect(h).not.toContain("atl-2024.xlsx"); // only the live file is named; older ones are on the datasets page
    expect(h).toContain("500");
    expect((h.match(/>Live</g) ?? []).length).toBe(2);
    expect((h.match(/No live data/g) ?? []).length).toBe(4);
    expect(h).toContain("1 awaiting confirmation");
    expect(h).toContain('href="/admin/datasets?category=atl-labs"');
    expect(h).toContain('href="/admin/upload?category=stem-labs"');
  });

  it("offers no way to add, rename or remove a category", async () => {
    const h = await html(CategoriesPage());
    expect(h).not.toMatch(/<form|<input|Add category|Delete|Rename/i);
  });

  it("refuses visitors and regular users", async () => {
    m.cookie = undefined;
    await expect(CategoriesPage()).rejects.toThrow("REDIRECT:/login");
    const u = await seedUser({ email: "t@example.com", role: "TC" });
    signIn(u.id, "TC");
    await expect(CategoriesPage()).rejects.toThrow("REDIRECT:/dashboard");
  });
});

describe("datasets page", () => {
  beforeEach(async () => {
    await dataset("atl-live.xlsx", "atl-labs", "active");
    await dataset("atl-old.xlsx", "atl-labs", "superseded");
    await dataset("stem-live.xlsx", "stem-labs", "active");
    await dataset("fresh-draft.xlsx", "stem-labs", "staged", 5, 1);
    await dataset("stale-draft.xlsx", "stem-labs", "staged", 5, 30);
    await dataset("thrown-away.xlsx", "atl-labs", "discarded");
  });
  const page = (sp: object = {}) => html(DatasetsPage({ searchParams: Promise.resolve(sp) }));

  it("lists every kept version with its status and hides discarded ones", async () => {
    const h = await page();
    for (const f of ["atl-live.xlsx", "atl-old.xlsx", "stem-live.xlsx", "fresh-draft.xlsx", "stale-draft.xlsx"]) expect(h).toContain(f);
    expect(h).not.toContain("thrown-away.xlsx");
    expect(h).toContain("boss@robovalley.com");
  });

  it("filters by category and by status", async () => {
    const stem = await page({ category: "stem-labs" });
    expect(stem).toContain("stem-live.xlsx"); expect(stem).not.toContain("atl-live.xlsx");
    const old = await page({ category: "atl-labs", status: "superseded" });
    expect(old).toContain("atl-old.xlsx"); expect(old).not.toContain("atl-live.xlsx");
  });

  it("ignores unknown filter values instead of passing them to the database", async () => {
    const h = await page({ category: "x' OR 1=1 --", status: "discarded" });
    expect(h).toContain("atl-live.xlsx");
    expect(h).not.toContain("thrown-away.xlsx");
  });

  it("offers Make live only for a fresh staged dataset, and marks an old one expired", async () => {
    const h = await page();
    expect((h.match(/Make live/g) ?? []).length).toBe(1);
    expect(h).toContain("Expired");
  });

  it("shows an empty state when nothing matches", async () => {
    await q("delete from service_datasets");
    expect(await page()).toContain("No datasets here yet");
  });

  it("refuses visitors and regular users", async () => {
    m.cookie = undefined;
    await expect(DatasetsPage()).rejects.toThrow("REDIRECT:/login");
    const u = await seedUser({ email: "t@example.com", role: "ST" });
    signIn(u.id, "ST");
    await expect(DatasetsPage()).rejects.toThrow("REDIRECT:/dashboard");
  });
});
