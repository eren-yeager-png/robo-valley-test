// Migration 015 (users.is_moderator + moderator_audit), its rollback, and the moderator rules, on in-process PostgreSQL (PGlite).
// Throwaway in-memory databases only; no real or shared database is involved.
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyFile, pickFiles } from "../scripts/migrate.mjs";
import { readContact, saveContact } from "../src/lib/contributionContacts";
import { parseUserId, setModerator } from "../src/lib/moderators";

const read = (p: string) => readFileSync(resolve(p), "utf8");
const runner = (pg: PGlite) => ({
  setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]),
  exec: (sql: string) => pg.exec(sql),
});
const tables = async (pg: PGlite) =>
  (await pg.query("select table_name t from information_schema.tables where table_schema='public' order by 1")).rows.map((r: any) => r.t);
const count = async (pg: PGlite, sql: string) => Number(((await pg.query(sql)).rows[0] as any).n);
const UP = "db/migrations/015_moderator_flag.sql";
const DOWN = "db/rollback/015_down.sql";
const db = (pg: PGlite) => ({ query: async (sql: string, p?: unknown[]) => ({ rows: (await pg.query(sql, p as any[])).rows as any[] }) });
const pool = (pg: PGlite) => ({ ...db(pg), connect: async () => ({ ...db(pg), release: () => undefined }) });
const bad = (pg: PGlite, sql: string, re?: RegExp) => expect(pg.exec(sql)).rejects.toThrow(re);

// users: 1 = Ola (admin), 2 = Asha (owner), 3 = Meera (moderator), 4 = Ravi (ordinary user), 5 = Dev (second admin)
async function build(upTo = "015") {
  const pg = new PGlite();
  await pg.exec(read("tests/helpers/baseSchema.sql"));
  const name = String(((await pg.query("select current_database() d")).rows[0] as any).d);
  for (const f of pickFiles().filter((f) => f.split(/[\\/]/).pop()!.slice(0, 3) <= upTo)) await applyFile(runner(pg), name, read(f));
  await pg.exec("insert into users (full_name,email,role,password_hash) values ('Ola','ola@example.com','admin','x'),('Asha','asha@example.com','TC','x'),('Meera','meera@example.com','TC','x'),('Ravi','ravi@example.com','TC','x'),('Dev','dev@example.com','admin','x')");
  return { pg, name };
}
const flag = async (pg: PGlite, id: number) => ((await pg.query("select is_moderator f from users where id=$1", [id])).rows[0] as any).f;
const audit = async (pg: PGlite) => (await pg.query("select admin_id, target_user_id, granted from moderator_audit order by id")).rows as any[];

describe("migration 015", () => {
  it("adds users.is_moderator (boolean, NOT NULL, default false) and moderator_audit, and is safe to run twice", async () => {
    const { pg, name } = await build();
    const col: any = (await pg.query("select data_type, is_nullable, column_default from information_schema.columns where table_name='users' and column_name='is_moderator'")).rows[0];
    expect(col).toMatchObject({ data_type: "boolean", is_nullable: "NO", column_default: "false" });
    expect(await tables(pg)).toContain("moderator_audit");
    await applyFile(runner(pg), name, read(UP));
    expect(await count(pg, "select count(*) n from information_schema.columns where table_name='users' and column_name='is_moderator'")).toBe(1);
    expect(await count(pg, "select count(*) n from pg_trigger where tgname in ('users_moderator_audit_upd','users_moderator_audit_ins')")).toBe(2);
    await pg.close();
  });

  it("existing users become 'not a moderator' and keep their roles; nothing else about them changes", async () => {
    const { pg, name } = await build("014");
    await pg.exec("insert into users (full_name,email,role,password_hash) values ('Old','old@example.com','TC','hash1'),('Boss','boss@example.com','admin','hash2')");
    const before = (await pg.query("select id, full_name, email, role, password_hash from users order by id")).rows;
    await applyFile(runner(pg), name, read(UP));
    expect((await pg.query("select id, full_name, email, role, password_hash from users order by id")).rows).toEqual(before);
    expect(await count(pg, "select count(*) n from users where is_moderator")).toBe(0);
    expect(await count(pg, "select count(*) n from moderator_audit")).toBe(0); // adding the column is not a "grant"
    await pg.close();
  });

  it("refuses to run without a confirmed database name, or with the wrong one", async () => {
    const other = new PGlite();
    await other.exec(read("tests/helpers/baseSchema.sql"));
    await expect(other.exec(read(UP))).rejects.toThrow(/not set/);
    await other.exec("ROLLBACK");
    await other.query("select set_config('rv.expected_db', 'some_other_db', false)");
    await expect(other.exec(read(UP))).rejects.toThrow(/Wrong database/);
    await other.exec("ROLLBACK");
    expect(await tables(other)).not.toContain("moderator_audit");
    await other.close();
  });

  it("a new user is not a moderator", async () => {
    const { pg } = await build();
    expect(await count(pg, "select count(*) n from users where is_moderator")).toBe(0);
    expect(await audit(pg)).toEqual([]);
    await pg.close();
  });
});

