// Admin dashboard UI: layout and navigation, Overview, User management. Real SQL on the in-process database;
// the chart component is replaced by a plain element that exposes the exact data it was given.
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
  usePathname: () => "/admin/dashboard",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("../src/app/admin/_components/ChartsLoader", () => ({
  default: (p: { label: string; data: unknown; kind: string }) => <figure data-kind={p.kind} aria-label={p.label} data-json={JSON.stringify(p.data)} />,
}));

import AdminLayout from "../src/app/admin/layout";
import AdminDashboard from "../src/app/admin/dashboard/page";
import UsersPage from "../src/app/admin/users/page";
import { ADMIN_NAV, titleFor } from "../src/app/admin/_components/nav";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const signIn = (id: string, role = "admin") => { m.cookie = createSessionToken({ id, role }, false, Date.now(), { SESSION_SECRET: SECRET } as never).token; };
const html = async (node: Promise<React.ReactElement | null> | React.ReactElement | null) => renderToStaticMarkup((await node) as React.ReactElement);
const chartData = (h: string, label: string) => {
  const tag = h.match(new RegExp(`<figure[^>]*aria-label="${label}[^"]*"[^>]*>`))?.[0] ?? "";
  return JSON.parse((tag.match(/data-json="([^"]*)"/)?.[1] ?? "[]").replace(/&quot;/g, '"')) as Record<string, number | string>[];
};
let admin: { id: string };

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  m.cookie = undefined;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  admin = await seedUser({ email: "boss@robovalley.com", role: "admin", fullName: "The Boss" });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("admin layout and navigation", () => {
  it("lists all nine sections as working links, with the admin email and a sign-out button", async () => {
    signIn(admin.id);
    const h = await html(AdminLayout({ children: <p>PAGE BODY</p> }));
    expect(ADMIN_NAV).toHaveLength(9);
    for (const n of ADMIN_NAV) { expect(h).toContain(`href="${n.href}"`); expect(h).toContain(n.label.replace("&", "&amp;")); }
    for (const label of ["Overview", "Manage Categories", "Manage Datasets", "Upload Files", "Upload History", "Login Activity", "Reports &amp; Analytics", "User Management", "Settings"]) expect(h).toContain(label);
    expect(h).toContain("RoboValley");
    expect(h).toContain("boss@robovalley.com");
    expect(h).toContain("Sign out");
    expect(h).toContain("PAGE BODY");
    expect(h).toContain('aria-current="page"');
  });

  it("every nav entry points at a page that exists", async () => {
    const { existsSync } = await import("node:fs");
    for (const n of ADMIN_NAV) expect(existsSync(`src/app${n.href}/page.tsx`), n.href).toBe(true);
  });

  it("the top-bar title follows the page", () => {
    expect(titleFor("/admin/dashboard")).toBe("Overview");
    expect(titleFor("/admin/users")).toBe("User Management");
    expect(titleFor("/admin/datasets/anything")).toBe("Manage Datasets");
    expect(titleFor("/somewhere-else")).toBe("Admin");
  });

  it("sends an anonymous visitor to sign in and a regular user to their own dashboard, rendering nothing", async () => {
    await expect(AdminLayout({ children: <p>SECRET BODY</p> })).rejects.toThrow("REDIRECT:/login");
    const u = await seedUser({ email: "asha@example.com", role: "TC" });
    signIn(u.id, "TC");
    await expect(AdminLayout({ children: <p>SECRET BODY</p> })).rejects.toThrow("REDIRECT:/dashboard");
    signIn(u.id, "admin"); // a cookie that merely CLAIMS admin is not enough: the role is read from the database
    await expect(AdminLayout({ children: <p>SECRET BODY</p> })).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("hides the navigation and the page until a forced password change is done", async () => {
    await testDb().raw.query("update users set must_change_password = true where id = $1", [admin.id]);
    signIn(admin.id);
    const h = await html(AdminLayout({ children: <p>PAGE BODY</p> }));
    expect(h).toContain("Choose a new password");
    expect(h).not.toContain("PAGE BODY");
    expect(h).not.toContain('href="/admin/users"');
  });
});

describe("overview", () => {
  beforeEach(() => signIn(admin.id));

  it("counts real records, not made-up numbers", async () => {
    await seedUser({ email: "a@example.com", role: "ST" });
    await seedUser({ email: "b@example.com", role: "TC" });
    const h = await html(AdminDashboard());
    expect(h).toMatch(/Registered users<\/div><div class="val">2</); // the admin is not a "registered user"
    expect(h).toMatch(/Categories<\/div><div class="val">6</);
    expect(h).toMatch(/Datasets<\/div><div class="val">0</);
    expect(h).toMatch(/Uploaded files<\/div><div class="val">0</);
    expect(h).toContain("Nothing has been uploaded yet.");
    const regs = chartData(h, "New registrations per day");
    expect(regs).toHaveLength(30);
    expect(regs.reduce((n, d) => n + Number(d.registrations), 0)).toBe(2);
    const cats = chartData(h, "Number of datasets");
    expect(cats.map((c) => c.name)).toEqual(["ATL Labs", "Robotics Labs", "STEM Labs", "3D Printing Facilities", "Robotics Training Centres", "Innovation Centres"]);
    expect(cats.every((c) => c.datasets === 0)).toBe(true);
  });

  it("counts datasets and accepted uploads per category and lists recent uploads", async () => {
    const q = (s: string, p: unknown[] = []) => testDb().raw.query(s, p);
    await q(`insert into service_datasets (uploaded_by, original_filename, file_sha256, row_count, status, category, activated_at)
             values ($1,'atl.xlsx',repeat('a',64),120,'active','atl-labs',now()), ($1,'old.xlsx',repeat('b',64),90,'superseded','atl-labs',now()),
                    ($1,'stem.xlsx',repeat('c',64),40,'active','stem-labs',now()), ($1,'draft.xlsx',repeat('d',64),5,'staged','stem-labs',null)`, [admin.id]);
    await q(`insert into upload_audit_log (user_id, action, result, filename) values ($1,'upload','success','atl.xlsx'), ($1,'upload','rejected','bad.xlsx'), ($1,'confirm','success','atl.xlsx')`, [admin.id]);
    const h = await html(AdminDashboard());
    expect(h).toMatch(/Datasets<\/div><div class="val">3</); // active + superseded; the staged draft is not a dataset yet
    expect(h).toContain("2 with live data");
    expect(h).toMatch(/Uploaded files<\/div><div class="val">1</);
    expect(h).toContain("atl.xlsx");
    expect(h).toContain("bad.xlsx");
    expect(h).toContain("Rejected");
    const cats = chartData(h, "Number of datasets");
    expect(cats.find((c) => c.name === "ATL Labs")?.datasets).toBe(2);
    expect(cats.find((c) => c.name === "STEM Labs")?.datasets).toBe(1);
    const up = chartData(h, "Uploads per day");
    expect(up.reduce((n, d) => n + Number(d.accepted), 0)).toBe(1);
    expect(up.reduce((n, d) => n + Number(d.rejected), 0)).toBe(1);
  });

  it("shows sign-in activity from login_events, with no e-mail address in it", async () => {
    const u = await seedUser({ email: "private.person@example.com", role: "ST" });
    await testDb().raw.query(`insert into login_events (event_type, user_id) values ('login_success',$1), ('login_failed',$1), ('login_failed',null)`, [u.id]);
    const h = await html(AdminDashboard());
    expect(h).toContain("Signed in");
    expect(h).toContain("Failed sign-in");
    expect(h).not.toContain("private.person@example.com");
    const logins = chartData(h, "Sign-ins per day");
    expect(logins.reduce((n, d) => n + Number(d.success), 0)).toBe(1);
    expect(logins.reduce((n, d) => n + Number(d.failed), 0)).toBe(2);
  });

  it("shows a clear setup notice, not an error, while migration 008 has not been applied", async () => {
    const q = (sql: string) => testDb().raw.query(sql);
    await q("alter table login_events rename to login_events_hidden"); // the harness is shared, so put it back afterwards
    let h: string;
    try { h = await html(AdminDashboard()); } finally { await q("alter table login_events_hidden rename to login_events"); }
    expect(h).toContain("Sign-in activity is not set up yet");
    expect(h).toContain("migration 008");
    expect(h).toMatch(/Registered users/);
  });

  it("the period buttons change the chart length, and junk values fall back to 30 days", async () => {
    expect(chartData(await html(AdminDashboard({ searchParams: Promise.resolve({ range: "7" }) })), "New registrations per day")).toHaveLength(7);
    expect(chartData(await html(AdminDashboard({ searchParams: Promise.resolve({ range: "90" }) })), "New registrations per day")).toHaveLength(90);
    expect(chartData(await html(AdminDashboard({ searchParams: Promise.resolve({ range: "9999" }) })), "New registrations per day")).toHaveLength(30);
    expect(chartData(await html(AdminDashboard({ searchParams: Promise.resolve({ range: "1; drop table users" }) })), "New registrations per day")).toHaveLength(30);
  });

  it("shows an error message (not a crash) when the database fails", async () => {
    const { makeFakePool, pgError } = await import("./helpers");
    makeFakePool((sql) => (sql.includes("service_datasets") ? pgError("57P01") : undefined)); // only the data queries fail; the sign-in check still works
    const h = await html(AdminDashboard());
    expect(h).toContain("could not be loaded");
  });
});

describe("user management", () => {
  beforeEach(() => signIn(admin.id));

  it("lists accounts read-only without any secret column", async () => {
    await seedUser({ email: "a@example.com", role: "ST", fullName: "Anil Kumar", password: "Sup3rSecretPw!" });
    const h = await html(UsersPage());
    expect(h).toContain("Anil Kumar");
    expect(h).toContain("a@example.com");
    expect(h).toContain("Student");
    expect(h).toContain("Administrator");
    expect(h).not.toContain("Sup3rSecretPw!");
    expect(h).not.toContain("$2"); // no bcrypt hash
    expect(h).not.toContain("9876543210"); // no phone number
    expect(h).not.toMatch(/<button[^>]*>(Delete|Edit|Promote)/);
  });

  it("searches, filters by role and treats % and _ as plain characters", async () => {
    await seedUser({ email: "anil@example.com", role: "ST", fullName: "Anil" });
    await seedUser({ email: "bela@example.com", role: "TC", fullName: "Bela" });
    const search = (sp: object) => html(UsersPage({ searchParams: Promise.resolve(sp) }));
    const byQ = await search({ q: "bela" });
    expect(byQ).toContain("bela@example.com"); expect(byQ).not.toContain("anil@example.com");
    const byRole = await search({ role: "ST" });
    expect(byRole).toContain("anil@example.com"); expect(byRole).not.toContain("bela@example.com");
    expect(await search({ q: "%" })).toContain("No accounts match.");
    expect(await search({ q: "_" })).toContain("No accounts match.");
    expect(await search({ role: "not-a-role' OR 1=1 --" })).toContain("anil@example.com"); // unknown role ignored, never reaches SQL
  });

  it("pages through large lists", async () => {
    for (let i = 0; i < 30; i++) await seedUser({ email: `u${String(i).padStart(2, "0")}@example.com`, role: "ST", fullName: `User ${i}` });
    const p1 = await html(UsersPage());
    expect(p1).toContain("Page 1 of 2");
    expect(p1).toContain("Next →");
    const p2 = await html(UsersPage({ searchParams: Promise.resolve({ page: "2" }) }));
    expect(p2).toContain("Page 2 of 2");
    expect(p2).toContain("← Previous");
    expect(await html(UsersPage({ searchParams: Promise.resolve({ page: "999" }) }))).toContain("Page 2 of 2"); // clamped
  });

  it("refuses anonymous visitors and regular users", async () => {
    m.cookie = undefined;
    await expect(UsersPage()).rejects.toThrow("REDIRECT:/login");
    const u = await seedUser({ email: "x@example.com", role: "ST" });
    signIn(u.id, "ST");
    await expect(UsersPage()).rejects.toThrow("REDIRECT:/dashboard");
  });
});
