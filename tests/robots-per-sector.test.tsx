// P3: the robot a contribution is about, one per chosen sector (migration 025, plugin 0.1.11). The public sector list carries the
// robot TYPES that are on; the member's answers are saved, checked and returned for Edit; reviewers see them on the item page and in
// the CSV; nothing public shows them. Every role, and the app before 024/025. In-process database, real routes.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
const who: { id: string | null; role: string } = { id: null, role: "ST" };
vi.mock("../src/lib/currentUser", () => ({
  getCurrentUser: async () => (who.id ? { id: who.id, fullName: "Test Person", email: "t@example.com", role: who.role } : null),
  firstNameOf: () => "Test",
}));
const page = vi.hoisted(() => ({ viewer: 0, isAdmin: true }));
vi.mock("../src/lib/reviewerPage", () => ({ requireReviewerPage: async () => ({ userId: page.viewer, email: "r@example.com", isAdmin: page.isAdmin }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }), redirect: (to: string) => { throw new Error("REDIRECT:" + to); }, notFound: () => { throw new Error("NOT_FOUND"); }, usePathname: () => "/moderation" }));

import * as create from "../src/app/api/contributions/route";
import * as one from "../src/app/api/contributions/[id]/route";
import * as sectorsRoute from "../src/app/api/contributions/sectors/route";
import { GET as exportCsv } from "../src/app/api/review/export/route";
import Detail from "../src/app/moderation/[id]/page";
import { readRobots } from "../src/lib/contributionRobots";
import { validateContributeReturn } from "../src/lib/contributeReturnTo";

const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
let ipn = 0, seq = 0;
const ip = () => `22.${Math.floor(++ipn / 250) % 250}.${ipn % 250}.1`;
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const call = async (fn: unknown, method: string, url: string, body?: unknown, id?: number) => {
  const r = await (fn as (r: Request, c?: unknown) => Promise<Response>)(new Request("http://localhost" + url, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: body === undefined ? undefined : JSON.stringify(body) }), id === undefined ? undefined : ctx(id));
  return { status: r.status, b: (await r.json()) as any };
};
const good = (over: Record<string, unknown> = {}) => ({ type: "problem", typeChosen: true, sectors: ["agriculture-dairy", "education"], title: `Robots in the milking shed ${++seq}`, description: `Cows are milked by hand every morning before school ${seq}.`, ...over });
const signIn = (id: number | null, role = "ST") => { who.id = id === null ? null : String(id); who.role = role; };
async function member(role = "ST") { return Number((await seedUser({ email: `r${++seq}@example.com`, role, fullName: `Member ${seq} Name` })).id); }
const sectorId = async (slug: string) => Number(((await q("SELECT id FROM sectors WHERE slug = $1", [slug])).rows[0] as any).id);
async function robotTypes() {
  await q("INSERT INTO sectors (slug, name, sort_order) VALUES ('education','Education',20), ('healthcare','Healthcare',30) ON CONFLICT DO NOTHING");
  const agri = await sectorId("agriculture-dairy"), edu = await sectorId("education"), health = await sectorId("healthcare");
  await q("INSERT INTO sector_robot_types (sector_id, slug, name, sort_order, is_active) VALUES ($1,'milking-robots','Milking robots',10,true), ($1,'drone-sprayers','Drone sprayers',20,true), ($1,'old-milker','Old milker',30,false), ($2,'pharmacy-robots','Pharmacy robots',10,true)", [agri, health]);
  return { agri, edu, health };
}
const stored = async (id: number) => (await q("SELECT s.slug, r.slug AS robot FROM contribution_scopes cs JOIN sectors s ON s.id = cs.sector_id LEFT JOIN sector_robot_types r ON r.id = cs.robot_type_id WHERE cs.contribution_id = $1 ORDER BY s.slug", [id])).rows;
const fromRobot = async (id: number) => ((await q("SELECT from_robot_page AS f FROM contributions WHERE id = $1", [id])).rows[0] as any).f;
const publicSectors = async () => (await call(sectorsRoute.GET, "GET", "/api/contributions/sectors")).b;
const missing = (pattern: RegExp, code: string) => testDb().failOn((sql) => (pattern.test(sql) ? Object.assign(new Error("missing"), { code }) : undefined));

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", "unit-test-secret-unit-test-secret-1234");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  signIn(null);
  await q("DELETE FROM api_rate_limits");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); testDb().failOn(undefined); });

