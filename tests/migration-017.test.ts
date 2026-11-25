// Migration 017 (rejected and unpublished statuses, the append-only review trail) and its rollback, on in-process PostgreSQL (PGlite).
// Throwaway in-memory databases only; no real or shared database is involved.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyFile, pickFiles } from "../scripts/migrate.mjs";
import { migrationStatus, statusOf } from "../scripts/migration-status.mjs";
import { CONTRIBUTION_STATUSES } from "../src/lib/contributions";
import { migratedClone } from "./helpers/migratedClone";

const read = (p: string) => readFileSync(resolve(p), "utf8");
const runner = (pg: PGlite) => ({
  setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]),
  exec: (sql: string) => pg.exec(sql),
});
const UP = "db/migrations/017_review_statuses.sql";
const DOWN = "db/rollback/017_down.sql";
const n = async (pg: PGlite, sql: string) => Number(((await pg.query(sql)).rows[0] as any).n);

async function build(upTo017 = true) {
  // up to 018 only: 019's work-log view reads contribution_reviews, so 019 needs 017 and is undone first (see tests/migration-019.test.ts)
  const { pg, name } = await migratedClone((id) => id !== "019" && (upTo017 || (id !== "017" && id !== "018"))); // built once per file, a fresh copy per test (tests/helpers/migratedClone.ts)
  await pg.exec("insert into users (full_name,email,role,password_hash) values ('A','a@example.com','TC','x'),('B','b@example.com','TC','x')");
  await pg.exec("insert into sectors (slug,name) values ('education','Education') on conflict do nothing");
  return { pg, name };
}
const item = async (pg: PGlite, status: string) => {
  const id = Number(((await pg.query("insert into contributions (user_id,type,title,body) values (1,'problem','A fine title','A body that is long enough.') returning id")).rows[0] as any).id);
  await pg.exec(`insert into contribution_scopes (contribution_id, sector_id) select ${id}, id from sectors limit 1`);
  if (status !== "draft") await pg.exec(`update contributions set status='${status}', submitted_at=now(), published_at=${status === "published" ? "now()" : "null"} where id=${id}`);
  return id;
};

describe("migration 017: statuses", () => {
  it("before 017 only four statuses are allowed; after it all six, and the TypeScript list agrees", async () => {
    const { pg, name } = await build(false);
    const id = await item(pg, "draft");
    await expect(pg.exec(`update contributions set status='rejected', submitted_at=now() where id=${id}`)).rejects.toThrow(/contributions_status_ck/);
    await applyFile(runner(pg), name, read(UP));
    for (const s of CONTRIBUTION_STATUSES.filter((x) => x !== "removed")) { // 'removed' arrives with migration 018
      const i = await item(pg, s);
      expect(await n(pg, `select count(*) n from contributions where id=${i} and status='${s}'`)).toBe(1);
    }
    await expect(pg.exec(`update contributions set status='withdrawn' where id=${id}`)).rejects.toThrow(/contributions_status_ck/);
    await pg.close();
  });
  it("the older rules still hold: draft only without a submit time, published only with a publish time, a non-draft keeps a sector", async () => {
    const { pg } = await build();
    const d = await item(pg, "draft");
    await expect(pg.exec(`update contributions set status='rejected' where id=${d}`)).rejects.toThrow(/contributions_submitted_ck/);
    const p = await item(pg, "pending_review");
    await expect(pg.exec(`update contributions set status='published' where id=${p}`)).rejects.toThrow(/contributions_published_ck/);
    await expect(pg.exec(`update contributions set status='unpublished', published_at=now() where id=${p}`)).rejects.toThrow(/contributions_published_ck/);
    await expect(pg.exec(`delete from contribution_scopes where contribution_id=${p}`)).rejects.toThrow();
    await pg.close();
  });
  it("adds nothing but one table, one function and one trigger, and changes no row", async () => {
    const { pg, name } = await build(false);
    await item(pg, "published"); await item(pg, "draft");
    const rows = (await pg.query("select * from contributions order by id")).rows;
    const tables = (await pg.query("select table_name t from information_schema.tables where table_schema='public' order by 1")).rows.map((r: any) => r.t);
    await applyFile(runner(pg), name, read(UP));
    expect((await pg.query("select * from contributions order by id")).rows).toEqual(rows);
    const after = (await pg.query("select table_name t from information_schema.tables where table_schema='public' order by 1")).rows.map((r: any) => r.t);
    expect(after.filter((t: string) => !tables.includes(t))).toEqual(["contribution_reviews"]);
    await pg.close();
  });
  it("is safe to run twice", async () => {
    const { pg, name } = await build();
    await applyFile(runner(pg), name, read(UP));
    expect(await n(pg, "select count(*) n from pg_trigger where tgname='contribution_reviews_append_only'")).toBe(1);
    expect(await n(pg, "select count(*) n from pg_constraint where conname='contributions_status_ck'")).toBe(1);
    await pg.close();
  });
  it("refuses without a confirmed database name or on the wrong one", async () => {
    const { pg } = await build(false);
    await pg.query("select set_config('rv.expected_db', '', false)");
    await expect(pg.exec(read(UP))).rejects.toThrow(/not set/);
    await pg.exec("ROLLBACK");
    await pg.query("select set_config('rv.expected_db', 'some_other_db', false)");
    await expect(pg.exec(read(UP))).rejects.toThrow(/Wrong database/);
    await pg.exec("ROLLBACK");
    await pg.close();
  });
});

