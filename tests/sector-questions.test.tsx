// P5: Sector forms part 2, each sector's questions (migration 026). Who may change them (signed out, member, moderator, administrator),
// the rules (5 on, 2 required, optional by default, never deleted, kind fixed), the page with its preview, and the app before 026.
// In-process database (PGlite), real routes and real session cookies.
import { readFileSync } from "node:fs";
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

import * as addRoute from "../src/app/api/admin/sector-forms/[slug]/questions/route";
import * as changeRoute from "../src/app/api/admin/sector-forms/[slug]/questions/[id]/route";
import SectorFormsPage from "../src/app/admin/sector-forms/page";
import SectorFormPage from "../src/app/admin/sector-forms/[slug]/page";
import { cleanChoices, cleanQuestionLabel, parseNewQuestion } from "../src/lib/sectorQuestions";
import { MODERATOR_ROLE } from "../src/lib/reviewerHome";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
const signInAs = (id: number | null, role = "ST") => { m.cookie = id === null ? undefined : createSessionToken({ id: String(id), role }, false, Date.now(), { SESSION_SECRET: SECRET } as never).token; };
let ipn = 0, seq = 0;
const req = (url: string, method: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost" + url, { method, headers: { host: "localhost", "content-type": "application/json", "x-forwarded-for": `42.0.${Math.floor(++ipn / 250)}.${ipn % 250}`, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
async function add(slug: string, body: unknown, headers?: Record<string, string>) {
  const r = await addRoute.POST(req(`/api/admin/sector-forms/${slug}/questions`, "POST", body, headers), { params: Promise.resolve({ slug }) });
  return { status: r.status, b: (await r.json()) as any };
}
async function change(slug: string, id: number | string, body: unknown, headers?: Record<string, string>) {
  const r = await changeRoute.PATCH(req(`/api/admin/sector-forms/${slug}/questions/${id}`, "PATCH", body, headers), { params: Promise.resolve({ slug, id: String(id) }) });
  return { status: r.status, b: (await r.json()) as any };
}
const text = (label: string, required = false) => ({ label, kind: "text", required });
const choice = (label: string, options: string[], required = false) => ({ label, kind: "choice", options, required });
const rows = async (slug = "agriculture-dairy") => (await q("SELECT q.id, q.label, q.kind, q.options, q.is_required, q.is_active, q.sort_order, q.updated_by FROM sector_questions q JOIN sectors s ON s.id = q.sector_id WHERE s.slug = $1 ORDER BY q.sort_order, q.id", [slug])).rows as any[];
const count = async () => Number(((await q("SELECT count(*)::int n FROM sector_questions")).rows[0] as any).n);
const redirectOf = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { const x = /^REDIRECT:(.*)$/.exec(String((e as Error).message)); if (x) return x[1]; throw e; } };
const html = async (p: Promise<any>) => renderToStaticMarkup(await p);
const formPage = (slug: string) => SectorFormPage({ params: Promise.resolve({ slug }) });

let admin = 0, member = 0;
beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  m.cookie = undefined;
  await q("DELETE FROM api_rate_limits");
  admin = Number((await seedUser({ email: `boss${++seq}@example.com`, role: "admin", fullName: "Boss" })).id);
  member = Number((await seedUser({ email: `member${++seq}@example.com`, role: "ST", fullName: "Member" })).id);
  await q("INSERT INTO sectors (slug, name, sort_order) VALUES ('education','Education',20) ON CONFLICT DO NOTHING");
  await q("INSERT INTO sectors (slug, name, sort_order, is_demo) VALUES ('demo-sector','Demo sector',40,true) ON CONFLICT DO NOTHING");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); testDb().failOn(undefined); });

