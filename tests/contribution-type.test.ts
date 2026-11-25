// P1 (plugin 0.1.10, migration 023): the Contribute form's "What would you like to share?" - Describe a problem / Share an idea /
// Share a video or resource, saved as problem / improve / resource with contributions.type_chosen. Older contributions show
// "Type: not asked (older form)". Edit keeps the saved type and lets the member change it. Moderation's item page, the review API and
// the CSV show it. Every role, through the real route handlers, real sessions (signed cookies read by the real getCurrentUser; role
// and moderator flag read from the database), the real moderation page and real SQL with the real migrations (tests/helpers.ts).
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }), redirect: (to: string) => { throw new Error("REDIRECT:" + to); }, usePathname: () => "/moderation" }));

import * as create from "../src/app/api/contributions/route";
import * as one from "../src/app/api/contributions/[id]/route";
import * as submit from "../src/app/api/contributions/[id]/submit/route";
import * as mine from "../src/app/api/contributions/mine/route";
import * as review from "../src/app/api/review/[id]/route";
import * as queue from "../src/app/api/review/queue/route";
import * as exportRoute from "../src/app/api/review/export/route";
import Detail from "../src/app/(reviewer)/admin/moderation/[id]/page";
import { readTypeChosen } from "../src/lib/contributionApi";
import { FORM_TYPES, TYPE_NOT_ASKED, typeShown } from "../src/lib/contributions";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
const signInAs = (id: number | null, role = "ST") => { m.cookie = id === null ? undefined : createSessionToken({ id: String(id), role }, false, Date.now(), { SESSION_SECRET: SECRET } as never).token; };
let ipn = 0, seq = 0;
const ip = () => `46.${Math.floor(++ipn / 250)}.${ipn % 250}.1`;
type Fn = (r: Request, c?: unknown) => Promise<Response>;
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const call = async (fn: unknown, method: string, url: string, body?: unknown, id?: number) => {
  const r = await (fn as Fn)(new Request("http://localhost" + url, { method, headers: { "x-forwarded-for": ip(), host: "localhost", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), id === undefined ? undefined : ctx(id));
  const ct = r.headers.get("content-type") ?? "";
  return { r, b: (ct.includes("json") ? await r.json() : null) as any, text: ct.includes("csv") ? await r.text() : "" };
};
const person = async (role: string, moderator = false) => {
  const u = await seedUser({ email: `ty${++seq}@example.com`, role, fullName: `Person${seq} Rao` });
  if (moderator) await q("UPDATE users SET is_moderator = true WHERE id = $1", [u.id]);
  return Number(u.id);
};
const ROLE = new Map<number, string>();
const as = async (id: number | null) => { signInAs(id, id === null ? "ST" : ROLE.get(id) ?? "ST"); };
async function member() { const id = await person("TC"); ROLE.set(id, "TC"); return id; }
async function moderator() { const id = await person("TC", true); ROLE.set(id, "TC"); return id; }
async function admin() { const id = await person("admin"); ROLE.set(id, "admin"); return id; }
const draft = (over: Record<string, unknown> = {}) => ({ type: "resource", sectors: ["agriculture-dairy"], title: `Village dairy robot ${++seq}`, description: "A small robot that helps clean the milking area every morning.", role: "Teacher / lab in-charge", district: "", ...over });
const row = async (id: number) => (await q("SELECT type, type_chosen FROM contributions WHERE id = $1", [id])).rows[0] as { type: string; type_chosen: boolean };
async function make(body: Record<string, unknown>) {
  const x = await call(create.POST, "POST", "/api/contributions", draft(body));
  expect(x.r.status, JSON.stringify(x.b)).toBe(201);
  return Number(x.b.id);
}
async function send(id: number) { const x = await call(submit.POST, "POST", `/api/contributions/${id}/submit`, undefined, id); expect(x.r.status, JSON.stringify(x.b)).toBe(200); }
const forEdit = async (id: number) => (await call(one.GET, "GET", `/api/contributions/${id}`, undefined, id)).b.contribution;
const page = async (id: number) => renderToStaticMarkup(await Detail({ params: Promise.resolve({ id: String(id) }), searchParams: Promise.resolve({}) }));
/** the Type row of the moderation item page: [chosen?, the words shown] */
const typeRow = (html: string) => { const x = /<div class="mod-field" data-type-chosen="(yes|no)"><dt>Type<\/dt><dd[^>]*>([^<]*)<\/dd><\/div>/.exec(html); return x ? [x[1], x[2]] : null; };
const parse = (csv: string) => csv.replace(/^﻿/, "").trim().split("\r\n").map((line) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((x) => x[1]!.replace(/""/g, '"')));

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  m.cookie = undefined;
  await q("DELETE FROM api_rate_limits");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); testDb().failOn(undefined); });

