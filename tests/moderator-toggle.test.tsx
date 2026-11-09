// The moderator toggle on the admin Users page: what the page shows with and without migration 015, who can see it, the recent-changes
// list (names only), and the two helpers behind it. Real SQL on the in-process database (tests/helpers.ts). No real database or network.
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

import UsersPage from "../src/app/admin/users/page";
import { pool } from "../src/lib/db";
import { moderatorFlags, recentModeratorChanges, setModerator } from "../src/lib/moderators";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const tokenFor = (id: string, role: string) => createSessionToken({ id, role }, false, Date.now(), { SESSION_SECRET: SECRET } as never).token;
const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p);
const page = async () => renderToStaticMarkup((await UsersPage()) as React.ReactElement);
let admin: { id: string }, ann: { id: string }, bob: { id: string };

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  admin = await seedUser({ email: "boss@example.com", role: "admin", fullName: "The Boss" });
  ann = await seedUser({ email: "ann@example.com", role: "ST", fullName: "Ann Sample" });
  bob = await seedUser({ email: "bob@example.com", role: "TC", fullName: "Bob Sample" });
  m.cookie = tokenFor(admin.id, "admin");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); testDb().failOn(undefined); });

describe("the Users page with migration 015", () => {
  it("adds a Moderator column and one toggle per person, and says changes are recorded", async () => {
    const h = await page();
    expect(h).toContain(">Moderator</th>");
    expect(h).toContain("each change is recorded");
    expect(h.match(/>Make moderator</g) ?? []).toHaveLength(3); // admin, Ann and Bob (the admin's own button is disabled)
    expect(h).toContain("Make a moderator: Ann Sample");
  });

  it("your own row cannot be changed: the button is disabled and says why", async () => {
    const h = await page();
    const own = h.match(/<button[^>]*aria-label="Make a moderator: The Boss"[^>]*>/)?.[0] ?? "";
    expect(own).toContain("disabled");
    expect(own).toContain("You cannot change your own moderator flag");
    expect(h).toContain("Your own flag cannot be changed.");
    const ann1 = h.match(/<button[^>]*aria-label="Make a moderator: Ann Sample"[^>]*>/)?.[0] ?? "";
    expect(ann1).not.toContain("disabled");
  });

  it("shows who is a moderator, and the button becomes 'Remove moderator'", async () => {
    expect((await setModerator(pool as never, Number(admin.id), Number(bob.id), true)).ok).toBe(true);
    const h = await page();
    expect(h).toContain("Remove moderator flag from Bob Sample");
    expect(h).toMatch(/adm-pill">Moderator</);
    expect(h).toContain("Make a moderator: Ann Sample");
  });

  it("lists recent changes with names only (no email, no id) and says who did it", async () => {
    await setModerator(pool as never, Number(admin.id), Number(ann.id), true);
    await setModerator(pool as never, Number(admin.id), Number(ann.id), false);
    const h = await page();
    expect(h).toContain("Recent moderator changes");
    expect(h).toContain("Made a moderator");
    expect(h).toContain("Moderator flag removed");
    const section = h.slice(h.indexOf("Recent moderator changes"));
    expect(section).toContain("Ann Sample");
    expect(section).toContain("The Boss");
    expect(section).not.toContain("ann@example.com");
    expect(section).not.toContain("boss@example.com");
  });

  it("a manual database step is listed too, without a name for who did it", async () => {
    await q("UPDATE users SET is_moderator = true WHERE id = $1", [ann.id]);
    expect(await page()).toContain("A manual database step");
  });

  it("shows no list of changes when there are none", async () => {
    expect(await page()).not.toContain("Recent moderator changes");
  });

  it("only an administrator can open it", async () => {
    m.cookie = tokenFor(ann.id, "ST");
    await expect(UsersPage()).rejects.toThrow(/REDIRECT:\/dashboard/);
    m.cookie = undefined;
    await expect(UsersPage()).rejects.toThrow(/REDIRECT:\/login/);
  });

  it("the page still shows the same people, roles and join dates as before", async () => {
    const h = await page();
    for (const x of ["ann@example.com", "bob@example.com", "boss@example.com", "Ann Sample", "Bob Sample"]) expect(h).toContain(x);
    expect(h).toContain(">Joined</th>");
    expect(h).toContain(">Role</th>");
  });
});

describe("the Users page before migration 015 is applied", () => {
  it("works as before: read-only, no Moderator column, no buttons, no failure", async () => {
    testDb().failOn((sql) => (/is_moderator/.test(sql) ? Object.assign(new Error('column "is_moderator" does not exist'), { code: "42703" }) : undefined));
    const h = await page();
    expect(h).toContain("This list is read-only.");
    expect(h).not.toContain(">Moderator</th>");
    expect(h).not.toContain("Make moderator");
    expect(h).toContain("ann@example.com");
  });
});

describe("moderatorFlags", () => {
  it("reads the flag for the given users and ignores anything that is not a user id", async () => {
    await setModerator(pool as never, Number(admin.id), Number(bob.id), true);
    const r = await moderatorFlags(pool as never, [admin.id, ann.id, bob.id, "x; DROP TABLE users", "-5", ""]);
    expect(r.ready).toBe(true);
    expect([...r.flags.entries()].sort()).toEqual([[admin.id, false], [ann.id, false], [bob.id, true]].sort());
  });
  it("is ready (and empty) for an empty list", async () => {
    expect(await moderatorFlags(pool as never, [])).toEqual({ ready: true, flags: new Map() });
  });
  it("says not ready when the column does not exist, and rethrows any other error", async () => {
    const missing = { query: async () => { throw Object.assign(new Error("no column"), { code: "42703" }); } };
    expect((await moderatorFlags(missing, ["1"])).ready).toBe(false);
    const broken = { query: async () => { throw Object.assign(new Error("down"), { code: "57P01" }); } };
    await expect(moderatorFlags(broken, ["1"])).rejects.toThrow("down");
  });
});

describe("recentModeratorChanges", () => {
  it("returns the newest first, at most the limit, with names only", async () => {
    await setModerator(pool as never, Number(admin.id), Number(ann.id), true);
    await setModerator(pool as never, Number(admin.id), Number(bob.id), true);
    const rows = await recentModeratorChanges(pool as never, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ by: "The Boss", person: "Bob Sample", granted: true });
    expect(Object.keys(rows[0]).sort()).toEqual(["by", "granted", "person", "when"]);
  });
  it("is empty when the audit table does not exist, and rethrows other errors", async () => {
    expect(await recentModeratorChanges({ query: async () => { throw Object.assign(new Error("no table"), { code: "42P01" }); } })).toEqual([]);
    await expect(recentModeratorChanges({ query: async () => { throw Object.assign(new Error("down"), { code: "57P01" }); } })).rejects.toThrow("down");
  });
  it("clamps a silly limit", async () => {
    const seen: unknown[][] = [];
    await recentModeratorChanges({ query: async (_s: string, p?: unknown[]) => { seen.push(p ?? []); return { rows: [] }; } }, 99999);
    await recentModeratorChanges({ query: async (_s: string, p?: unknown[]) => { seen.push(p ?? []); return { rows: [] }; } }, -3);
    expect(seen).toEqual([[50], [1]]);
  });
});
