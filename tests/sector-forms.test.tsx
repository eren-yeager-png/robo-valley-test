// P2: Sector forms part 1 (robot types per sector, migration 024). Who may open and change it (signed out, member, moderator,
// administrator), what the routes accept and refuse, the pages, and the app before 024. In-process database (PGlite), real routes.
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
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error("REDIRECT:" + to); }, notFound: () => { throw new Error("NOT_FOUND"); },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/admin/sector-forms",
}));

import * as addRoute from "../src/app/api/admin/sector-forms/[slug]/robots/route";
import * as changeRoute from "../src/app/api/admin/sector-forms/[slug]/robots/[id]/route";
import SectorFormsPage from "../src/app/admin/sector-forms/page";
import SectorFormPage from "../src/app/admin/sector-forms/[slug]/page";
import * as portalRoute from "../src/app/api/admin/portal/sector-forms/route";
import { ADMIN_NAV, titleFor } from "../src/app/admin/_components/nav";
import { ROBOTS_PER_SECTOR, cleanRobotName, slugFor } from "../src/lib/sectorForms";
import { MODERATOR_ROLE } from "../src/lib/reviewerHome";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
const signInAs = (id: number | null, role = "ST") => { m.cookie = id === null ? undefined : createSessionToken({ id: String(id), role }, false, Date.now(), { SESSION_SECRET: SECRET } as never).token; };
let ipn = 0, seq = 0;
const req = (url: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost" + url, { method, headers: { host: "localhost", "content-type": "application/json", "x-forwarded-for": `41.0.${Math.floor(++ipn / 250)}.${ipn % 250}`, ...headers }, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
async function add(slug: string, body: unknown, headers?: Record<string, string>) {
  const r = await addRoute.POST(req(`/api/admin/sector-forms/${slug}/robots`, "POST", body, headers), { params: Promise.resolve({ slug }) });
  return { r, b: (await r.json()) as any };
}
async function change(slug: string, id: number | string, body: unknown, headers?: Record<string, string>) {
  const r = await changeRoute.PATCH(req(`/api/admin/sector-forms/${slug}/robots/${id}`, "PATCH", body, headers), { params: Promise.resolve({ slug, id: String(id) }) });
  return { r, b: (await r.json()) as any };
}
const robots = async (slug = "agriculture-dairy") => (await q("SELECT r.id, r.slug, r.name, r.is_active, r.sort_order, r.updated_by FROM sector_robot_types r JOIN sectors s ON s.id = r.sector_id WHERE s.slug = $1 ORDER BY r.sort_order, r.id", [slug])).rows as any[];
const count = async () => Number(((await q("SELECT count(*)::int n FROM sector_robot_types")).rows[0] as any).n);
const redirectOf = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { const x = /^REDIRECT:(.*)$/.exec(String((e as Error).message)); if (x) return x[1]; throw e; } };
const html = async (p: Promise<any>) => renderToStaticMarkup(await p);
const listPage = () => SectorFormsPage();
/** Sector Forms' data for the page's screen (public/cw/js/sector-forms.js draws it in the browser) */
async function portal(slug = "") {
  const r = await portalRoute.GET(req(`/api/admin/portal/sector-forms${slug ? `?sector=${slug}` : ""}`, "GET"));
  return { r, b: (await r.json()) as any };
}
const formPage = (slug: string) => SectorFormPage({ params: Promise.resolve({ slug }) });
const missingTable = () => testDb().failOn((sql) => (/sector_robot_types/.test(sql) ? Object.assign(new Error('relation "sector_robot_types" does not exist'), { code: "42P01" }) : undefined));