describe("the audit trail (database trigger)", () => {
  it("every change writes one row, a manual step has no admin id, and no change writes nothing", async () => {
    const { pg } = await build();
    await pg.exec("update users set is_moderator = true where id = 3"); // a manual database step
    expect(await audit(pg)).toEqual([{ admin_id: null, target_user_id: 3, granted: true }]);
    await pg.exec("update users set is_moderator = true where id = 3"); // already true: not a change
    await pg.exec("update users set full_name = 'Meera R' where id = 3"); // another column: not a change
    expect(await audit(pg)).toHaveLength(1);
    await pg.exec("update users set is_moderator = false where id = 3");
    expect((await audit(pg)).map((r) => r.granted)).toEqual([true, false]);
    await pg.close();
  });

  it("a user created as a moderator is audited too; a normal insert is not", async () => {
    const { pg } = await build();
    await pg.exec("insert into users (full_name,email,role,password_hash,is_moderator) values ('Mod','mod@example.com','TC','x',true),('Plain','plain@example.com','TC','x',false)");
    const rows = await audit(pg);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ admin_id: null, granted: true });
    await pg.close();
  });

  it("the database refuses a change made on behalf of the same user, and records nothing", async () => {
    const { pg } = await build();
    await pg.exec("begin; select set_config('rv.admin_id', '1', true)");
    await expect(pg.exec("update users set is_moderator = true where id = 1")).rejects.toThrow(/own moderator flag/);
    await pg.exec("rollback");
    expect(await flag(pg, 1)).toBe(false);
    expect(await audit(pg)).toEqual([]);
    await bad(pg, "insert into moderator_audit (admin_id, target_user_id, granted) values (1, 1, true)", /not_self_ck/);
    await pg.close();
  });

  it("the admin id is remembered for that transaction only, and is recorded when it is someone else", async () => {
    const { pg } = await build();
    await pg.exec("begin; select set_config('rv.admin_id', '1', true); update users set is_moderator = true where id = 3; commit");
    await pg.exec("update users set is_moderator = false where id = 3"); // later manual step: no admin id carried over
    expect(await audit(pg)).toEqual([{ admin_id: 1, target_user_id: 3, granted: true }, { admin_id: null, target_user_id: 3, granted: false }]);
    await pg.close();
  });

  it("deleting users keeps the audit rows but forgets the ids (set null), never failing", async () => {
    const { pg } = await build();
    await pg.exec("begin; select set_config('rv.admin_id', '1', true); update users set is_moderator = true where id = 3; commit");
    await pg.exec("delete from users where id = 3");
    expect(await audit(pg)).toEqual([{ admin_id: 1, target_user_id: null, granted: true }]);
    await pg.exec("delete from users where id = 1");
    expect(await audit(pg)).toEqual([{ admin_id: null, target_user_id: null, granted: true }]);
    await pg.close();
  });

  it("stores ids and a flag only, no personal data", async () => {
    const { pg } = await build();
    const cols = (await pg.query("select column_name c from information_schema.columns where table_name='moderator_audit' order by 1")).rows.map((r: any) => r.c);
    expect(cols).toEqual(["admin_id", "created_at", "granted", "id", "target_user_id"]);
    await pg.close();
  });
});

