// Admin authorization (requireAdmin / getAdminContext), the /admin/dashboard guard, the change-password API and the
// admin sign-in redirect. Real SQL on the in-process database (tests/helpers.ts); no real database or email.
import bcrypt from "bcryptjs";
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

import { requireAdmin } from "../src/lib/admin";
import AdminDashboard from "../src/app/admin/dashboard/page";
import { POST as changePassword } from "../src/app/api/admin/change-password/route";
import { POST as login } from "../src/app/api/auth/login/route";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const PW = "correct horse";
const tokenFor = (id: string, role: string) => createSessionToken({ id, role }, false, Date.now(), { SESSION_SECRET: SECRET } as never).token;
const signIn = (id: string, role = "admin") => { m.cookie = tokenFor(id, role); };
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost" + url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const setFlag = (id: string, v: boolean) => testDb().raw.query("update users set must_change_password = $2 where id = $1", [id, v]);
let logs: string[];

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  m.cookie = undefined;
  logs = [];
  for (const fn of ["log", "error", "warn", "info"] as const) vi.spyOn(console, fn).mockImplementation((...a) => void logs.push(a.map(String).join(" ")));
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("requireAdmin", () => {
  it("401 without a session, 401 for a forged or tampered cookie", async () => {
    let r = await requireAdmin();
    expect(r.response?.status).toBe(401);
    const a = await seedUser({ email: "admin@robovalley.com", role: "admin" });
    m.cookie = tokenFor(a.id, "admin").slice(0, -3) + "AAA";
    r = await requireAdmin();
    expect(r.response?.status).toBe(401);
  });

  it("recognises the first admin (admin@robovalley.com)", async () => {
    const a = await seedUser({ email: "admin@robovalley.com", role: "admin" });
    signIn(a.id);
    const r = await requireAdmin();
    expect(r.admin?.email).toBe("admin@robovalley.com");
  });

  it("recognises the second admin even though the email does not start with 'admin'", async () => {
    const b = await seedUser({ email: "yasaswinipilla41@gmail.com", role: "admin" });
    signIn(b.id);
    const r = await requireAdmin();
    expect(r.admin?.email).toBe("yasaswinipilla41@gmail.com");
  });

  it("403 for a regular user, even one whose email starts with 'admin'", async () => {
    const u = await seedUser({ email: "admin.fan@example.com", role: "ST" });
    signIn(u.id, "ST");
    const r = await requireAdmin();
    expect(r.response?.status).toBe(403);
  });

  it("the role is read from the database, never from the cookie", async () => {
    const u = await seedUser({ email: "x@example.com", role: "ST" });
    signIn(u.id, "admin"); // a (validly signed) cookie that CLAIMS admin
    expect((await requireAdmin()).response?.status).toBe(403);
    const a = await seedUser({ email: "real@example.com", role: "admin" });
    signIn(a.id, "ST"); // cookie claims a regular role, database says admin
    expect((await requireAdmin()).admin?.id).toBe(a.id);
  });

  it("a demoted admin loses access immediately", async () => {
    const a = await seedUser({ email: "admin@robovalley.com", role: "admin" });
    signIn(a.id);
    expect((await requireAdmin()).admin?.id).toBe(a.id);
    await testDb().raw.query("update users set role = 'TC' where id = $1", [a.id]);
    expect((await requireAdmin()).response?.status).toBe(403);
  });

  it("403 for a cross-origin browser request, even from an admin", async () => {
    const a = await seedUser({ email: "admin@robovalley.com", role: "admin" });
    signIn(a.id);
    const r = await requireAdmin(post("/x", {}, { origin: "http://evil.example", host: "localhost" }));
    expect(r.response?.status).toBe(403);
  });
});