let admin = 0, member = 0;
async function people() {
  admin = Number((await seedUser({ email: `boss${++seq}@example.com`, role: "admin", fullName: "Boss" })).id);
  member = Number((await seedUser({ email: `member${++seq}@example.com`, role: "ST", fullName: "Member" })).id);
  await q("INSERT INTO sectors (slug, name, sort_order) VALUES ('education','Education',20) ON CONFLICT DO NOTHING");
  await q("INSERT INTO sectors (slug, name, sort_order, is_active) VALUES ('healthcare','Healthcare',30,false) ON CONFLICT DO NOTHING");
  await q("INSERT INTO sectors (slug, name, sort_order, is_demo) VALUES ('demo-sector','Demo sector',40,true) ON CONFLICT DO NOTHING");
}
async function moderator(dedicated = false) {
  const id = Number((await seedUser({ email: `mod${++seq}@example.com`, role: dedicated ? MODERATOR_ROLE : "TC", fullName: "Mod" })).id);
  await q("UPDATE users SET is_moderator = true WHERE id = $1", [id]);
  return { id, role: dedicated ? MODERATOR_ROLE : "TC" };
}

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  m.cookie = undefined;
  await q("DELETE FROM api_rate_limits");
  await people();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); testDb().failOn(undefined); });

describe("who may open and change Sector forms", () => {
  it("signed out: both pages send you to sign in; adding and changing answer 401 and change nothing", async () => {
    signInAs(admin, "admin"); const first = (await add("agriculture-dairy", { name: "Drone sprayers" })).b.robot.id;
    signInAs(null);
    expect(await redirectOf(listPage())).toBe("/login");
    expect(await redirectOf(formPage("agriculture-dairy"))).toBe("/login");
    const a = await add("agriculture-dairy", { name: "Milking robots" });
    expect(a.r.status).toBe(401);
    expect(a.r.headers.get("cache-control")).toMatch(/no-store/);
    expect((await change("agriculture-dairy", first, { active: false })).r.status).toBe(401);
    expect((await robots()).map((r) => [r.name, r.is_active])).toEqual([["Drone sprayers", true]]);
  });

  it("member: both pages send you to your dashboard; adding and changing answer 403 and change nothing", async () => {
    signInAs(admin, "admin"); const first = (await add("agriculture-dairy", { name: "Drone sprayers" })).b.robot.id;
    signInAs(member, "ST");
    expect(await redirectOf(listPage())).toBe("/dashboard");
    expect(await redirectOf(formPage("agriculture-dairy"))).toBe("/dashboard");
    const a = await add("agriculture-dairy", { name: "Milking robots" });
    expect(a.r.status).toBe(403);
    expect(a.b.robot).toBeUndefined();
    expect((await change("agriculture-dairy", first, { name: "Renamed by a member" })).r.status).toBe(403);
    expect((await robots()).map((r) => r.name)).toEqual(["Drone sprayers"]);
  });

  it("moderator (a member with the flag, and a dedicated moderator account): pages send them away, routes answer 403", async () => {
    signInAs(admin, "admin"); const first = (await add("agriculture-dairy", { name: "Drone sprayers" })).b.robot.id;
    for (const mod of [await moderator(false), await moderator(true)]) {
      signInAs(mod.id, mod.role);
      expect(await redirectOf(listPage())).toBe("/dashboard");
      expect(await redirectOf(formPage("agriculture-dairy"))).toBe("/dashboard");
      expect((await add("agriculture-dairy", { name: "Milking robots" })).r.status).toBe(403);
      expect((await change("agriculture-dairy", first, { move: "down" })).r.status).toBe(403);
      expect((await change("agriculture-dairy", first, { active: false })).r.status).toBe(403);
    }
    expect(await count()).toBe(1);
    expect((await robots())[0].is_active).toBe(true);
  });

  it("a token that CLAIMS admin for a member account is still refused (the role comes from the database)", async () => {
    signInAs(member, "admin");
    expect((await add("agriculture-dairy", { name: "Drone sprayers" })).r.status).toBe(403);
    expect(await redirectOf(listPage())).toBe("/dashboard");
    expect(await count()).toBe(0);
  });

  it("an administrator who still has a temporary password: no page content, and changes answer 403 PASSWORD_CHANGE_REQUIRED", async () => {
    await q("UPDATE users SET must_change_password = true WHERE id = $1", [admin]);
    signInAs(admin, "admin");
    expect(await listPage()).toBeNull();
    expect(await formPage("agriculture-dairy")).toBeNull();
    const a = await add("agriculture-dairy", { name: "Drone sprayers" });
    expect([a.r.status, a.b.error]).toEqual([403, "PASSWORD_CHANGE_REQUIRED"]);
    expect(await count()).toBe(0);
  });

  it("administrator: can add and change; a browser request from another website is refused even for an administrator", async () => {
    signInAs(admin, "admin");
    const a = await add("agriculture-dairy", { name: "Drone sprayers" });
    expect(a.r.status).toBe(200);
    expect(a.r.headers.get("cache-control")).toMatch(/no-store/);
    expect((await change("agriculture-dairy", a.b.robot.id, { active: false })).r.status).toBe(200);
    expect((await add("agriculture-dairy", { name: "Milking robots" }, { origin: "https://evil.example" })).r.status).toBe(403);
    expect((await change("agriculture-dairy", a.b.robot.id, { active: true }, { origin: "https://evil.example" })).r.status).toBe(403);
    expect((await robots()).map((r) => [r.name, r.is_active])).toEqual([["Drone sprayers", false]]);
  });

  it("robot types can never be deleted, and nothing else is offered: the routes have no DELETE, GET or PUT", () => {
    expect(Object.keys(addRoute).filter((k) => /^[A-Z]+$/.test(k))).toEqual(["POST"]);
    expect(Object.keys(changeRoute).filter((k) => /^[A-Z]+$/.test(k))).toEqual(["PATCH"]);
    expect(readFileSync("src/lib/sectorForms.ts", "utf8").replace(/\/\/.*$/gm, "")).not.toMatch(/DELETE\s+FROM/i);
  });
});