describe("setModerator (the only code that sets the flag)", () => {
  it("an admin can grant and remove, each change is audited with the admin's id, and a repeat changes nothing", async () => {
    const { pg } = await build();
    expect(await setModerator(pool(pg), 1, 3, true)).toEqual({ ok: true, userId: 3, moderator: true, changed: true });
    expect(await flag(pg, 3)).toBe(true);
    expect(await setModerator(pool(pg), 1, 3, true)).toMatchObject({ ok: true, changed: false });
    expect(await setModerator(pool(pg), 5, 3, false)).toMatchObject({ ok: true, changed: true }); // a different admin
    expect(await flag(pg, 3)).toBe(false);
    expect(await audit(pg)).toEqual([{ admin_id: 1, target_user_id: 3, granted: true }, { admin_id: 5, target_user_id: 3, granted: false }]);
    await pg.close();
  });

  it("a normal user, a moderator and an unknown user cannot change anything", async () => {
    const { pg } = await build();
    await pg.exec("update users set is_moderator = true where id = 3");
    for (const who of [4, 3, 999]) expect(await setModerator(pool(pg), who, 2, true)).toEqual({ ok: false, error: "NOT_ADMIN" });
    expect(await flag(pg, 2)).toBe(false);
    expect(await audit(pg)).toHaveLength(1); // only the manual step above
    await pg.close();
  });

  it("nobody can change their own flag, not even an admin", async () => {
    const { pg } = await build();
    expect(await setModerator(pool(pg), 1, 1, true)).toEqual({ ok: false, error: "SELF" });
    expect(await setModerator(pool(pg), 3, 3, true)).toEqual({ ok: false, error: "SELF" });
    expect(await flag(pg, 1)).toBe(false);
    expect(await audit(pg)).toEqual([]);
    await pg.close();
  });

  it("an unknown target is NOT_FOUND, bad input is refused, and the role never changes", async () => {
    const { pg } = await build();
    expect(await setModerator(pool(pg), 1, 999, true)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await setModerator(pool(pg), 1, 3, "yes" as unknown as boolean)).toEqual({ ok: false, error: "BAD_REQUEST" });
    expect(await setModerator(pool(pg), 1, NaN, true)).toEqual({ ok: false, error: "BAD_REQUEST" });
    await setModerator(pool(pg), 1, 3, true);
    expect(((await pg.query("select role from users where id=3")).rows[0] as any).role).toBe("TC"); // a flag, not a role
    await pg.close();
  });

  it("parseUserId accepts positive whole numbers only", () => {
    expect(parseUserId(7)).toBe(7);
    expect(parseUserId("12")).toBe(12);
    for (const v of [0, -1, 1.5, "1.5", "abc", "", null, undefined, {}, [], "1e3", "9".repeat(20)]) expect(parseUserId(v)).toBeNull();
  });
});

describe("contact details and moderators (the 014 read rule, now reading the flag from the database)", () => {
  async function scene(share: boolean) {
    const { pg } = await build();
    const c = Number(((await pg.query("insert into contributions (user_id,type,title,body) values (2,'problem','Shed cleaning by hand','Two workers clean the shed.') returning id")).rows[0] as any).id);
    await saveContact(db(pg), c, 2, { name: "Asha Rao", email: "asha@example.com", phone: "9876543210", shareWithModerators: share });
    await setModerator(pool(pg), 1, 3, true); // Meera is a moderator
    return { pg, c };
  }
  it("owner: always", async () => {
    for (const share of [false, true]) { const { pg, c } = await scene(share); expect(await readContact(db(pg), c, 2)).toMatchObject({ email: "asha@example.com" }); await pg.close(); }
  });
  it("moderator WITHOUT the share tick: nothing", async () => {
    const { pg, c } = await scene(false);
    expect(await readContact(db(pg), c, 3)).toBeNull();
    await pg.close();
  });
  it("moderator WITH the share tick: the contact", async () => {
    const { pg, c } = await scene(true);
    expect(await readContact(db(pg), c, 3)).toMatchObject({ name: "Asha Rao", phone: "9876543210" });
    await pg.close();
  });
  it("non-moderator (ordinary user): nothing, shared or not; an admin who is not a moderator: nothing", async () => {
    for (const share of [false, true]) {
      const { pg, c } = await scene(share);
      expect(await readContact(db(pg), c, 4)).toBeNull();
      expect(await readContact(db(pg), c, 1)).toBeNull(); // being an admin is not being a moderator
      await pg.close();
    }
  });
  it("removing the flag removes the access at once", async () => {
    const { pg, c } = await scene(true);
    await setModerator(pool(pg), 1, 3, false);
    expect(await readContact(db(pg), c, 3)).toBeNull();
    await pg.close();
  });
});

