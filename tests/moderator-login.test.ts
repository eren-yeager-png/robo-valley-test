// Item 4: moderators. They land on the Admin Portal when they sign in, a dedicated moderator account has no member dashboard, a temporary
// password must be changed before anything else, and nothing admin is reachable by URL (pages redirect, APIs answer 403).
// In-process database with the real migrations and routes; no real database.
import bcrypt from "bcryptjs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
const who: { user: { id: string; fullName: string; email: string; role: string } | null } = { user: null };
vi.mock("../src/lib/currentUser", () => ({ getCurrentUser: async () => who.user, firstNameOf: () => "Someone" }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error("REDIRECT:" + to); }, useRouter: () => ({ refresh() {}, replace() {}, push() {} }), usePathname: () => "/admin/dashboard", notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "app.example.test" }), cookies: async () => ({ get: () => undefined }) }));

import { POST as login } from "../src/app/api/auth/login/route";
import LoginPage from "../src/app/login/page";
import { getDashboardContext } from "../src/lib/dashboardContext";
import { requireReviewerPage } from "../src/lib/reviewerPage";
import { GET as queue } from "../src/app/api/review/queue/route";
import { POST as changePassword } from "../src/app/api/review/change-password/route";
import ChangePasswordPage from "../src/app/moderation/change-password/page";
import { MODERATOR_ROLE, REVIEWER_HOME, reviewerLanding } from "../src/lib/reviewerHome";

const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
const PASSWORD = "correct horse";
let seq = 0, ipn = 0;
const ip = () => `55.${Math.floor(++ipn / 250)}.${ipn % 250}.1`;
async function person(role: string, opts: { moderator?: boolean; mustChange?: boolean } = {}) {
  const u = await seedUser({ email: `m${++seq}@example.com`, role, fullName: `Person${seq} Name` });
  if (opts.moderator) await q("UPDATE users SET is_moderator = true WHERE id = $1", [u.id]);
  if (opts.mustChange) await q("UPDATE users SET must_change_password = true WHERE id = $1", [u.id]);
  return { id: Number(u.id), email: `m${seq}@example.com`, role };
}
const signIn = (p: { id: number; email: string; role: string } | null) => { who.user = p ? { id: String(p.id), fullName: "Someone", email: p.email, role: p.role } : null; };
const post = (url: string, body: unknown) => new Request("http://localhost" + url, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify(body) });
const get = (url: string) => new Request("http://localhost" + url, { headers: { "x-forwarded-for": ip() } });
const redirectOf = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { const m = /^REDIRECT:(.*)$/.exec(String((e as Error).message)); if (m) return m[1]; throw e; } };

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", "unit-test-secret-unit-test-secret-1234");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await q("DELETE FROM api_rate_limits"); await q("DELETE FROM login_attempts").catch(() => undefined);
  signIn(null);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("signing in", () => {
  it("a moderator (a member account with the flag, or a dedicated moderator account) is sent to the Admin Portal", async () => {
    for (const m of [await person("TC", { moderator: true }), await person(MODERATOR_ROLE, { moderator: true })]) {
      const res = await login(post("/api/auth/login", { email: m.email, password: PASSWORD }));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.redirectTo).toBe("/moderation"); expect(body.reviewer).toBe(true);
    }
  });
  it("administrators and members keep their own landing (the website); nothing says reviewer", async () => {
    for (const p of [await person("admin"), await person("ST")]) {
      const body = await (await login(post("/api/auth/login", { email: p.email, password: PASSWORD }))).json();
      expect(body.redirectTo).toBe("https://techytree.in/"); expect(body.reviewer).toBeUndefined();
    }
  });
  it("a dedicated moderator account whose flag was removed is not sent to the portal (and gets no access there)", async () => {
    const m = await person(MODERATOR_ROLE);
    expect(await reviewerLanding(testDb().raw as never, m.id, m.role)).toBeNull();
    expect((await (await login(post("/api/auth/login", { email: m.email, password: PASSWORD }))).json()).reviewer).toBeUndefined();
  });
  it("an already signed-in moderator who opens the sign-in page goes straight to the portal", async () => {
    const m = await person("TC", { moderator: true }); signIn(m);
    expect(await redirectOf(LoginPage({ searchParams: Promise.resolve({}) }) as Promise<unknown>)).toBe(REVIEWER_HOME);
  });
  it("a dedicated moderator account has no member dashboard: /dashboard sends it to the portal; without the flag it does not loop", async () => {
    const m = await person(MODERATOR_ROLE, { moderator: true }); signIn(m);
    expect(await redirectOf(getDashboardContext())).toBe("/moderation");
    const plain = await person(MODERATOR_ROLE); signIn(plain);
    expect((await getDashboardContext()).status).toBe("unknown-role");
    const member = await person("TC", { moderator: true }); signIn(member); // a member with the flag keeps their member dashboard
    expect((await getDashboardContext()).status).toBe("ok");
  });
});