describe("the public sector list", () => {
  it("each sector lists its robot types that are ON, in order (names only); switched-off ones and nobody's answers are never there", async () => {
    await robotTypes();
    const owner = await member(); signIn(owner);
    expect((await call(create.POST, "POST", "/api/contributions", good({ robots: { "agriculture-dairy": "milking-robots" } }))).status).toBe(201);
    const b = await publicSectors();
    const by = Object.fromEntries(b.sectors.map((s: any) => [s.slug, s.robots]));
    expect(by["agriculture-dairy"]).toEqual([{ slug: "milking-robots", name: "Milking robots" }, { slug: "drone-sprayers", name: "Drone sprayers" }]);
    expect(by.education).toEqual([]);
    expect(by.healthcare).toEqual([{ slug: "pharmacy-robots", name: "Pharmacy robots" }]);
    expect(JSON.stringify(b)).not.toMatch(/old-milker|Old milker|robot_type_id|fromRobotPage/);
  });
  it("before migration 024 every sector has an empty robot list, and the list still works", async () => {
    missing(/sector_robot_types/, "42P01");
    const b = await publicSectors();
    expect(b.success).toBe(true);
    for (const s of b.sectors) expect(s.robots).toEqual([]);
  });
});

describe("the member saves robots (owner)", () => {
  it("one robot per chosen sector, or Not sure; Edit gets them back; fromRobotPage is remembered only when the item is created", async () => {
    await robotTypes();
    const owner = await member(); signIn(owner);
    const c = await call(create.POST, "POST", "/api/contributions", good({ robots: { "agriculture-dairy": "milking-robots", education: "" }, fromRobotPage: true }));
    expect(c.status).toBe(201);
    expect(await stored(c.b.id)).toEqual([{ slug: "agriculture-dairy", robot: "milking-robots" }, { slug: "education", robot: null }]);
    expect(await fromRobot(c.b.id)).toBe(true);
    const own = (await call(one.GET, "GET", `/api/contributions/${c.b.id}`, undefined, c.b.id)).b.contribution;
    expect(own.robots).toEqual([{ sector: "agriculture-dairy", slug: "milking-robots", name: "Milking robots", active: true }]);
    expect(own.fromRobotPage).toBe(true);
    const d = await call(create.POST, "POST", "/api/contributions", good());
    await call(one.PATCH, "PATCH", `/api/contributions/${d.b.id}`, good({ fromRobotPage: true }), d.b.id);
    expect(await fromRobot(d.b.id)).toBe(false); // an edit never changes where it was started
  });
  it("a change of robot, Not sure again, and a form without robots (older than 0.1.11) leaves the saved ones as they are", async () => {
    await robotTypes();
    const owner = await member(); signIn(owner);
    const c = await call(create.POST, "POST", "/api/contributions", good({ robots: { "agriculture-dairy": "milking-robots" } }));
    const id = c.b.id, body = good();
    await call(one.PATCH, "PATCH", `/api/contributions/${id}`, { ...body, robots: { "agriculture-dairy": "drone-sprayers" } }, id);
    expect(await stored(id)).toEqual([{ slug: "agriculture-dairy", robot: "drone-sprayers" }, { slug: "education", robot: null }]);
    await call(one.PATCH, "PATCH", `/api/contributions/${id}`, body, id); // no robots key: an older form
    expect(await stored(id)).toEqual([{ slug: "agriculture-dairy", robot: "drone-sprayers" }, { slug: "education", robot: null }]);
    await call(one.PATCH, "PATCH", `/api/contributions/${id}`, { ...body, robots: { "agriculture-dairy": "" } }, id);
    expect(await stored(id)).toEqual([{ slug: "agriculture-dairy", robot: null }, { slug: "education", robot: null }]);
  });
  it("unticking a sector takes its robot with it", async () => {
    await robotTypes();
    const owner = await member(); signIn(owner);
    const c = await call(create.POST, "POST", "/api/contributions", good({ sectors: ["agriculture-dairy", "healthcare"], robots: { "agriculture-dairy": "milking-robots", healthcare: "pharmacy-robots" } }));
    await call(one.PATCH, "PATCH", `/api/contributions/${c.b.id}`, good({ sectors: ["healthcare"], robots: { healthcare: "pharmacy-robots" } }), c.b.id);
    expect(await stored(c.b.id)).toEqual([{ slug: "healthcare", robot: "pharmacy-robots" }]);
  });
  it("refused with 400 and nothing saved: a robot of another sector, an unknown one, a switched-off one chosen anew, or a malformed answer", async () => {
    await robotTypes();
    const owner = await member(); signIn(owner);
    for (const [robots, message] of [
      [{ "agriculture-dairy": "pharmacy-robots" }, /Choose a robot from the list for Agriculture & Dairy/],
      [{ "agriculture-dairy": "no-such-robot" }, /Choose a robot from the list for Agriculture & Dairy/],
      [{ "agriculture-dairy": "old-milker" }, /no longer offered for Agriculture & Dairy/],
      [["milking-robots"], /could not be read/],
      [{ "agriculture-dairy": "Milking Robots" }, /could not be read/],
    ] as const) {
      const before = Number(((await q("SELECT count(*)::int n FROM contributions")).rows[0] as any).n);
      const x = await call(create.POST, "POST", "/api/contributions", good({ robots }));
      expect(x.status, JSON.stringify(robots)).toBe(400);
      expect(x.b.fieldErrors.robots, JSON.stringify(robots)).toMatch(message);
      expect(Number(((await q("SELECT count(*)::int n FROM contributions")).rows[0] as any).n)).toBe(before);
    }
  });
  it("a robot switched off after it was chosen stays chosen through Edit", async () => {
    const { agri } = await robotTypes();
    const owner = await member(); signIn(owner);
    const c = await call(create.POST, "POST", "/api/contributions", good({ robots: { "agriculture-dairy": "milking-robots" } }));
    await q("UPDATE sector_robot_types SET is_active = false WHERE sector_id = $1 AND slug = 'milking-robots'", [agri]);
    const x = await call(one.PATCH, "PATCH", `/api/contributions/${c.b.id}`, good({ robots: { "agriculture-dairy": "milking-robots" } }), c.b.id);
    expect(x.status).toBe(200);
    expect((await call(one.GET, "GET", `/api/contributions/${c.b.id}`, undefined, c.b.id)).b.contribution.robots).toEqual([{ sector: "agriculture-dairy", slug: "milking-robots", name: "Milking robots", active: false }]);
  });
  it("before migration 025 the save still works; the robot answers are simply not stored, and Edit has none", async () => {
    await robotTypes();
    const owner = await member(); signIn(owner);
    missing(/robot_type_id|from_robot_page/, "42703");
    const c = await call(create.POST, "POST", "/api/contributions", good({ robots: { "agriculture-dairy": "milking-robots" }, fromRobotPage: true }));
    expect(c.status).toBe(201);
    const own = (await call(one.GET, "GET", `/api/contributions/${c.b.id}`, undefined, c.b.id)).b.contribution;
    expect(own.robots).toEqual([]); expect(own.fromRobotPage).toBe(false);
    testDb().failOn(undefined);
    expect(await stored(c.b.id)).toEqual([{ slug: "agriculture-dairy", robot: null }, { slug: "education", robot: null }]);
  });
});