describe("who may change the questions", () => {
  it("signed out 401, member 403, moderators 403 (both kinds), a token claiming admin for a member 403; nothing changes", async () => {
    signInAs(admin, "admin"); const first = (await add("agriculture-dairy", text("How many animals?"))).b.question.id;
    const mod = Number((await seedUser({ email: `mod${++seq}@example.com`, role: "TC", fullName: "Mod" })).id);
    const mod2 = Number((await seedUser({ email: `mod${++seq}@example.com`, role: MODERATOR_ROLE, fullName: "Mod Two" })).id);
    await q("UPDATE users SET is_moderator = true WHERE id = ANY($1::bigint[])", [[mod, mod2]]);
    for (const [id, role, want] of [[null, "ST", 401], [member, "ST", 403], [mod, "TC", 403], [mod2, MODERATOR_ROLE, 403], [member, "admin", 403]] as const) {
      signInAs(id, role);
      expect((await add("agriculture-dairy", text("Who milks the cows?"))).status, `${role} add`).toBe(want);
      expect((await change("agriculture-dairy", first, { required: true })).status, `${role} change`).toBe(want);
    }
    expect((await rows()).map((r) => [r.label, r.is_required])).toEqual([["How many animals?", false]]);
  });
  it("the pages send members and moderators away, and visitors to sign in", async () => {
    signInAs(null); expect(await redirectOf(formPage("agriculture-dairy"))).toBe("/login");
    signInAs(member, "ST"); expect(await redirectOf(formPage("agriculture-dairy"))).toBe("/dashboard");
    const mod = Number((await seedUser({ email: `mod${++seq}@example.com`, role: "TC", fullName: "Mod" })).id);
    await q("UPDATE users SET is_moderator = true WHERE id = $1", [mod]);
    signInAs(mod, "TC"); expect(await redirectOf(formPage("agriculture-dairy"))).toBe("/dashboard");
  });
  it("an administrator with a temporary password: 403 PASSWORD_CHANGE_REQUIRED; from another website: 403", async () => {
    signInAs(admin, "admin");
    expect((await add("agriculture-dairy", text("How many animals?"), { origin: "https://evil.example" })).status).toBe(403);
    await q("UPDATE users SET must_change_password = true WHERE id = $1", [admin]);
    const x = await add("agriculture-dairy", text("How many animals?"));
    expect([x.status, x.b.error]).toEqual([403, "PASSWORD_CHANGE_REQUIRED"]);
    expect(await count()).toBe(0);
  });
  it("questions can never be deleted: the routes have only POST and PATCH, and the code has no DELETE", () => {
    expect(Object.keys(addRoute).filter((k) => /^[A-Z]+$/.test(k))).toEqual(["POST"]);
    expect(Object.keys(changeRoute).filter((k) => /^[A-Z]+$/.test(k))).toEqual(["PATCH"]);
    expect(readFileSync("src/lib/sectorQuestions.ts", "utf8").replace(/\/\/.*$/gm, "")).not.toMatch(/DELETE\s+FROM/i);
  });
});