describe("a temporary password must be changed first", () => {
  it("pages: every reviewing page is sent to the change-password page; that page and the layout are allowed", async () => {
    const m = await person(MODERATOR_ROLE, { moderator: true, mustChange: true }); signIn(m);
    expect(await redirectOf(requireReviewerPage())).toBe("/moderation/change-password");
    expect((await requireReviewerPage({ passwordChange: true })).mustChangePassword).toBe(true);
    expect(await redirectOf(ChangePasswordPage() as Promise<unknown>)).toBeNull();
  });
  it("APIs: reviewing routes answer 403 PASSWORD_CHANGE_REQUIRED until it is changed", async () => {
    const m = await person(MODERATOR_ROLE, { moderator: true, mustChange: true }); signIn(m);
    const r = await queue(get("/api/review/queue"));
    expect(r.status).toBe(403); expect((await r.json()).error).toBe("PASSWORD_CHANGE_REQUIRED");
  });
  it("change-password: checks the current password and the rules, then clears the flag; the new password signs in and the portal opens", async () => {
    const m = await person(MODERATOR_ROLE, { moderator: true, mustChange: true }); signIn(m);
    expect((await changePassword(post("/api/review/change-password", { currentPassword: "wrong one", newPassword: "a brand new pass" }))).status).toBe(401);
    expect((await changePassword(post("/api/review/change-password", { currentPassword: PASSWORD, newPassword: "short" }))).status).toBe(400);
    expect((await changePassword(post("/api/review/change-password", { currentPassword: PASSWORD, newPassword: PASSWORD }))).status).toBe(400);
    const ok = await changePassword(post("/api/review/change-password", { currentPassword: PASSWORD, newPassword: "a brand new pass" }));
    expect(ok.status).toBe(200);
    const row = (await q("SELECT password_hash, must_change_password FROM users WHERE id = $1", [m.id])).rows[0] as any;
    expect(row.must_change_password).toBe(false);
    expect(await bcrypt.compare("a brand new pass", row.password_hash)).toBe(true);
    expect((await queue(get("/api/review/queue"))).status).toBe(200);
    expect(await redirectOf(requireReviewerPage())).toBeNull();
    expect(await redirectOf(ChangePasswordPage() as Promise<unknown>)).toBe("/moderation"); // nothing left to do there
  });
  it("change-password is for reviewers only: a member gets 403, a visitor 401", async () => {
    signIn(await person("ST"));
    expect((await changePassword(post("/api/review/change-password", { currentPassword: PASSWORD, newPassword: "a brand new pass" }))).status).toBe(403);
    signIn(null);
    expect((await changePassword(post("/api/review/change-password", { currentPassword: PASSWORD, newPassword: "a brand new pass" }))).status).toBe(401);
  });
});

describe("nothing admin is reachable by URL", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const apiRoutes = walk("src/app/api/admin").filter((f) => /route\.ts$/.test(f));
  const pages = walk("src/app/admin").filter((f) => /page\.tsx$/.test(f));
  const ctx = { params: Promise.resolve({ id: "1", slug: "x" }) };

  it("every /api/admin route answers 403 to a moderator, for every method it has", async () => {
    expect(apiRoutes.length).toBeGreaterThan(5);
    for (const m of [await person("TC", { moderator: true }), await person(MODERATOR_ROLE, { moderator: true })]) {
      signIn(m);
      for (const f of apiRoutes) {
        const mod = await import("../" + f.replace(/\\/g, "/"));
        for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((x) => typeof mod[x] === "function")) {
          const r: Response = await mod[method](new Request("http://localhost/api/admin/x", { method, headers: { "content-type": "application/json", "x-forwarded-for": ip() }, ...(method === "GET" ? {} : { body: "{}" }) }), ctx);
          expect(r.status, `${method} ${f}`).toBe(403);
        }
      }
    }
  });
  it("every /admin page sends a moderator away (to /dashboard, which sends a dedicated moderator account on to the portal)", async () => {
    expect(pages.length).toBeGreaterThan(5);
    signIn(await person("TC", { moderator: true }));
    for (const f of pages) {
      const Page = (await import("../" + f.replace(/\\/g, "/"))).default;
      expect(await redirectOf(Promise.resolve().then(() => Page({ searchParams: Promise.resolve({}), params: Promise.resolve({}) }))), f).toBe("/dashboard");
    }
  });
});