describe("everyone else", () => {
  it("signed out: 401; another member: 404 and nothing changes; a moderator or an administrator cannot save robots for anyone (403)", async () => {
    await robotTypes();
    const owner = await member(); signIn(owner);
    const c = await call(create.POST, "POST", "/api/contributions", good({ robots: { "agriculture-dairy": "milking-robots" } }));
    signIn(null);
    expect((await call(create.POST, "POST", "/api/contributions", good({ robots: { "agriculture-dairy": "drone-sprayers" } }))).status).toBe(401);
    signIn(await member());
    expect((await call(one.PATCH, "PATCH", `/api/contributions/${c.b.id}`, good({ robots: { "agriculture-dairy": "drone-sprayers" } }), c.b.id)).status).toBe(404);
    expect((await call(one.GET, "GET", `/api/contributions/${c.b.id}`, undefined, c.b.id)).status).toBe(404); // nobody else reads the answers
    const mod = await member("TC"); await q("UPDATE users SET is_moderator = true WHERE id = $1", [mod]);
    for (const [uid, role] of [[mod, "TC"], [await member("admin"), "admin"]] as const) {
      signIn(uid, role);
      expect((await call(one.PATCH, "PATCH", `/api/contributions/${c.b.id}`, good({ robots: { "agriculture-dairy": "drone-sprayers" } }), c.b.id)).status, role).toBe(403);
    }
    expect(await stored(c.b.id)).toEqual([{ slug: "agriculture-dairy", robot: "milking-robots" }, { slug: "education", robot: null }]);
  });

  async function submitted() {
    await robotTypes();
    const owner = await member(); signIn(owner);
    const c = await call(create.POST, "POST", "/api/contributions", good({ sectors: ["agriculture-dairy", "education", "healthcare"], robots: { "agriculture-dairy": "milking-robots", healthcare: "pharmacy-robots" } }));
    await q("UPDATE contributions SET status = 'pending_review', submitted_at = now() WHERE id = $1", [c.b.id]);
    return c.b.id as number;
  }
  it("reviewers see the robot per sector on the item page (administrator and moderator alike); a switched-off one says so", async () => {
    const id = await submitted();
    await q("UPDATE sector_robot_types SET is_active = false WHERE slug = 'pharmacy-robots'");
    for (const isAdmin of [true, false]) {
      page.viewer = await member(isAdmin ? "admin" : "TC"); page.isAdmin = isAdmin;
      const h = renderToStaticMarkup(await Detail({ params: Promise.resolve({ id: String(id) }), searchParams: Promise.resolve({}) }));
      expect(h).toMatch(/<dt>Agriculture &amp; Dairy<\/dt><dd>Robot: Milking robots<\/dd>/);
      expect(h).toMatch(/<dt>Education<\/dt><dd>Robot: <span[^>]*>Not sure<\/span><\/dd>/);
      expect(h).toMatch(/<dt>Healthcare<\/dt><dd>Robot: Pharmacy robots<span[^>]*> \(switched off in Sector forms\)<\/span><\/dd>/);
    }
  });
  it("before migration 025 the item page shows the sectors as before, with no robot lines", async () => {
    const id = await submitted();
    missing(/robot_type_id/, "42703");
    page.viewer = await member("admin"); page.isAdmin = true;
    const h = renderToStaticMarkup(await Detail({ params: Promise.resolve({ id: String(id) }), searchParams: Promise.resolve({}) }));
    expect(h).toContain("Sectors"); expect(h).not.toContain("Robot:");
  });
  it("the CSV of a sector has the robot chosen in THAT sector (Not sure otherwise), for reviewers only", async () => {
    const id = await submitted();
    const csv = async () => { const r = await exportCsv(new Request("http://localhost/api/review/export?sector=agriculture-dairy&tab=all", { headers: { "x-forwarded-for": ip() } })); return { status: r.status, text: await r.text() }; };
    const admin = await member("admin"); signIn(admin, "admin");
    const a = await csv();
    expect(a.status).toBe(200);
    const lines = a.text.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toMatch(/^"ID","Title","Type","Robot","Also in"/);
    expect(lines.find((l) => l.startsWith(`"${id}"`))).toMatch(/,"Milking robots","Education; Healthcare",/);
    signIn(await member());
    expect((await csv()).status).toBe(403);
  });
});