describe("the three types and how they are shown", () => {
  it("the form's words and stored values; an older contribution shows 'not asked (older form)', whatever its stored type", () => {
    expect(FORM_TYPES.map((t) => [t.label, t.id])).toEqual([["Describe a problem", "problem"], ["Share an idea", "improve"], ["Share a video or resource", "resource"]]);
    expect(TYPE_NOT_ASKED).toBe("not asked (older form)");
    expect(typeShown("problem", true)).toBe("Describe a problem");
    expect(typeShown("improve", true)).toBe("Share an idea");
    expect(typeShown("resource", true)).toBe("Share a video or resource");
    for (const t of ["resource", "problem", "challenge"]) expect(typeShown(t, false)).toBe("not asked (older form)");
  });
  it("only an exact true says the member chose it", () => {
    expect(readTypeChosen({ typeChosen: true })).toBe(true);
    for (const v of [false, "true", 1, "yes", null, undefined]) expect(readTypeChosen({ typeChosen: v })).toBe(false);
    expect(readTypeChosen({})).toBe(false); expect(readTypeChosen(null)).toBe(false); expect(readTypeChosen([true])).toBe(false);
  });
});

describe("member: choosing, keeping and changing the type", () => {
  it("each of the three is saved as chosen and comes back for Edit and in My Contributions with the form's words", async () => {
    const me = await member(); await as(me);
    for (const t of FORM_TYPES) {
      const id = await make({ type: t.id, typeChosen: true });
      expect(await row(id)).toEqual({ type: t.id, type_chosen: true });
      expect(await forEdit(id)).toMatchObject({ type: t.id, typeChosen: true });
    }
    const list = (await call(mine.GET, "GET", "/api/contributions/mine")).b.items as any[];
    expect(list.map((i) => [i.type, i.typeChosen, i.typeLabel]).sort()).toEqual([["improve", true, "Share an idea"], ["problem", true, "Describe a problem"], ["resource", true, "Share a video or resource"]]);
  });
  it("with typeChosen, only the form's three types are accepted; nothing is saved otherwise", async () => {
    const me = await member(); await as(me);
    const before = Number(((await q("SELECT count(*)::int n FROM contributions")).rows[0] as any).n);
    for (const type of ["challenge", "idea", "", "PROBLEM", "supplier"]) {
      const x = await call(create.POST, "POST", "/api/contributions", draft({ type, typeChosen: true }));
      expect(x.r.status).toBe(400);
      expect(x.b.fieldErrors).toEqual({ type: "Choose what you would like to share: a problem, an idea, or a video or resource." });
    }
    expect(Number(((await q("SELECT count(*)::int n FROM contributions")).rows[0] as any).n)).toBe(before);
  });
  it("an older form (no typeChosen, always 'resource') still saves, as 'not asked'", async () => {
    const me = await member(); await as(me);
    const id = await make({});
    expect(await row(id)).toEqual({ type: "resource", type_chosen: false });
    expect(await forEdit(id)).toMatchObject({ type: "resource", typeChosen: false });
    const item = ((await call(mine.GET, "GET", "/api/contributions/mine")).b.items as any[]).find((i) => i.id === id);
    expect(item).toMatchObject({ typeLabel: "not asked (older form)", typeChosen: false });
  });
  it("Edit after changes requested keeps the saved type and lets the member change it", async () => {
    const me = await member(); await as(me);
    const id = await make({ type: "problem", typeChosen: true }); await send(id);
    await q("UPDATE contributions SET status = 'changes_requested' WHERE id = $1", [id]);
    expect(await forEdit(id)).toMatchObject({ status: "changes_requested", type: "problem", typeChosen: true });
    // keep it
    expect((await call(one.PATCH, "PATCH", `/api/contributions/${id}`, draft({ type: "problem", typeChosen: true }), id)).r.status).toBe(200);
    expect(await row(id)).toEqual({ type: "problem", type_chosen: true });
    // change it
    expect((await call(one.PATCH, "PATCH", `/api/contributions/${id}`, draft({ type: "improve", typeChosen: true }), id)).r.status).toBe(200);
    expect(await row(id)).toEqual({ type: "improve", type_chosen: true });
    await send(id);
    expect(((await q("SELECT status FROM contributions WHERE id = $1", [id])).rows[0] as any).status).toBe("pending_review");
    expect(await row(id)).toEqual({ type: "improve", type_chosen: true });
  });
  it("a form older than 0.1.10 (still cached somewhere) never changes a chosen type: its 'resource' is ignored", async () => {
    const me = await member(); await as(me);
    const id = await make({ type: "problem", typeChosen: true });
    expect((await call(one.PATCH, "PATCH", `/api/contributions/${id}`, draft({ type: "resource" }), id)).r.status).toBe(200);
    expect(await row(id)).toEqual({ type: "problem", type_chosen: true });
  });
  it("an older contribution gets its type once the member picks one in Edit", async () => {
    const me = await member(); await as(me);
    const id = await make({}); await send(id);
    await q("UPDATE contributions SET status = 'changes_requested' WHERE id = $1", [id]);
    expect(await forEdit(id)).toMatchObject({ type: "resource", typeChosen: false });
    expect((await call(one.PATCH, "PATCH", `/api/contributions/${id}`, draft({ type: "problem", typeChosen: true }), id)).r.status).toBe(200);
    expect(await row(id)).toEqual({ type: "problem", type_chosen: true });
  });
  it("nobody else can read or change it: another member gets 404, a visitor 401", async () => {
    const owner = await member(); await as(owner);
    const id = await make({ type: "improve", typeChosen: true });
    await as(await member());
    expect((await call(one.GET, "GET", `/api/contributions/${id}`, undefined, id)).r.status).toBe(404);
    expect((await call(one.PATCH, "PATCH", `/api/contributions/${id}`, draft({ type: "problem", typeChosen: true }), id)).r.status).toBe(404);
    await as(null);
    expect((await call(one.GET, "GET", `/api/contributions/${id}`, undefined, id)).r.status).toBe(401);
    expect((await call(create.POST, "POST", "/api/contributions", draft({ type: "problem", typeChosen: true }))).r.status).toBe(401);
    expect(await row(id)).toEqual({ type: "improve", type_chosen: true });
  });
});

