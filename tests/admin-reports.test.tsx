// Stages 6-7: Reports, Settings, and the rules for how charts are loaded.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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
vi.mock("../src/app/admin/_components/ChartsLoader", () => ({
  default: (p: { label: string; data: unknown; kind: string; series: unknown }) => <figure data-kind={p.kind} aria-label={p.label} data-json={JSON.stringify(p.data)} data-series={JSON.stringify(p.series)} />,
}));

import ReportsPage from "../src/app/admin/reports/page";
import SettingsPage from "../src/app/admin/settings/page";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const tokenFor = (id: string, role: string) => createSessionToken({ id, role }, false, Date.now(), { SESSION_SECRET: SECRET } as never).token;
const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p);
const html = async (n: Promise<React.ReactElement | null>) => renderToStaticMarkup((await n) as React.ReactElement);
const chart = (h: string, label: string) => {
  const tag = h.match(new RegExp(`<figure[^>]*aria-label="${label}[^"]*"[^>]*>`))?.[0] ?? "";
  return JSON.parse((tag.match(/data-json="([^"]*)"/)?.[1] ?? "[]").replace(/&quot;/g, '"')) as Record<string, number | string>[];
};
const total = (rows: Record<string, number | string>[], k: string) => rows.reduce((n, r) => n + Number(r[k]), 0);
let admin: { id: string };

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  admin = await seedUser({ email: "boss@robovalley.com", role: "admin", fullName: "The Boss" });
  m.cookie = tokenFor(admin.id, "admin");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("reports page", () => {
  const page = (sp: object = {}) => html(ReportsPage({ searchParams: Promise.resolve(sp) }));

  it("reports only what is in the database, for the chosen period", async () => {
    const a = await seedUser({ email: "a@example.com", role: "ST" });
    await seedUser({ email: "b@example.com", role: "ST" });
    await seedUser({ email: "c@example.com", role: "TC" });
    await q("update users set created_at = now() - interval '45 days' where email = 'c@example.com'");
    await q(`insert into login_events (event_type, user_id, created_at) values ('login_success',$1,now()), ('login_success',$1,now() - interval '3 days'), ('login_failed',null,now()),
             ('login_success',$1,now() - interval '60 days'), ('otp_sent',null,now()), ('otp_verified',null,now()), ('otp_failed',null,now())`, [a.id]);
    await q("insert into upload_audit_log (user_id, action, result, filename) values ($1,'upload','success','x.xlsx'), ($1,'upload','rejected','y.xlsx')", [admin.id]);

    const h = await page({ range: "30" });
    expect(total(chart(h, "New registrations per day"), "registrations")).toBe(2); // the 45-day-old account is outside 30 days; the admin is not counted
    expect(total(chart(h, "Logins per day"), "success")).toBe(2); // the 60-day-old event is outside
    expect(total(chart(h, "Logins per day"), "failed")).toBe(1);
    const otp = chart(h, "One-time codes per day");
    expect([total(otp, "sent"), total(otp, "verified"), total(otp, "failed")]).toEqual([1, 1, 1]);
    const up = chart(h, "Uploads per day");
    expect([total(up, "accepted"), total(up, "rejected")]).toEqual([1, 1]);
    expect(chart(h, "Number of accounts for each role").map((r) => r.label)).toEqual(expect.arrayContaining(["Student", "Teacher / lab in-charge", "Administrator"]));

    const wide = await page({ range: "90" });
    expect(total(chart(wide, "New registrations per day"), "registrations")).toBe(3);
    expect(total(chart(wide, "Logins per day"), "success")).toBe(3);
    expect(chart(wide, "New registrations per day")).toHaveLength(90);
  });

  it("shows zeros, not invented numbers, on an empty system", async () => {
    const h = await page();
    expect(total(chart(h, "New registrations per day"), "registrations")).toBe(0);
    expect(total(chart(h, "Logins per day"), "success")).toBe(0);
    expect(h).toMatch(/New registrations<\/div><div class="val">0</);
    expect(h).toMatch(/Uploads accepted<\/div><div class="val">0</);
  });

  it("lists every category with its live rows", async () => {
    await q(`insert into service_datasets (uploaded_by, original_filename, file_sha256, row_count, status, category, activated_at)
             values ($1,'s.xlsx',repeat('a',64),321,'active','stem-labs',now())`, [admin.id]);
    const h = await page();
    expect(h).toMatch(/STEM Labs<\/td><td>1<\/td><td>321<\/td>/);
    expect((h.match(/No live data/g) ?? []).length).toBe(5);
    const cats = chart(h, "Number of datasets in each category");
    expect(cats).toHaveLength(6);
  });

  it("falls back to 30 days for junk periods", async () => {
    expect(await page({ range: "1' OR '1'='1" })).toContain("last 30 days");
    expect(await page({ range: "7" })).toContain("last 7 days");
  });

  it("shows setup notices instead of login and OTP charts while migration 008 is missing", async () => {
    await q("alter table login_events rename to login_events_hidden");
    let h: string;
    try { h = await page(); } finally { await q("alter table login_events_hidden rename to login_events"); }
    expect(h).toContain("Login reports is not set up yet");
    expect(h).toContain("One-time code reports is not set up yet");
    expect(h).toContain("Needs migration 008");
    expect(total(chart(h, "New registrations per day"), "registrations")).toBe(0);
  });

  it("is closed to visitors and regular users", async () => {
    m.cookie = undefined;
    await expect(page()).rejects.toThrow("REDIRECT:/login");
    const u = await seedUser({ email: "t@example.com", role: "SA" });
    m.cookie = tokenFor(u.id, "SA");
    await expect(page()).rejects.toThrow("REDIRECT:/dashboard");
  });
});

describe("settings page", () => {
  it("shows the account, the feature status and a password form, with no secrets", async () => {
    const h = await html(SettingsPage());
    expect(h).toContain("The Boss");
    expect(h).toContain("boss@robovalley.com");
    expect(h).toContain("Administrator");
    expect(h).toContain("Change your password");
    expect(h.toLowerCase()).toContain('autocomplete="current-password"');
    expect(h).toContain('id="profile"');
    expect(h).toContain('id="database-setup"');
    expect((h.match(/>Applied</g) ?? []).length).toBe(18);
    expect(h).toContain("Everything is applied");
    expect(h).not.toContain("For the developer");
    expect(h).not.toMatch(/password_hash|SESSION_SECRET|DATABASE_URL/);
  });

  it("lists the migrations that are not applied, what they affect, and the developer steps, without any SQL or database error", async () => {
    await q("alter table upload_attachments rename to upload_attachments_hidden"); // shared harness: put it back below
    let h: string;
    try { h = await html(SettingsPage()); } finally { await q("alter table upload_attachments_hidden rename to upload_attachments"); }
    expect(h).toContain("Partly applied");
    expect(h).toContain("Stored files, downloads and richer upload history");
    expect(h).toContain("For the developer: applying 009");
    expect(h).toContain("--only 009 --apply");
    expect(h).toContain("--status");
    expect(h).not.toMatch(/relation|syntax error|SELECT |pg_/i);
    expect(h).not.toContain("--only 008"); // only what is actually pending
  });

  it("says plainly when the database structure cannot be checked", async () => {
    const { makeFakePool, pgError } = await import("./helpers");
    makeFakePool((sql) => (sql.includes("information_schema") ? pgError("57P01") : undefined));
    const h = await html(SettingsPage());
    expect(h).toContain("could not be checked");
    expect(h).not.toContain("57P01");
  });

  it("is closed to visitors and regular users", async () => {
    m.cookie = undefined;
    await expect(SettingsPage()).rejects.toThrow("REDIRECT:/login");
    const u = await seedUser({ email: "t@example.com", role: "TC" });
    m.cookie = tokenFor(u.id, "TC");
    await expect(SettingsPage()).rejects.toThrow("REDIRECT:/dashboard");
  });
});

describe("every admin page guards itself, and charts load on demand", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const files = walk("src/app/admin").map((p) => p.replace(/\\/g, "/"));

  it("every page.tsx calls requireAdminPage (layouts are not re-run between pages)", () => {
    const pages = files.filter((f) => f.endsWith("/page.tsx"));
    expect(pages.length).toBe(9);
    for (const p of pages) expect(readFileSync(p, "utf8"), p).toContain("requireAdminPage()");
  });

  it("every admin API route calls requireAdmin before doing anything else", () => {
    const routes = walk("src/app/api/admin").map((p) => p.replace(/\\/g, "/")).filter((f) => f.endsWith("/route.ts"));
    expect(routes.length).toBeGreaterThanOrEqual(3);
    for (const r of routes) expect(readFileSync(r, "utf8"), r).toContain("await requireAdmin(req)");
  });

  it("only Charts.tsx imports Recharts, and it is reached through next/dynamic", () => {
    const offenders = files.filter((f) => /\.(tsx?|jsx?)$/.test(f) && readFileSync(f, "utf8").includes('from "recharts"')).map((f) => f.split("/").pop());
    expect(offenders).toEqual(["Charts.tsx"]);
    const loader = readFileSync("src/app/admin/_components/ChartsLoader.tsx", "utf8");
    expect(loader).toContain("dynamic(() => import(\"./Charts\")");
    expect(loader).toContain("ssr: false");
    for (const f of files.filter((f) => f.endsWith("/page.tsx") && /(dashboard|reports)\//.test(f))) expect(readFileSync(f, "utf8"), f).toContain("ChartsLoader");
  });
});