describe("the rules (administrator)", () => {
  beforeEach(() => signInAs(admin, "admin"));

  it("adds short-text and pick-one questions at the end, optional by default, cleaned, and records who added them", async () => {
    const a = await add("agriculture-dairy", { label: "  How many   animals? ", kind: "text" });
    expect(a.status).toBe(200);
    expect(a.b.question).toMatchObject({ label: "How many animals?", kind: "text", options: null, required: false, active: true });
    await add("agriculture-dairy", choice("Which shed?", [" North ", "", "South", "  "]));
    expect((await rows()).map((r) => [r.label, r.kind, r.options, r.is_required, r.sort_order, Number(r.updated_by)])).toEqual([
      ["How many animals?", "text", null, false, 10, admin], ["Which shed?", "choice", ["North", "South"], false, 20, admin],
    ]);
  });
  it("refuses wording, kinds and choices that cannot be used", async () => {
    for (const body of [
      { label: "Hm?", kind: "text" }, { label: "x".repeat(201), kind: "text" }, { label: "Two\nlines here", kind: "text" }, { label: "<b>Bold</b> text", kind: "text" },
      { label: "How many animals?", kind: "number" }, { label: "How many animals?", kind: "text", options: ["a", "b"] }, { label: "How many animals?", kind: "text", required: "yes" },
      choice("Which shed?", ["Only one"]), choice("Which shed?", Array.from({ length: 11 }, (_, i) => `Choice ${i}`)), choice("Which shed?", ["North", "north"]), choice("Which shed?", ["x".repeat(61), "South"]),
      { label: "Which shed?", kind: "choice" }, [], "nope",
    ]) {
      const x = await add("agriculture-dairy", body);
      expect(x.status, JSON.stringify(body)).toBe(400);
    }
    expect(await count()).toBe(0);
  });
  it(`at most 5 questions ON per sector; switching one off makes room; another sector has its own 5`, async () => {
    const ids: number[] = [];
    for (let i = 1; i <= 5; i++) ids.push((await add("agriculture-dairy", text(`Question number ${i}?`))).b.question.id);
    const x = await add("agriculture-dairy", text("Question number six?"));
    expect([x.status, x.b.error]).toEqual([409, "LIMIT"]);
    expect(x.b.message).toMatch(/up to 5 questions on/);
    expect((await add("education", text("Question number six?"))).status).toBe(200);
    expect((await change("agriculture-dairy", ids[0], { active: false })).status).toBe(200);
    const six = await add("agriculture-dairy", text("Question number six?"));
    expect(six.status).toBe(200);
    const back = await change("agriculture-dairy", ids[0], { active: true }); // 5 on again: switching the old one back on is refused
    expect([back.status, back.b.error]).toEqual([409, "LIMIT"]);
    expect(await count()).toBe(7); // nothing was deleted
  });
  it("at most 2 required; a switched-off question is never required (switching off makes it optional) and cannot be made required", async () => {
    const a = (await add("agriculture-dairy", text("First question?", true))).b.question.id;
    const b = (await add("agriculture-dairy", text("Second question?"))).b.question.id;
    const c = (await add("agriculture-dairy", text("Third question?"))).b.question.id;
    expect((await change("agriculture-dairy", b, { required: true })).status).toBe(200);
    const x = await change("agriculture-dairy", c, { required: true });
    expect([x.status, x.b.error]).toEqual([409, "LIMIT"]);
    expect((await add("agriculture-dairy", text("Fourth question?", true))).status).toBe(409);
    expect((await change("agriculture-dairy", a, { active: false })).b.questions.find((qq: any) => qq.id === a)).toMatchObject({ active: false, required: false });
    expect((await change("agriculture-dairy", a, { required: true })).status).toBe(409);
    expect((await change("agriculture-dairy", c, { required: true })).status).toBe(200); // room again
    expect((await rows()).filter((r) => r.is_required).map((r) => r.label)).toEqual(["Second question?", "Third question?"]);
  });
  it("corrects the wording and the choices; the kind cannot change; a text question has no choices", async () => {
    const t = (await add("agriculture-dairy", text("How many animals?"))).b.question.id;
    const p = (await add("agriculture-dairy", choice("Which shed?", ["North", "South"]))).b.question.id;
    expect((await change("agriculture-dairy", t, { label: "How many cows and buffaloes?" })).status).toBe(200);
    expect((await change("agriculture-dairy", p, { options: ["North", "South", "East"] })).status).toBe(200);
    expect((await change("agriculture-dairy", t, { options: ["a", "b"] })).status).toBe(400);
    expect((await change("agriculture-dairy", p, { kind: "text" })).status).toBe(400);
    expect((await change("agriculture-dairy", p, { options: ["Only"] })).status).toBe(400);
    expect((await rows()).map((r) => [r.label, r.kind, r.options])).toEqual([["How many cows and buffaloes?", "text", null], ["Which shed?", "choice", ["North", "South", "East"]]]);
  });
  it("moves up and down; a question of another sector, an unknown or a bad id answers 404; two changes at once answer 400", async () => {
    const a = (await add("agriculture-dairy", text("First question?"))).b.question.id;
    const b = (await add("agriculture-dairy", text("Second question?"))).b.question.id;
    expect((await change("agriculture-dairy", b, { move: "up" })).b.questions.map((x: any) => x.label)).toEqual(["Second question?", "First question?"]);
    expect((await change("agriculture-dairy", a, { move: "down" })).b.questions.map((x: any) => x.label)).toEqual(["Second question?", "First question?"]);
    const e = (await add("education", text("Education question?"))).b.question.id;
    expect((await change("agriculture-dairy", e, { active: false })).status).toBe(404);
    expect((await change("agriculture-dairy", 999999, { active: false })).status).toBe(404);
    expect((await change("agriculture-dairy", "abc", { active: false })).status).toBe(404);
    expect((await change("demo-sector", a, { active: false })).status).toBe(404);
    expect((await change("agriculture-dairy", a, { active: false, required: false })).status).toBe(400);
    expect((await rows("education"))[0].is_active).toBe(true);
  });
  it("before migration 026: adding and changing answer 503; the page says migration 026 is needed and still shows the robot types", async () => {
    testDb().failOn((sql) => (/sector_questions/.test(sql) ? Object.assign(new Error('relation "sector_questions" does not exist'), { code: "42P01" }) : undefined));
    expect((await add("agriculture-dairy", text("How many animals?"))).status).toBe(503);
    expect((await change("agriculture-dairy", 1, { active: false })).status).toBe(503);
    const h = await html(formPage("agriculture-dairy"));
    expect(h).toContain("Questions are not set up on this database yet"); expect(h).toContain("Migration 026 is needed");
    expect(h).toContain("Robot types"); expect(h).not.toContain("Add question");
    expect(await html(SectorFormsPage())).toMatch(/Questions on/);
  });
});