describe("the flag is set nowhere else in the code", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const src = walk("src").filter((f) => /\.(ts|tsx|mjs|js)$/.test(f)).map((f) => f.replace(/\\/g, "/"));
  it("only the contact read query and moderators.ts mention is_moderator; only moderators.ts writes it", () => {
    expect(src.filter((f) => read(f).includes("is_moderator")).sort()).toEqual(["src/lib/contributionContacts.ts", "src/lib/moderators.ts"]);
    expect(src.filter((f) => /SET[^;]*is_moderator|INSERT INTO users[^;]*is_moderator/i.test(read(f)))).toEqual(["src/lib/moderators.ts"]);
  });
  it("the profile route and every self-service route never mention it", () => {
    for (const f of src.filter((f) => f.startsWith("src/app/api/") && !f.startsWith("src/app/api/admin/"))) expect(read(f), f).not.toMatch(/is_moderator|isModerator|moderator/i);
    expect(read("src/app/api/account/profile/route.ts")).toContain('new Set(["fullName", "district", "language", "profile"])');
  });
  it("the only route that sets it is under /api/admin and starts with requireAdmin", () => {
    const routes = src.filter((f) => f.startsWith("src/app/api/") && /setModerator/.test(read(f)));
    expect(routes).toEqual(["src/app/api/admin/moderators/route.ts"]);
    const body = read(routes[0]!);
    expect(body.indexOf("requireAdmin(req)")).toBeGreaterThan(-1);
    expect(body.indexOf("requireAdmin(req)")).toBeLessThan(body.indexOf("setModerator(pool"));
  });
  it("nothing logs an id or a person", () => {
    const logs = [...read("src/app/api/admin/moderators/route.ts").matchAll(/console\.\w+\(([^)]*)\)/g)].map((m) => m[1]);
    expect(logs).toEqual(['"moderator change failed"']);
    expect(read("src/lib/moderators.ts")).not.toMatch(/console\./);
  });
});

describe("rollback 015", () => {
  it("removes the column, table, function and triggers; keeps users and everything else; up, down, up", async () => {
    const { pg, name } = await build();
    await setModerator(pool(pg), 1, 3, true);
    const users = (await pg.query("select id, full_name, email, role, password_hash from users order by id")).rows;
    const before = (await tables(pg)).filter((t) => t !== "moderator_audit");
    await applyFile(runner(pg), name, read(DOWN));
    expect(await tables(pg)).toEqual(before);
    expect(await count(pg, "select count(*) n from information_schema.columns where table_name='users' and column_name='is_moderator'")).toBe(0);
    expect(await count(pg, "select count(*) n from pg_proc where proname='rv_moderator_audit'")).toBe(0);
    expect(await count(pg, "select count(*) n from pg_trigger where tgname like 'users_moderator_audit%'")).toBe(0);
    expect((await pg.query("select id, full_name, email, role, password_hash from users order by id")).rows).toEqual(users); // no role or user touched
    await applyFile(runner(pg), name, read(DOWN)); // twice is fine
    await applyFile(runner(pg), name, read(UP)); // up, down, up
    expect(await count(pg, "select count(*) n from users where is_moderator")).toBe(0); // the flags did not come back
    expect(await tables(pg)).toContain("moderator_audit");
    await pg.close();
  });
  it("says plainly that it removes all moderator flags and affects no existing role", () => {
    expect(read(DOWN)).toMatch(/REMOVES ALL MODERATOR FLAGS/);
    expect(read(DOWN)).toMatch(/affects no existing role/);
    expect(read(UP)).toMatch(/removes ALL moderator flags/);
  });
  it("refuses without a confirmed database name", async () => {
    const { pg } = await build();
    await pg.query("select set_config('rv.expected_db', '', false)");
    await expect(pg.exec(read(DOWN))).rejects.toThrow(/not set/);
    await pg.exec("ROLLBACK");
    expect(await tables(pg)).toContain("moderator_audit");
    await pg.close();
  });
});