describe("rules in small", () => {
  it("readRobots: absent is fine (older form); only { sector: robot | '' } with good slugs", () => {
    expect(readRobots({})).toEqual({ present: false });
    expect(readRobots({ robots: { "agriculture-dairy": "", education: "tutor-robots" } })).toEqual({ present: true, value: { "agriculture-dairy": "", education: "tutor-robots" } });
    for (const bad of [null, [], "x", { "Agriculture": "x" }, { a: 1 }, { a: "Bad Slug" }, Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`s${i}`, ""]))]) expect("error" in readRobots({ robots: bad }), JSON.stringify(bad)).toBe(true);
  });
  it("the sign-in return keeps one sector and its robot, and nothing else", () => {
    const site = "https://techytree.in", path = "/contribute-now/";
    expect(validateContributeReturn("/contribute-now/?sector=agriculture-dairy&robot=milking-robots", site, path)).toBe("https://techytree.in/contribute-now/?sector=agriculture-dairy&robot=milking-robots");
    expect(validateContributeReturn("/contribute-now/?robot=milking-robots&sector=agriculture-dairy", site, path)).toBe("https://techytree.in/contribute-now/?sector=agriculture-dairy&robot=milking-robots");
    for (const bad of ["/contribute-now/?robot=milking-robots", "/contribute-now/?sector=a,b&robot=milking-robots", "/contribute-now/?sector=a&robot=Milking", "/contribute-now/?sector=a&robot=x&robot=y", "/contribute-now/?sector=a&robot=x&utm=1", "/contribute-now/?sector=a&robot="]) {
      expect(validateContributeReturn(bad, site, path), bad).toBeNull();
    }
  });
});