describe("the pages (administrator)", () => {
  beforeEach(() => signInAs(admin, "admin"));
  it("the sector page lists the questions with their state, and previews only the ON ones in order, marked required or optional", async () => {
    await add("agriculture-dairy", text("How many animals?", true));
    const off = (await add("agriculture-dairy", text("A switched off question?"))).b.question.id;
    await add("agriculture-dairy", choice("Which shed?", ["North", "South"]));
    await change("agriculture-dairy", off, { active: false });
    const h = await html(formPage("agriculture-dairy"));
    expect(h).toContain("2 of 5 questions on · 1 of 2 required");
    expect(h).toMatch(/A switched off question\?[\s\S]*Off/);
    const preview = h.slice(h.indexOf("What members will be asked"));
    expect(preview).toMatch(/How many animals\? <small>\(required\)<\/small><input type="text" disabled=""[^>]*maxLength="500"/i);
    expect(preview).toMatch(/Which shed\? <small>\(optional\)<\/small><select disabled=""><option value="" selected="">Choose one<\/option><option>North<\/option><option>South<\/option><\/select>/);
    expect(preview).not.toContain("A switched off question");
  });
  it("the list shows how many questions are on in each sector", async () => {
    await add("agriculture-dairy", text("How many animals?"));
    await add("agriculture-dairy", text("Who milks the cows?"));
    const h = await html(SectorFormsPage());
    expect(h).toMatch(/Agriculture &amp; Dairy[\s\S]*?2 of 5/);
    expect(h).toMatch(/Education[\s\S]*?0 of 5/);
  });
});

describe("small rules", () => {
  it("cleanQuestionLabel, cleanChoices and parseNewQuestion", () => {
    expect(cleanQuestionLabel("  How   many?  ")).toEqual({ label: "How many?" });
    expect("error" in cleanQuestionLabel("Tab\there")).toBe(true);
    expect(cleanChoices(["  A  ", "", "B"])).toEqual({ options: ["A", "B"] });
    expect("error" in cleanChoices(["A", "a"])).toBe(true);
    expect(parseNewQuestion({ label: "How many animals?", kind: "text" })).toEqual({ value: { label: "How many animals?", kind: "text", options: null, required: false } });
  });
});