describe("reviewers: Moderation's item page, the review API and the CSV show the type", () => {
  async function items() {
    const author = await member(); await as(author);
    const chosen = await make({ type: "improve", typeChosen: true, title: "Chosen type item" }); await send(chosen);
    const older = await make({ title: "Older form item" }); await send(older);
    return { chosen, older };
  }
  for (const who of ["moderator", "admin"] as const) {
    it(`${who}: the item page has a Type row; an older item says 'not asked (older form)'`, async () => {
      const { chosen, older } = await items();
      await as(who === "admin" ? await admin() : await moderator());
      expect(typeRow(await page(chosen))).toEqual(["yes", "Share an idea"]);
      const h = await page(older);
      expect(typeRow(h)).toEqual(["no", "not asked (older form)"]);
      expect(h).not.toMatch(/Share a video or resource/); // its stored 'resource' is a default, never shown as a choice
    });
    it(`${who}: the review API answers with the type and whether it was chosen`, async () => {
      const { chosen, older } = await items();
      await as(who === "admin" ? await admin() : await moderator());
      expect((await call(review.GET, "GET", `/api/review/${chosen}`, undefined, chosen)).b.item).toMatchObject({ type: "improve", typeChosen: true, typeLabel: "Share an idea" });
      expect((await call(review.GET, "GET", `/api/review/${older}`, undefined, older)).b.item).toMatchObject({ type: "resource", typeChosen: false, typeLabel: "not asked (older form)" });
      const list = (await call(queue.GET, "GET", "/api/review/queue")).b.items as any[];
      expect(list.find((i) => i.id === chosen)).toMatchObject({ typeLabel: "Share an idea", typeChosen: true });
      expect(list.find((i) => i.id === older)).toMatchObject({ typeLabel: "not asked (older form)", typeChosen: false });
    });
    it(`${who}: the CSV has a Type column right after Title`, async () => {
      const { chosen, older } = await items();
      await as(who === "admin" ? await admin() : await moderator());
      const x = await call(exportRoute.GET, "GET", "/api/review/export?sector=agriculture-dairy&tab=all");
      expect(x.r.status).toBe(200);
      const rows = parse(x.text);
      expect(rows[0]!.slice(0, 5)).toEqual(["ID", "Title", "Type", "Robot", "Also in"]); // P3 added Robot after Type
      const byId = new Map(rows.slice(1).map((r) => [Number(r[0]), r]));
      expect(byId.get(chosen)![2]).toBe("Share an idea");
      expect(byId.get(older)![2]).toBe("not asked (older form)");
    });
  }
  it("a member cannot reach any of it: the item page sends them to their dashboard, the review API and the CSV refuse (403); a visitor is sent to sign in (401)", async () => {
    const { chosen } = await items();
    await as(await member());
    await expect(page(chosen)).rejects.toThrow("REDIRECT:/dashboard");
    expect((await call(review.GET, "GET", `/api/review/${chosen}`, undefined, chosen)).r.status).toBe(403);
    expect((await call(exportRoute.GET, "GET", "/api/review/export?sector=agriculture-dairy&tab=all")).r.status).toBe(403);
    await as(null);
    await expect(page(chosen)).rejects.toThrow("REDIRECT:/login");
    expect((await call(review.GET, "GET", `/api/review/${chosen}`, undefined, chosen)).r.status).toBe(401);
    expect((await call(exportRoute.GET, "GET", "/api/review/export?sector=agriculture-dairy&tab=all")).r.status).toBe(401);
  });
  it("reviewers do not send contributions, so they never choose a type (the app refuses with 403 before anything is saved)", async () => {
    for (const reviewer of [await moderator(), await admin()]) {
      await as(reviewer);
      expect((await call(create.POST, "POST", "/api/contributions", draft({ type: "problem", typeChosen: true }))).r.status).toBe(403);
    }
  });
});