describe("migration 017: the review trail is append only", () => {
  const add = (pg: PGlite, id: number, action = "approve", note: string | null = null) =>
    pg.query("insert into contribution_reviews (contribution_id, reviewer_id, action, note) values ($1, 2, $2, $3)", [id, action, note]);
  it("a decision can be added, never changed or deleted", async () => {
    const { pg } = await build();
    const id = await item(pg, "pending_review");
    await add(pg, id, "approve");
    await expect(pg.exec("update contribution_reviews set note='changed'")).rejects.toThrow(/never changed or deleted/);
    await expect(pg.exec("delete from contribution_reviews")).rejects.toThrow(/never changed or deleted/);
    expect(await n(pg, "select count(*) n from contribution_reviews")).toBe(1);
    await pg.close();
  });
  it("a note is required to request changes, reject or unpublish, and is optional for approve", async () => {
    const { pg } = await build();
    const id = await item(pg, "pending_review");
    for (const a of ["request_changes", "reject", "unpublish"]) {
      await expect(add(pg, id, a, null)).rejects.toThrow(/contribution_reviews_note_ck/);
      await expect(add(pg, id, a, "  ")).rejects.toThrow(/contribution_reviews_note_ck/);
      await add(pg, id, a, "Please add the district.");
    }
    await add(pg, id, "approve", null); await add(pg, id, "republish", "Back on.");
    await expect(add(pg, id, "delete_everything", "x")).rejects.toThrow(/contribution_reviews_action_ck/);
    await pg.close();
  });
  it("deleting a draft's owner account keeps working: the database's own cleanup is allowed, the reviewer is only blanked", async () => {
    const { pg } = await build();
    const id = await item(pg, "pending_review");
    await add(pg, id, "request_changes", "Add details please.");
    await pg.exec("delete from users where id = 2");
    expect((await pg.query("select reviewer_id from contribution_reviews")).rows).toEqual([{ reviewer_id: null }]);
    await pg.exec("delete from users where id = 1");
    expect(await n(pg, "select count(*) n from contribution_reviews")).toBe(0);
    await pg.close();
  });
});