describe("adding robot types (administrator)", () => {
  beforeEach(() => signInAs(admin, "admin"));

  it("cleans the name, makes the link code from it, puts it at the end and records who added it", async () => {
    const a = await add("agriculture-dairy", { name: "  Drone   sprayers " });
    expect(a.b).toMatchObject({ success: true, robot: { slug: "drone-sprayers", name: "Drone sprayers", active: true } });
    await add("agriculture-dairy", { name: "Milking robots" });
    await add("agriculture-dairy", { name: "Fruit-picking arms (orchard)" });
    expect((await robots()).map((r) => [r.slug, r.name, r.sort_order, Number(r.updated_by)])).toEqual([
      ["drone-sprayers", "Drone sprayers", 10, admin], ["milking-robots", "Milking robots", 20, admin], ["fruit-picking-arms-orchard", "Fruit-picking arms (orchard)", 30, admin],
    ]);
  });

  it("the same name twice in one sector is refused (capitals and spaces do not matter); another sector may use it", async () => {
    await add("agriculture-dairy", { name: "Drone sprayers" });
    const d = await add("agriculture-dairy", { name: "drone  SPRAYERS" });
    expect([d.r.status, d.b.error]).toEqual([409, "DUPLICATE"]);
    expect(d.b.message).toBe("This sector already has a robot type called \"Drone sprayers\"."); // the one that is there, as written
    expect((await add("education", { name: "Drone sprayers" })).r.status).toBe(200);
    expect(await count()).toBe(2);
  });

  it("two different names that make the same link code get distinct codes", async () => {
    await add("agriculture-dairy", { name: "Drone sprayers" });
    const b = await add("agriculture-dairy", { name: "Drone-sprayers" });
    expect(b.b.robot.slug).toBe("drone-sprayers-2");
    const c = await add("agriculture-dairy", { name: "ड्रोन" }); // no Latin letters: a generic code, still unique
    expect(c.b.robot.slug).toBe("robot");
    expect((await add("agriculture-dairy", { name: "रोबोट" })).b.robot.slug).toBe("robot-2");
  });

  it("refuses names that cannot be used, and bodies that are not one name", async () => {
    for (const name of ["", "   ", "x", "a".repeat(81), "Two\nlines", "<b>Bold</b>", "---", 42, null]) {
      const x = await add("agriculture-dairy", { name });
      expect([x.r.status, x.b.error], JSON.stringify(name)).toEqual([400, "VALIDATION_FAILED"]);
    }
    expect((await add("agriculture-dairy", "not json")).r.status).toBe(400);
    expect((await add("agriculture-dairy", { name: "a".repeat(80) })).r.status).toBe(200); // the longest allowed
    expect(await count()).toBe(1);
  });

  it("unknown, demo or badly written sectors answer 404", async () => {
    for (const slug of ["no-such-sector", "demo-sector", "Bad Slug", "x".repeat(61)]) expect((await add(slug, { name: "Drone sprayers" })).r.status, slug).toBe(404);
    expect(await count()).toBe(0);
  });

  it(`stops at ${ROBOTS_PER_SECTOR} robot types per sector (switched-off ones are kept, so they count)`, async () => {
    const id = Number(((await q("SELECT id FROM sectors WHERE slug = 'agriculture-dairy'")).rows[0] as any).id);
    for (let i = 1; i <= ROBOTS_PER_SECTOR; i++) await q("INSERT INTO sector_robot_types (sector_id, slug, name, is_active) VALUES ($1, $2, $3, $4)", [id, `r${i}`, `Robot ${i}`, i % 2 === 0]);
    const x = await add("agriculture-dairy", { name: "One too many" });
    expect([x.r.status, x.b.error]).toEqual([409, "LIMIT"]);
    expect((await add("education", { name: "One too many" })).r.status).toBe(200);
  });
});