describe("before migration 023 is applied (the column is missing)", () => {
  const missing = (sql: string) => (/type_chosen\s*=\s*true/.test(sql) ? Object.assign(new Error("column \"type_chosen\" of relation \"contributions\" does not exist"), { code: "42703" }) : undefined);
  it("the chosen type is still saved in contributions.type; nothing fails; everything reads as 'not asked'", async () => {
    const me = await member(); await as(me);
    testDb().failOn(missing);
    const id = await make({ type: "problem", typeChosen: true });
    expect(((await q("SELECT type FROM contributions WHERE id = $1", [id])).rows[0] as any).type).toBe("problem");
    expect(((await q("SELECT type_chosen FROM contributions WHERE id = $1", [id])).rows[0] as any).type_chosen).toBe(false); // the write was refused
    await send(id);
    testDb().failOn(undefined);
  });
  it("without the column the reads use the default 'not asked' (no error): Edit, My Contributions, the item page and the CSV", async () => {
    const author = await member(); await as(author);
    const id = await make({ type: "improve", typeChosen: true }); await send(id);
    await q("ALTER TABLE contributions DROP COLUMN type_chosen"); // as on a database without 023 (this test database only)
    try {
      expect(await forEdit(id)).toMatchObject({ type: "improve", typeChosen: false });
      const it1 = ((await call(mine.GET, "GET", "/api/contributions/mine")).b.items as any[]).find((i) => i.id === id);
      expect(it1).toMatchObject({ typeLabel: "not asked (older form)", typeChosen: false });
      // a new contribution and an edit still save
      const id2 = await make({ type: "resource", typeChosen: true });
      expect(((await q("SELECT type FROM contributions WHERE id = $1", [id2])).rows[0] as any).type).toBe("resource");
      expect((await call(one.PATCH, "PATCH", `/api/contributions/${id2}`, draft({ type: "problem", typeChosen: true }), id2)).r.status).toBe(200);
      expect(((await q("SELECT type FROM contributions WHERE id = $1", [id2])).rows[0] as any).type).toBe("problem");
      await as(await admin());
      expect(typeRow(await page(id))).toEqual(["no", "not asked (older form)"]);
      const rows = parse((await call(exportRoute.GET, "GET", "/api/review/export?sector=agriculture-dairy&tab=all")).text);
      expect(rows.find((r) => Number(r[0]) === id)![2]).toBe("not asked (older form)");
    } finally {
      await q("ALTER TABLE contributions ADD COLUMN IF NOT EXISTS type_chosen boolean NOT NULL DEFAULT false");
    }
  });
});
