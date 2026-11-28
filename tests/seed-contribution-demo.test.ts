// The contribution workflow's DEMO seed (scripts/seed-contribution-demo.mjs): for local and preview copies only, never production.
// It refuses without DEMO_MODE, in a production environment, for a database that is not local (unless that exact preview host is
// named), for the wrong database name, before every migration is applied, and for a database with many real accounts (a live site).
// What it adds is flagged and visible (at least 2 ideas in every status, feedback on the rejected ones, users for every role), it can be
// run twice, and --reset removes ONLY the demo records. In-process databases (PGlite) only.
import { describe, expect, it } from "vitest";
import { MAX_REAL_USERS, OLD_ID_BASE, assertDemoTarget, assertSafeDatabase, plan, resetDemo, seedDemo } from "../scripts/seed-contribution-demo.mjs";
import { migratedClone } from "./helpers/migratedClone";

const LOCAL = "postgresql://u:p@127.0.0.1:5432/rv_demo";
const env = (over: Record<string, string> = {}) => ({ DEMO_MODE: "1", NODE_ENV: "development", ...over }) as NodeJS.ProcessEnv;
const wrap = (pg: any) => ({ query: async (sql: string, params?: unknown[]) => { const r = await pg.query(sql, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; } });
const count = async (pg: any, sql: string) => Number(((await pg.query(sql)).rows[0] as any).n);

describe("never against a live database", () => {
  it("refuses without DEMO_MODE=1, in a production environment, with the wrong name, and for a database that is not local", () => {
    expect(() => assertDemoTarget({ url: LOCAL, expectDb: "rv_demo", env: env({ DEMO_MODE: "" }) })).toThrow(/DEMO_MODE=1 is not set/);
    expect(() => assertDemoTarget({ url: LOCAL, expectDb: "rv_demo", env: env({ NODE_ENV: "production" }) })).toThrow(/production environment/);
    expect(() => assertDemoTarget({ url: LOCAL, expectDb: "rv_demo", env: env({ VERCEL_ENV: "production" }) })).toThrow(/production environment/);
    expect(() => assertDemoTarget({ url: LOCAL, expectDb: "another", env: env() })).toThrow(/you confirmed "another"/);
    expect(() => assertDemoTarget({ url: LOCAL, expectDb: "", env: env() })).toThrow(/--expect-db/);
    const remote = "postgresql://u:p@ep-example-123.region.aws.example.net/neondb";
    expect(() => assertDemoTarget({ url: remote, expectDb: "neondb", env: env() })).toThrow(/not on this computer/);
    expect(() => assertDemoTarget({ url: remote, expectDb: "neondb", previewHost: "ep-other.region.aws.example.net", env: env() })).toThrow(/not on this computer/);
    expect(assertDemoTarget({ url: remote, expectDb: "neondb", previewHost: "ep-example-123.region.aws.example.net", env: env() })).toBe("neondb"); // that exact preview host
    expect(assertDemoTarget({ url: LOCAL, expectDb: "rv_demo", env: env() })).toBe("rv_demo");
  });
  it("after connecting: refuses a database that is missing a migration, and one that holds many real accounts", async () => {
    const before = await migratedClone((id) => id <= "028");
    await expect(assertSafeDatabase(wrap(before.pg))).rejects.toThrow(/not applied yet: 029/);
    await before.pg.close();
    const { pg } = await migratedClone();
    await assertSafeDatabase(wrap(pg)); // an empty local database is fine
    for (let i = 0; i <= MAX_REAL_USERS; i++) await pg.query("insert into users (full_name, email, role, password_hash) values ($1, $2, 'ST', 'x')", [`Real ${i}`, `real${i}@example.com`]);
    await expect(assertSafeDatabase(wrap(pg))).rejects.toThrow(/looks like a live site/);
    await pg.close();
  });
  it("is never run automatically: no npm lifecycle script, build step or route calls it", async () => {
    const { readFileSync } = await import("node:fs");
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(Object.entries(pkg.scripts as Record<string, string>).filter(([, v]) => v.includes("seed-contribution-demo")).map(([k]) => k)).toEqual(["seed:contribution-demo"]);
    for (const k of ["build", "start", "postinstall", "prebuild", "predeploy", "dev"]) expect(String(pkg.scripts[k] ?? "")).not.toContain("seed");
  });
});

describe("the plan", () => {
  it("at least 4 sectors with 3-5 fields each, users for every role, at least 2 ideas in every status, feedback on the rejected ones", () => {
    const p = plan();
    expect(p.sectors.map((s: any) => s.name)).toEqual(expect.arrayContaining(["Agriculture & Dairy", "Manufacturing", "Healthcare", "Education"]));
    for (const s of p.sectors as any[]) expect(s.robots.length, s.slug).toBeGreaterThanOrEqual(3), expect(s.robots.length, s.slug).toBeLessThanOrEqual(5);
    expect(p.users.map((u: any) => u.key)).toEqual(["admin", "moderator", "student", "teacher", "parent", "contributor"]);
    const by: Record<string, number> = {};
    for (const i of p.ideas as any[]) by[i.status] = (by[i.status] ?? 0) + 1;
    for (const st of ["submitted", "under_review", "draft", "pending", "changes_requested", "resubmitted", "published", "failed", "rejected", "unpublished"]) expect(by[st], st).toBeGreaterThanOrEqual(2);
    for (const i of (p.ideas as any[]).filter((x) => x.status === "rejected")) expect(i.feedback).toBeTruthy();
    const fb: Record<string, number> = {};
    for (const f of p.formItems as any[]) fb[f.status] = (fb[f.status] ?? 0) + 1;
    for (const st of ["draft", "pending_review", "changes_requested", "published", "rejected", "unpublished"]) expect(fb[st], st).toBeGreaterThanOrEqual(2);
    for (const f of (p.formItems as any[]).filter((x) => x.status === "rejected")) expect(f.reply).toBeTruthy();
  });
});

describe("apply and reset on a local database", () => {
  it("adds flagged, VISIBLE demo records; a second run adds nothing; --reset removes only them", async () => {
    const { pg } = await migratedClone();
    const db = wrap(pg);
    // real data that must survive
    await pg.query("insert into users (full_name, email, role, password_hash) values ('Real Person', 'real@example.com', 'PA', 'x')");
    const real = Number(((await pg.query("select id from users where email = 'real@example.com'")).rows[0] as any).id);
    await pg.query(`insert into cw_contributions (user_id, contributor_name, contributor_type, kind, original, proposed) values ($1, 'Real Person', 'PA', 'New idea', '{"title":"Real idea"}', '{"title":"Real idea"}')`, [real]);
    await pg.query("insert into contributions (user_id, type, type_chosen, title, body) values ($1, 'problem', true, 'A real contribution', 'Real text of a real contribution.')", [real]);

    const r = await seedDemo(db);
    expect(Object.keys(r.passwords)).toEqual(["admin", "moderator", "student", "teacher", "parent", "contributor"]);
    expect(await count(pg, "select count(*)::int n from cw_contributions where is_demo")).toBe(20);
    const statuses = ((await pg.query("select status, count(*)::int n from cw_contributions where is_demo group by status order by status")).rows as any[]).map((x) => [x.status, x.n]);
    expect(statuses.every(([, n]) => n >= 2)).toBe(true);
    expect(statuses).toHaveLength(10);
    expect(await count(pg, "select count(*)::int n from cw_public_contributions p join cw_contributions c on c.id = p.contribution_id where c.is_demo")).toBe(2); // the two Published ones
    expect(await count(pg, `select count(*)::int n from contributions where id >= ${OLD_ID_BASE}`)).toBe(12);
    expect(await count(pg, "select count(*)::int n from contributions where id >= 8000000000000 and is_demo")).toBe(0); // visible in the moderation queue
    expect(await count(pg, "select count(*)::int n from cw_contribution_feedback f join cw_contributions c on c.id = f.contribution_id where c.is_demo and f.type in ('decline','reject')")).toBe(2);
    expect(await count(pg, "select count(*)::int n from users where email like '%@demo.robovalley.test' and is_moderator")).toBe(1);

    expect((await seedDemo(db)).added).toBe(0); // safe to repeat
    expect(await count(pg, "select count(*)::int n from cw_contributions where is_demo")).toBe(20);

    const gone = await resetDemo(db);
    expect(gone).toEqual({ ideas: 20, form: 12, users: 6 });
    expect(await count(pg, "select count(*)::int n from cw_contributions")).toBe(1); // the real idea
    expect(await count(pg, "select count(*)::int n from contributions")).toBe(1);
    expect(await count(pg, "select count(*)::int n from users where email = 'real@example.com'")).toBe(1);
    // the append-only rules are on again
    await expect(pg.query("delete from cw_contribution_history")).resolves.toBeTruthy(); // nothing left to delete (no rows)
    await pg.query("insert into cw_contribution_history (contribution_id, actor, text) select id, 'A', 'x' from cw_contributions limit 1");
    await expect(pg.query("delete from cw_contribution_history")).rejects.toThrow(/append_only|never changed/);
    await pg.close();
  });
});