describe("changing robot types (administrator)", () => {
  let ids: number[] = [];
  beforeEach(async () => {
    signInAs(admin, "admin");
    ids = [];
    for (const name of ["Drone sprayers", "Milking robots", "Weeding robots"]) ids.push((await add("agriculture-dairy", { name })).b.robot.id);
  });

  it("rename: the name changes, the link code stays; a name another robot has is refused; a different capitalisation of its own is fine", async () => {
    const r = await change("agriculture-dairy", ids[0], { name: "Drone  sprayers (spot)" });
    expect(r.r.status).toBe(200);
    expect(r.b.robots[0]).toMatchObject({ slug: "drone-sprayers", name: "Drone sprayers (spot)" });
    expect((await change("agriculture-dairy", ids[0], { name: "milking ROBOTS" })).r.status).toBe(409);
    expect((await change("agriculture-dairy", ids[1], { name: "MILKING robots" })).r.status).toBe(200);
    expect((await change("agriculture-dairy", ids[1], { name: "x" })).r.status).toBe(400);
    expect((await robots()).map((x) => [x.slug, x.name])).toEqual([["drone-sprayers", "Drone sprayers (spot)"], ["milking-robots", "MILKING robots"], ["weeding-robots", "Weeding robots"]]);
  });

  it("switch off and on again: the robot stays in the list (never deleted)", async () => {
    expect((await change("agriculture-dairy", ids[1], { active: false })).b.robots.map((x: any) => x.active)).toEqual([true, false, true]);
    expect(await count()).toBe(3);
    expect((await change("agriculture-dairy", ids[1], { active: true })).b.robots.map((x: any) => x.active)).toEqual([true, true, true]);
  });

  it("move up and down; at the top or bottom nothing changes; only the moved robot records who moved it", async () => {
    await q("UPDATE sector_robot_types SET updated_by = NULL");
    expect((await change("agriculture-dairy", ids[2], { move: "up" })).b.robots.map((x: any) => x.name)).toEqual(["Drone sprayers", "Weeding robots", "Milking robots"]);
    expect((await robots()).map((x) => x.updated_by === null ? null : Number(x.updated_by))).toEqual([null, admin, null]);
    expect((await change("agriculture-dairy", ids[0], { move: "up" })).b.robots.map((x: any) => x.name)).toEqual(["Drone sprayers", "Weeding robots", "Milking robots"]);
    expect((await change("agriculture-dairy", ids[0], { move: "down" })).b.robots.map((x: any) => x.name)).toEqual(["Weeding robots", "Drone sprayers", "Milking robots"]);
    expect((await change("agriculture-dairy", ids[1], { move: "down" })).b.robots.map((x: any) => x.name)).toEqual(["Weeding robots", "Drone sprayers", "Milking robots"]);
    expect((await robots()).map((x) => x.sort_order)).toEqual([10, 20, 30]);
  });

  it("a robot of another sector, an unknown id or a bad id answers 404; a body with no change or two changes answers 400", async () => {
    const edu = (await add("education", { name: "Tutor robots" })).b.robot.id;
    expect((await change("agriculture-dairy", edu, { active: false })).r.status).toBe(404);
    expect((await change("agriculture-dairy", 999999, { active: false })).r.status).toBe(404);
    expect((await change("agriculture-dairy", "abc", { active: false })).r.status).toBe(404);
    expect((await change("no-such-sector", ids[0], { active: false })).r.status).toBe(404);
    for (const body of [{}, { active: false, name: "Both" }, { move: "left" }, { active: "no" }, { slug: "new-code" }, []]) {
      expect((await change("agriculture-dairy", ids[0], body)).r.status, JSON.stringify(body)).toBe(400);
    }
    expect((await robots("education"))[0].is_active).toBe(true);
    expect((await robots()).map((x) => x.slug)).toEqual(["drone-sprayers", "milking-robots", "weeding-robots"]);
  });
});