describe("migration 017 run again", () => {
  const rule = async (pg: PGlite) => String(((await pg.query("select pg_get_constraintdef(oid) d from pg_constraint where conname = 'contributions_status_ck'")).rows[0] as any).d);
  it("017 -> 018 -> 017 again: the 'removed' status survives (017 only ever widens the rule), and a removed item stays valid", async () => {
    const { pg, name } = await build(); // 001-018: 018's seven-status rule is in place
    expect(await rule(pg)).toContain("'removed'");
    const id = await item(pg, "pending_review");
    await pg.exec(`update contributions set status = 'removed' where id = ${id}`);
    await applyFile(runner(pg), name, read(UP)); // e.g. --only 017 --force, or --file db/migrations/017_...
    expect(await rule(pg)).toContain("'removed'");
    expect(await n(pg, `select count(*) n from contributions where id = ${id} and status = 'removed'`)).toBe(1);
    const other = await item(pg, "pending_review");
    await pg.exec(`update contributions set status = 'removed' where id = ${other}`); // still allowed after the re-run
    expect(statusOf(await migrationStatus(async (sql: string) => ({ rows: (await pg.query(sql)).rows as any[] })), "018")?.status).toBe("applied");
    await pg.close();
  });
  it("on a database with only 012's four statuses it widens the rule exactly as before; run twice it changes nothing", async () => {
    const { pg, name } = await build(false);
    expect(await rule(pg)).not.toContain("'rejected'");
    await applyFile(runner(pg), name, read(UP));
    const once = await rule(pg);
    for (const s of ["draft", "pending_review", "changes_requested", "published", "rejected", "unpublished"]) expect(once).toContain(`'${s}'`);
    expect(once).not.toContain("'removed'");
    await applyFile(runner(pg), name, read(UP));
    expect(await rule(pg)).toBe(once);
    await pg.close();
  });
  it("a same-named rule that names all six statuses but forbids 'rejected' is a mismatch: 017 stops, the rule stays, 017 is not applied (review probe P4)", async () => {
    const { pg, name } = await build(false);
    await pg.exec("alter table contributions drop constraint contributions_status_ck");
    await pg.exec("alter table contributions add constraint contributions_status_ck check (status in ('draft','pending_review','changes_requested','published','unpublished') or (status = 'rejected' and false))");
    const odd = await rule(pg);
    await expect(applyFile(runner(pg), name, read(UP))).rejects.toThrow(/none of the rules these migrations make \(012's four statuses, 017's six, 018's seven\)/);
    await pg.exec("ROLLBACK").catch(() => undefined);
    await expect(applyFile(runner(pg), name, read(UP))).rejects.toThrow(odd); // the message shows the rule it found
    await pg.exec("ROLLBACK").catch(() => undefined);
    expect(await rule(pg)).toBe(odd); // left exactly as it was
    expect(await n(pg, "select count(*) n from information_schema.tables where table_name = 'contribution_reviews'")).toBe(0); // nothing of 017 was applied
    expect(statusOf(await migrationStatus(async (sql: string) => ({ rows: (await pg.query(sql)).rows as any[] })), "017")?.status).toBe("missing");
    expect(((await pg.query("select count(*)::int n from pg_class where relpersistence = 't'")).rows[0] as any).n).toBe(0); // no temporary table left
    await pg.close();
  });
  it("the three known rules (012's four, its own six as 018_down restores it, 018's seven) are the only ones it accepts; a wider unknown rule stops it", async () => {
    const { pg, name } = await build(); // 001-018
    await applyFile(runner(pg), name, read("db/rollback/018_down.sql")); // back to the six, written by 018_down
    const six = await rule(pg);
    await applyFile(runner(pg), name, read(UP)); // its own six: left alone
    expect(await rule(pg)).toBe(six);
    await pg.exec("alter table contributions drop constraint contributions_status_ck");
    await pg.exec("alter table contributions add constraint contributions_status_ck check (status in ('draft','pending_review','changes_requested','published','rejected','unpublished','removed','archived'))");
    const wider = await rule(pg);
    await expect(applyFile(runner(pg), name, read(UP))).rejects.toThrow(/none of the rules these migrations make/); // not made by these files: a person looks at it
    await pg.exec("ROLLBACK").catch(() => undefined);
    expect(await rule(pg)).toBe(wider);
    await pg.close();
  });
});

describe("rollback 017", () => {
  it("restores the four-status rule and removes the table and function; up, down, up", async () => {
    const { pg, name } = await build();
    await item(pg, "published");
    await applyFile(runner(pg), name, read(DOWN));
    expect(await n(pg, "select count(*) n from information_schema.tables where table_name='contribution_reviews'")).toBe(0);
    expect(await n(pg, "select count(*) n from pg_proc where proname='rv_review_append_only'")).toBe(0);
    const id = await item(pg, "draft");
    await expect(pg.exec(`update contributions set status='rejected', submitted_at=now() where id=${id}`)).rejects.toThrow(/contributions_status_ck/);
    expect(await n(pg, "select count(*) n from contributions")).toBe(2);
    await applyFile(runner(pg), name, read(UP));
    await pg.exec(`update contributions set status='rejected', submitted_at=now() where id=${id}`);
    await pg.close();
  });
  it("refuses while a contribution is rejected or unpublished, and while a decision exists, and changes nothing", async () => {
    const { pg, name } = await build();
    const id = await item(pg, "rejected");
    await expect(applyFile(runner(pg), name, read(DOWN))).rejects.toThrow(/rejected or unpublished/);
    await pg.exec("ROLLBACK");
    await pg.exec(`update contributions set status='pending_review' where id=${id}`);
    await pg.query("insert into contribution_reviews (contribution_id, reviewer_id, action, note) values ($1, 2, 'approve', null)", [id]);
    await expect(applyFile(runner(pg), name, read(DOWN))).rejects.toThrow(/audit trail is never deleted/);
    await pg.exec("ROLLBACK");
    expect(await n(pg, "select count(*) n from contribution_reviews")).toBe(1);
    await pg.close();
  });
  it("refuses without a confirmed database name", async () => {
    const { pg } = await build();
    await pg.query("select set_config('rv.expected_db', '', false)");
    await expect(pg.exec(read(DOWN))).rejects.toThrow(/not set/);
    await pg.exec("ROLLBACK");
    await pg.close();
  });
});

describe("the status report knows 017", () => {
  it("reports 017 missing before and applied after", async () => {
    const { pg, name } = await build(false);
    const query = async (sql: string) => ({ rows: (await pg.query(sql)).rows as any[] });
    expect(statusOf(await migrationStatus(query), "017")?.status).toBe("missing");
    await applyFile(runner(pg), name, read(UP));
    expect(statusOf(await migrationStatus(query), "017")?.status).toBe("applied");
    await pg.close();
  });
});