describe("/admin/dashboard", () => {
  it("sends an anonymous visitor to sign in", async () => {
    await expect(AdminDashboard()).rejects.toThrow("REDIRECT:/login");
  });

  it("sends a signed-in non-admin to their normal page and renders nothing admin", async () => {
    const u = await seedUser({ email: "asha@example.com", role: "TC" });
    signIn(u.id, "TC");
    await expect(AdminDashboard()).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("shows an admin the dashboard with their email and a sign-out button", async () => {
    const a = await seedUser({ email: "yasaswinipilla41@gmail.com", role: "admin" });
    signIn(a.id);
    const html = renderToStaticMarkup(await AdminDashboard());
    expect(html).toContain("Admin dashboard");
    expect(html).toContain("yasaswinipilla41@gmail.com");
    expect(html).toContain("Sign out");
    expect(html).not.toContain("Choose a new password");
  });

  it("shows the change-password step first when must_change_password is set", async () => {
    const a = await seedUser({ email: "admin@robovalley.com", role: "admin" });
    await setFlag(a.id, true);
    signIn(a.id);
    const html = renderToStaticMarkup(await AdminDashboard());
    expect(html).toContain("Choose a new password");
    expect(html.toLowerCase()).toContain('autocomplete="current-password"');
    expect(html.toLowerCase()).toContain('autocomplete="new-password"');
    expect(html).not.toContain("Admin tools will appear here");
  });
});

describe("POST /api/admin/change-password", () => {
  const call = (body: unknown, headers?: Record<string, string>) => changePassword(post("/api/admin/change-password", body, headers));

  it("401 without a session, 403 for a non-admin", async () => {
    expect((await call({ currentPassword: PW, newPassword: "a brand new pass" })).status).toBe(401);
    const u = await seedUser({ email: "asha@example.com", role: "TC" });
    signIn(u.id, "TC");
    expect((await call({ currentPassword: PW, newPassword: "a brand new pass" })).status).toBe(403);
    const row = (await testDb().raw.query("select password_hash from users where id = $1", [u.id])).rows[0] as any;
    expect(await bcrypt.compare(PW, row.password_hash)).toBe(true); // untouched
  });

  it("changes the password, clears the flag, and the new password works for login", async () => {
    const a = await seedUser({ email: "admin@robovalley.com", role: "admin" });
    await setFlag(a.id, true);
    signIn(a.id);
    const res = await call({ currentPassword: PW, newPassword: "a brand new pass" });
    expect(res.status).toBe(200);
    const row = (await testDb().raw.query("select password_hash, must_change_password from users where id = $1", [a.id])).rows[0] as any;
    expect(row.must_change_password).toBe(false);
    expect(await bcrypt.compare("a brand new pass", row.password_hash)).toBe(true);
    expect(await bcrypt.compare(PW, row.password_hash)).toBe(false);
    const li = await login(post("/api/auth/login", { email: "admin@robovalley.com", password: "a brand new pass" }));
    expect(li.status).toBe(200);
  });

  it("rejects a wrong current password, a weak or unchanged new password, and bad input", async () => {
    const a = await seedUser({ email: "admin@robovalley.com", role: "admin" });
    await setFlag(a.id, true);
    signIn(a.id);
    expect((await call({ currentPassword: "nope nope nope", newPassword: "a brand new pass" })).status).toBe(401);
    expect((await call({ currentPassword: PW, newPassword: "short" })).status).toBe(400);
    expect((await call({ currentPassword: PW, newPassword: PW })).status).toBe(400);
    expect((await call({ currentPassword: PW, newPassword: "x".repeat(80) })).status).toBe(400);
    expect((await call({ currentPassword: PW })).status).toBe(400);
    const row = (await testDb().raw.query("select must_change_password from users where id = $1", [a.id])).rows[0] as any;
    expect(row.must_change_password).toBe(true); // nothing changed
  });

  it("never logs a password or hash", async () => {
    const a = await seedUser({ email: "admin@robovalley.com", role: "admin" });
    signIn(a.id);
    await call({ currentPassword: "wrong wrong wrong", newPassword: "a brand new pass" });
    await call({ currentPassword: PW, newPassword: "a brand new pass" });
    expect(logs.join("\n")).not.toMatch(/a brand new pass|wrong wrong wrong|correct horse|\$2[aby]\$/);
  });
});

describe("admin sign-in", () => {
  it("login returns /admin/dashboard for an admin and /dashboard for everyone else", async () => {
    await seedUser({ email: "admin@robovalley.com", role: "admin" });
    await seedUser({ email: "asha@example.com", role: "TC" });
    const a = await (await login(post("/api/auth/login", { email: "admin@robovalley.com", password: PW }))).json();
    expect(a).toMatchObject({ success: true, redirectTo: "/admin/dashboard", user: { role: "admin" } });
    const t = await (await login(post("/api/auth/login", { email: "asha@example.com", password: PW }))).json();
    expect(t).toMatchObject({ success: true, redirectTo: "/dashboard" });
  });

  it("self-signup can never create an admin", async () => {
    const { POST: signup } = await import("../src/app/api/auth/signup/route");
    const res = await signup(post("/api/auth/signup", {
      role: "admin", fullName: "Eve", mobile: "9876543210", email: "eve@example.com", password: "longenough1", confirmPassword: "longenough1",
      district: "Guntur", language: "English", ageCategory: "adult", consents: { privacy: true, terms: true }, profileSkipped: true, verification: {},
    }));
    expect(res.status).toBe(400);
    expect(((await testDb().raw.query("select count(*)::int c from users")).rows[0] as any).c).toBe(0);
  });
});