describe("before migration 024, and when the database fails", () => {
  beforeEach(() => signInAs(admin, "admin"));

  it("before 024: adding and changing answer 503 NOT_SET_UP; the page's data says fields are not set up and still lists the sectors", async () => {
    missingTable();
    const a = await add("agriculture-dairy", { name: "Drone sprayers" });
    expect([a.r.status, a.b.error]).toEqual([503, "NOT_SET_UP"]);
    expect((await change("agriculture-dairy", 1, { active: false })).r.status).toBe(503);
    const d = await portal();
    expect(d.r.status).toBe(200);
    expect(d.b.robotsReady).toBe(false); // the screen says "Fields are not set up on this database yet (migration 024)" and adds nothing
    expect(d.b.sectors.map((x: any) => x.name)).toContain("Agriculture & Dairy");
    expect(readFileSync("public/cw/js/sector-forms.js", "utf8")).toContain("Fields are not set up on this database yet (migration 024)");
    const form = await html(formPage("agriculture-dairy")); // the sector's questions still open
    expect(form).toContain("Questions");
    expect(form).not.toContain("Add robot type");
  });

  it("without the sector tables (012): a setup notice, not a crash", async () => {
    testDb().failOn((sql) => (/FROM sectors/.test(sql) ? Object.assign(new Error('relation "sectors" does not exist'), { code: "42P01" }) : undefined));
    const d = await portal();
    expect([d.r.status, d.b.message]).toEqual([503, "Sectors are not set up on this database yet."]);
    expect(await html(formPage("agriculture-dairy"))).toContain("Sectors are not set up on this database yet");
  });

  it("a database failure: 500 with a fixed message and no details", async () => {
    testDb().failOn((sql) => (/sector_robot_types|FROM sectors/.test(sql) ? new Error("secret detail: password=hunter2") : undefined));
    const a = await add("agriculture-dairy", { name: "Drone sprayers" });
    expect(a.r.status).toBe(500);
    expect(JSON.stringify(a.b)).not.toMatch(/hunter2|secret/);
    const d = await portal();
    expect([d.r.status, d.b.message]).toEqual([500, "Sector forms could not be loaded. Please try again."]);
    expect(JSON.stringify(d.b)).not.toMatch(/hunter2|secret/);
  });

  it("only Sector forms and the robot module (P3) read the new table, so everything else works before 024 exactly as before", () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
    const users = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && readFileSync(f, "utf8").includes("sector_robot_types"));
    expect(users.map((f) => f.replace(/\\/g, "/")).sort()).toEqual(["src/lib/contributionRobots.ts", "src/lib/sectorForms.ts"]);
    // every read in the robot module treats a missing table or column as "no robots" (tested in robots-per-sector.test.tsx)
    expect(readFileSync("src/lib/contributionRobots.ts", "utf8")).toContain('const missing = (e: unknown) => ["42P01", "42703"]');
  });
});

