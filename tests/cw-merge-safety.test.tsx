// MERGE SAFETY: the merged code (the contribution workflow and this follow-up) running against a database that has migrations 001 to 026
// only (no 027, 028 or 029) and a website without the new WordPress plugin. What live users notice, checked here end to end through the
// real routes and pages:
//   * the current Contribute form works exactly as before (a member creates and submits a contribution through the current API);
//   * signing in and the session work as before;
//   * the new routes never fail: the form settings, "who am I" and My Contributions answer (My Contributions lists the current form's
//     items); the workflow's own routes answer "not set up yet" (503); no email is sent;
//   * the admin navigation shows the new pages, and Settings lists 027, 028 and 029 as not applied with the developer's steps;
//   * the Member portals' navigation shows Sectors and My Contributions;
//   * the rate limits of the existing routes are unchanged; the new public routes count in their own scope.
// In-process database (PGlite) only.
import { renderToStaticMarkup } from "react-dom/server";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migratedClone } from "./helpers/migratedClone";
import { setPool } from "./helpers/currentPool";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const st = vi.hoisted(() => ({ cookie: undefined as string | undefined, path: "/dashboard" }));
const mail = vi.hoisted(() => ({ sent: 0 }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "rv_session" && st.cookie ? { name: n, value: st.cookie } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error("REDIRECT:" + to); }, notFound: () => { throw new Error("NOT_FOUND"); },
  usePathname: () => st.path, useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
vi.mock("../src/lib/email", async (orig) => ({ ...((await orig()) as object), sendWorkflowEmail: async () => { mail.sent++; return "sent"; } }));

import { POST as login } from "../src/app/api/auth/login/route";
import * as create from "../src/app/api/contributions/route";
import * as submit from "../src/app/api/contributions/[id]/submit/route";
import * as cwConfig from "../src/app/api/cw/form-config/route";
import * as cwMe from "../src/app/api/cw/me/route";
import * as cwPublic from "../src/app/api/cw/public/route";
import * as cwSubmit from "../src/app/api/cw/contributions/route";
import * as cwReview from "../src/app/api/cw/review/route";
import * as cwMine from "../src/app/api/cw/mine/route";
import SettingsPage from "../src/app/admin/settings/page";
import DashboardLayout from "../src/app/dashboard/layout";
import { ADMIN_NAV, MODERATOR_NAV } from "../src/app/admin/_components/nav";
import { SERVICE_RATE_LIMITS } from "../src/lib/apiRateLimit";

let pg: any;
const q = (sql: string, p: unknown[] = []) => pg.query(sql, p);
let n = 0;
const req = (url: string, init: RequestInit = {}) => new Request("http://localhost" + url, { ...init, headers: { "content-type": "application/json", "x-forwarded-for": `22.0.0.${++n}`, ...(init.headers as object) } });
const json = async (r: Response) => ({ status: r.status, b: (await r.json()) as any });
async function signIn(email: string, password: string) {
  const r = await login(req("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }));
  st.cookie = (r.headers.get("set-cookie") ?? "").match(/rv_session=([^;]*)/)?.[1];
  return r.status;
}
async function user(email: string, role: string, name: string) {
  await q("insert into users (full_name, email, mobile, role, district, preferred_language, age_category, password_hash, email_verification) values ($1, $2, '9876543210', $3, 'Guntur', 'English', 'adult', $4, 'email')",
    [name, email, role, await bcrypt.hash("correct horse", 4)]);
}

beforeAll(async () => {
  process.env.SESSION_SECRET = SECRET;
  ({ pg } = await migratedClone((id) => id <= "026")); // the database as it is BEFORE 027, 028 and 029
  const pool = {
    query: async (sql: string, params?: unknown[]) => { const r = await pg.query(sql, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; },
    connect: async () => ({ query: (sql: string, params?: unknown[]) => pool.query(sql, params), release: () => undefined }),
  };
  setPool(pool);
  await user("member@example.com", "ST", "Asha Rao");
  await user("boss@example.com", "admin", "The Boss");
});
afterAll(async () => { await pg?.close(); });

describe("merged before migrations 027-029 and before the new plugin: what live users notice", () => {
  it("the database really has none of 027, 028 or 029", async () => {
    expect(((await q("select to_regclass('cw_contributions') t")).rows[0] as any).t).toBeNull();
  });
  it("signing in works as before, and the current Contribute form creates and submits a contribution through its API", async () => {
    expect(await signIn("member@example.com", "correct horse")).toBe(200);
    expect(st.cookie).toBeTruthy();
    const c = await json(await create.POST(req("/api/contributions", { method: "POST", body: JSON.stringify({ type: "problem", sectors: ["agriculture-dairy"], title: "Shed cleaning takes all morning", description: "Two workers clean the shed by hand every morning.", role: "Farmer", district: "Guntur" }) })));
    expect(c.status).toBe(201);
    const s = await json(await submit.POST(req(`/api/contributions/${c.b.id}/submit`, { method: "POST", body: "{}" }), { params: Promise.resolve({ id: String(c.b.id) }) }));
    expect(s.status).toBe(200);
    expect(((await q("select status from contributions where id = $1", [c.b.id])).rows[0] as any).status).toBe("pending_review");
  });
  it("the new routes never fail: settings, who am I and My Contributions answer; the workflow's own routes say 'not set up yet'", async () => {
    await signIn("member@example.com", "correct horse");
    const cfg = await json(await cwConfig.GET(req("/api/cw/form-config")));
    expect(cfg.status).toBe(200);
    expect(cfg.b.sectors.map((s: any) => s.slug)).toContain("agriculture-dairy");
    expect((await json(await cwMe.GET(req("/api/cw/me")))).b).toMatchObject({ signedIn: true, name: "Asha Rao", reviewer: false });
    const mine = await json(await cwMine.GET(req("/api/cw/mine")));
    expect(mine.status).toBe(200);
    expect(mine.b.items.map((i: any) => [i.title, i.source, i.statusLabel])).toEqual([["Shed cleaning takes all morning", "form", "Pending"]]);
    expect((await json(await cwPublic.GET(req("/api/cw/public")))).status).toBe(503);
    const fd = new FormData();
    fd.append("data", JSON.stringify({ kind: "New idea", refers: false, title: "A new idea", description: "Long enough description here.", sector: "not-sure", robotType: "not-sure", categories: ["Robotics"], suitableFor: [], learningPath: "", references: [], resource: {} }));
    const sub = await json(await cwSubmit.POST(new Request("http://localhost/api/cw/contributions", { method: "POST", body: fd, headers: { "x-forwarded-for": "22.1.1.1" } })));
    expect([sub.status, sub.b.error]).toEqual([503, "NOT_SET_UP"]);
    await signIn("boss@example.com", "correct horse");
    const rev = await json(await cwReview.GET(req("/api/cw/review?view=approvals")));
    expect([rev.status, rev.b.error]).toEqual([503, "NOT_SET_UP"]);
  });
  it("the admin navigation shows the new pages; Settings lists 027, 028 and 029 as not applied with the developer's steps", async () => {
    expect(ADMIN_NAV.map((x) => x.href)).toEqual(expect.arrayContaining(["/admin/workspace", "/admin/approvals", "/my-contributions"]));
    expect(MODERATOR_NAV.map((x) => x.href)).toEqual(["/admin/moderation", "/admin/workspace", "/my-contributions"]);
    await signIn("boss@example.com", "correct horse");
    st.path = "/admin/settings";
    const h = renderToStaticMarkup(<>{await SettingsPage()}</>);
    expect(h).toContain("For the developer: applying 027, 028, 029");
    for (const id of ["027", "028", "029"]) expect(h).toContain(`--only ${id} --apply`);
  });
  it("the Member portals' navigation shows Sectors and My Contributions", async () => {
    await signIn("member@example.com", "correct horse");
    st.path = "/dashboard";
    const h = renderToStaticMarkup(<>{await DashboardLayout({ children: <p>PAGE</p> })}</>);
    expect(h).toContain('href="/dashboard/sectors"');
    expect(h).toContain('href="/my-contributions"');
    expect(h).toContain("PAGE");
  });
  it("no email was sent by any of this; the existing rate limits are unchanged and the new public routes count in their own scope", async () => {
    expect(mail.sent).toBe(0);
    expect({ ...SERVICE_RATE_LIMITS }).toMatchObject({ search: 60, categories: 30, hubCounts: 30, contribIp: 40, contribUser: 20, contribPhoto: 6, modIp: 240, modUser: 120, modDecision: 30 });
    const scopes = ((await q("select distinct split_part(key, ':', 1) s from api_rate_limits order by 1")).rows as any[]).map((r) => r.s);
    expect(scopes).toContain("cwPublic");
    expect(scopes.every((s: string) => Object.prototype.hasOwnProperty.call(SERVICE_RATE_LIMITS, s) || s === "user")).toBe(true);
  });
});
