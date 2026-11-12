// GET /api/auth/menu: what the shared header account menu draws, for a visitor, a member, a moderator and an administrator.
// Real migrations (PGlite); only "who is signed in" is stubbed (getCurrentUser has its own tests). No email, id or full name leaves.
import { afterEach, describe, expect, it, vi } from "vitest";

const who = vi.hoisted(() => ({ u: null as null | { id: string; fullName: string; email: string; role: string } }));
vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
vi.mock("../src/lib/currentUser", async (orig) => ({ ...(await orig<typeof import("../src/lib/currentUser")>()), getCurrentUser: async () => who.u }));

import { NextRequest } from "next/server";
import { makeFakePool, pgError, seedUser, testDb } from "./helpers";
import { GET, OPTIONS } from "../src/app/api/auth/menu/route";

const URL_ = "https://app.techytree.in/api/auth/menu";
const ask = (headers: Record<string, string> = {}) => GET(new NextRequest(URL_, { headers: { host: "app.techytree.in", ...headers } }));
const body = async (headers?: Record<string, string>) => (await ask(headers)).json();

let n = 0;
async function item(userId: string, status: "draft" | "pending_review" | "changes_requested", demo = false) {
  const raw = testDb().raw;
  const sid = (await raw.query("INSERT INTO sectors (slug, name, sort_order, is_active, is_demo) VALUES ('menu-test', 'Menu Test', 1, true, false) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id")).rows[0] as { id: number };
  const c = (await raw.query("INSERT INTO contributions (user_id, type, title, body, is_demo) VALUES ($1, 'problem', $2, 'A description that is long enough.', $3) RETURNING id", [userId, `Menu test item number ${++n}`, demo])).rows[0] as { id: number };
  await raw.query("INSERT INTO contribution_scopes (contribution_id, sector_id) VALUES ($1, $2)", [c.id, sid.id]);
  if (status !== "draft") await raw.query("UPDATE contributions SET status = $2, submitted_at = now() WHERE id = $1", [c.id, status]);
}
async function asUser(over: { email: string; role: string; fullName: string; moderator?: boolean }) {
  const u = await seedUser({ email: over.email, role: over.role, fullName: over.fullName });
  if (over.moderator) await testDb().raw.query("UPDATE users SET is_moderator = true WHERE id = $1", [u.id]);
  who.u = { id: u.id, fullName: over.fullName, email: over.email, role: over.role };
  return u;
}

afterEach(() => { who.u = null; });

describe("GET /api/auth/menu", () => {
  it("signed out: only { authenticated: false }, never cached", async () => {
    const res = await ask();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ authenticated: false });
  });

  it("a member: their first name, initial, stakeholder label and how many contributions they have (all of theirs, nobody else's)", async () => {
    const me = await asUser({ email: "asha@example.com", role: "ST", fullName: "Asha Rao" });
    const other = await seedUser({ email: "other@example.com", fullName: "Other Person" });
    await item(me.id, "draft"); await item(me.id, "pending_review"); await item(me.id, "changes_requested");
    await item(other.id, "pending_review");
    const res = await ask();
    expect(res.headers.get("cache-control")).toBe("no-store");
    const b = await res.json();
    expect(b).toEqual({ authenticated: true, role: "member", firstName: "Asha", initial: "A", stakeholder: "Student", counts: { myContributions: 3 } });
    expect(JSON.stringify(b)).not.toMatch(/asha@|Rao|"id"|email/i);
  });

  it("a moderator: role moderator, no stakeholder line, and the pending review count (not drafts, not demo items)", async () => {
    await asUser({ email: "ravi@example.com", role: "TC", fullName: "Ravi Kumar", moderator: true });
    const m = await seedUser({ email: "m@example.com", fullName: "Mem Ber" });
    await item(m.id, "pending_review"); await item(m.id, "pending_review"); await item(m.id, "pending_review", true); await item(m.id, "draft"); await item(m.id, "changes_requested");
    expect(await body()).toEqual({ authenticated: true, role: "moderator", firstName: "Ravi", initial: "R", stakeholder: null, counts: { reviewQueue: 2 } });
  });

  it("an administrator: role admin and the same pending review count", async () => {
    await asUser({ email: "admin@example.com", role: "admin", fullName: "Ola Admin" });
    const m = await seedUser({ email: "m2@example.com", fullName: "Mem Ber" });
    await item(m.id, "pending_review");
    expect(await body()).toEqual({ authenticated: true, role: "admin", firstName: "Ola", initial: "O", stakeholder: null, counts: { reviewQueue: 1 } });
  });

  it("a name that starts with a non-ASCII letter keeps the whole letter as the initial", async () => {
    await asUser({ email: "e@example.com", role: "ST", fullName: "élan Varma" });
    expect((await body()).initial).toBe("É");
  });

  it("when the count cannot be read, the menu still gets the role (counts: null), never an error", async () => {
    await asUser({ email: "asha2@example.com", role: "ST", fullName: "Asha Rao" });
    makeFakePool((sql) => (/FROM contributions/.test(sql) ? pgError("42P01") : undefined));
    const res = await ask();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ authenticated: true, role: "member", counts: null });
  });

  it("answers techytree.in and the app itself with credentials; any other site gets 403 and no CORS header (same rule as /api/auth/session)", async () => {
    await asUser({ email: "asha3@example.com", role: "ST", fullName: "Asha Rao" });
    const site = await ask({ origin: "https://techytree.in" });
    expect(site.status).toBe(200);
    expect(site.headers.get("access-control-allow-origin")).toBe("https://techytree.in");
    expect(site.headers.get("access-control-allow-credentials")).toBe("true");
    expect(site.headers.get("vary")).toMatch(/Origin/);
    const self = await ask({ origin: "https://app.techytree.in" });
    expect(self.status).toBe(200);
    expect(self.headers.get("access-control-allow-origin")).toBeNull();
    const evil = await ask({ origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    expect(await evil.json()).toEqual({ authenticated: false, error: "ORIGIN_NOT_ALLOWED" });
  });

  it("the preflight follows the same rule", async () => {
    const ok = await OPTIONS(new Request(URL_, { method: "OPTIONS", headers: { origin: "https://techytree.in", host: "app.techytree.in" } }));
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://techytree.in");
    expect(ok.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    const no = await OPTIONS(new Request(URL_, { method: "OPTIONS", headers: { origin: "https://evil.example", host: "app.techytree.in" } }));
    expect(no.status).toBe(403);
  });
});