describe("the pages (administrator)", () => {
  beforeEach(() => signInAs(admin, "admin"));

  it("the page mounts the shared Sector Forms screen with the sector and the live Contribute form; bad values are dropped", async () => {
    const el = (await listPage()) as any;
    expect(el.props.screen).toBe("sectorForms");
    expect(el.props.options).toMatchObject({ sector: "", basePath: "/admin/sector-forms", questionsPath: "/admin/sector-forms" });
    expect(((await SectorFormsPage({ searchParams: Promise.resolve({ sector: "education" }) })) as any).props.options.sector).toBe("education");
    expect(((await SectorFormsPage({ searchParams: Promise.resolve({ sector: "<x>" }) })) as any).props.options.sector).toBe("");
  });

  it("the data: every non-demo sector (offered or not) with its number of fields; one sector's fields in order with link codes and state", async () => {
    const d = (await add("agriculture-dairy", { name: "Drone sprayers" })).b.robot.id;
    await add("agriculture-dairy", { name: "Milking robots" });
    await add("agriculture-dairy", { name: "Weeding robots" });
    await change("agriculture-dairy", d, { active: false });
    const r = await portal("agriculture-dairy");
    expect(r.r.status).toBe(200);
    expect(r.b.sectors.map((x: any) => [x.slug, x.active, x.fields])).toEqual([["agriculture-dairy", true, 3], ["education", true, 0], ["healthcare", false, 0]]); // no demo sector
    expect(r.b.fields.map((f: any) => [f.slug, f.active, f.source, f.contributions])).toEqual([["drone-sprayers", false, "admin", 0], ["milking-robots", true, "admin", 0], ["weeding-robots", true, "admin", 0]]);
    expect((await portal("no-such-sector")).b.sector.slug).toBe("agriculture-dairy"); // an unknown sector opens the first one
  });

  it("a sector's Questions page: a sector that is not offered says so; unknown and demo sectors are not found", async () => {
    const h = await html(formPage("agriculture-dairy"));
    expect(h).toContain("Sector form: Agriculture &amp; Dairy · Questions");
    expect(h).toContain('href="/admin/sector-forms?sector=agriculture-dairy"');
    expect(await html(formPage("healthcare"))).toContain("This sector is not offered on the Contribute form right now");
    for (const slug of ["no-such-sector", "demo-sector", "Bad Slug"]) await expect(formPage(slug), slug).rejects.toThrow("NOT_FOUND");
  });

  it("is in the admin sidebar, and the top bar title is right on both pages", () => {
    expect(ADMIN_NAV.find((n) => n.href === "/admin/sector-forms")).toMatchObject({ label: "Sector Forms" });
    expect(titleFor("/admin/sector-forms")).toBe("Sector Forms");
    expect(titleFor("/admin/sector-forms/agriculture-dairy")).toBe("Sector Forms");
  });

  it("the avatar menu shows 'Sector forms' to administrators only", () => {
    const js = readFileSync("public/rv-header-menu.js", "utf8");
    expect(js).toMatch(/\{ label: "Sector forms", role: "admin", base: "app", path: "\/admin\/sector-forms", enabled: true \}/);
  });
});

describe("name rules", () => {
  it("cleanRobotName and slugFor", () => {
    expect(cleanRobotName("  Drone    sprayers  ")).toEqual({ name: "Drone sprayers" });
    expect("error" in cleanRobotName("Drone\tsprayers")).toBe(true); // a tab is a control character, like a line break
    expect(cleanRobotName("Café robot")).toEqual({ name: "Café robot" });
    expect("error" in cleanRobotName("ab\u0007")).toBe(true);
    expect(slugFor("Café robot")).toBe("cafe-robot");
    expect(slugFor("  --Drone // sprayers--  ")).toBe("drone-sprayers");
    expect(slugFor("a".repeat(70))).toHaveLength(60);
    expect(slugFor("ड्रोन")).toBe("robot");
  });
});
