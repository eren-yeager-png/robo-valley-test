// Migration 018 (duplicate safeguard, 'removed' status, 'verify' and 'remove' review actions) and its rollback, on in-process
// PostgreSQL (PGlite). Throwaway in-memory databases only; no real or shared database is involved.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyFile, pickFiles } from "../scripts/migrate.mjs";

const read = (p: string) => readFileSync(resolve(p), "utf8");
const runner = (pg: PGlite) => ({ setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]), exec: (sql: string) => pg.exec(sql) });
const n = async (pg: PGlite, sql: string, p: unknown[] = []) => Number(((await pg.query(sql, p as any[])).rows[0] as any).n);
const UP = "db/migrations/018_contribution_dedupe.sql";
const DOWN = "db/rollback/018_down.sql";

async function build(upTo = "018") {
  const pg = new PGlite();
  await pg.exec(read("tests/helpers/baseSchema.sql"));
  const name = String(((await pg.query("select current_database() d")).rows[0] as any).d);
  for (const f of pickFiles().filter((f) => f.split(/[\\/]/).pop()!.slice(0, 3) <= upTo)) await applyFile(runner(pg), name, read(f));
  await pg.exec("insert into users (full_name,email,role,password_hash) values ('Asha','a@example.com','TC','x'),('Ravi','r@example.com','TC','x'),('Ola','o@example.com','admin','x')");
  await pg.exec("insert into sectors (slug,name) values ('test-alpha','Test Alpha'),('test-beta','Test Beta') on conflict do nothing");
  const ids = (await pg.query("select id from sectors where slug in ('test-alpha','test-beta') order by slug")).rows.map((r: any) => Number(r.id));
  return { pg, name, A: ids[0]!, B: ids[1]! };
}
/** a contribution in the given sectors; status 'pending_review' submits it (the 012 guard needs a sector first) */
async function make(pg: PGlite, title: string, sectors: number[], status = "pending_review", user = 1, demo = false) {
  const id = Number(((await pg.query("insert into contributions (user_id,type,title,body,is_demo) values ($1,'problem',$2,'A body that is long enough.',$3) returning id", [user, title, demo])).rows[0] as any).id);
  for (const s of sectors) await pg.query("insert into contribution_scopes (contribution_id, sector_id) values ($1,$2)", [id, s]);
  if (status !== "draft") await pg.query("update contributions set status=$2::varchar, submitted_at=now(), published_at = case when $2::varchar='published' then now() end where id=$1", [id, status]);
  return id;
}

describe("migration 018: schema", () => {
  it("adds the key table, functions and triggers, and is safe to run twice", async () => {
    const { pg, name } = await build();
    expect(await n(pg, "select count(*) n from information_schema.tables where table_name='contribution_title_keys'")).toBe(1);
    await applyFile(runner(pg), name, read(UP));
    expect(await n(pg, "select count(*) n from pg_trigger where tgname in ('contributions_title_keys','contribution_scopes_title_keys')")).toBe(2);
    expect(await n(pg, "select count(*) n from pg_proc where proname in ('rv_title_key','rv_sync_title_keys','rv_title_keys_from_contribution','rv_title_keys_from_scope')")).toBe(4);
    await pg.close();
  });
  it("refuses to run without a confirmed database name, or with the wrong one", async () => {
    const other = new PGlite();
    await other.exec(read("tests/helpers/baseSchema.sql"));
    await expect(other.exec(read(UP))).rejects.toThrow(/not set/); await other.exec("ROLLBACK");
    await other.query("select set_config('rv.expected_db', 'some_other_db', false)");
    await expect(other.exec(read(UP))).rejects.toThrow(/Wrong database/); await other.exec("ROLLBACK");
    await other.close();
  });
  it("normalises titles: lower case, punctuation removed, spaces collapsed", async () => {
    const { pg } = await build();
    const k = async (t: string) => String(((await pg.query("select rv_title_key($1) k", [t])).rows[0] as any).k);
    expect(await k("  Shed   Cleaning,  takes TIME!! ")).toBe("shed cleaning takes time");
    expect(await k("Shed-cleaning: takes time.")).toBe("shed cleaning takes time");
    expect(await k("!!!")).toBe("");
    await pg.close();
  });
  it("allows the 'removed' status and the 'verify' and 'remove' actions; 'remove' needs a reason", async () => {
    const { pg, A } = await build();
    const id = await make(pg, "A title here", [A]);
    await pg.query("insert into contribution_reviews (contribution_id, reviewer_id, action) values ($1,3,'verify')", [id]);
    await expect(pg.query("insert into contribution_reviews (contribution_id, reviewer_id, action) values ($1,3,'remove')", [id])).rejects.toThrow(/contribution_reviews_note_ck/);
    await pg.query("insert into contribution_reviews (contribution_id, reviewer_id, action, note) values ($1,3,'remove','Duplicate of an earlier entry')", [id]);
    await pg.query("update contributions set status='removed' where id=$1", [id]);
    await expect(pg.exec(`update contributions set status='withdrawn' where id=${id}`)).rejects.toThrow(/contributions_status_ck/);
    await expect(pg.query("insert into contribution_reviews (contribution_id, reviewer_id, action) values ($1,3,'shred')", [id])).rejects.toThrow(/contribution_reviews_action_ck/);
    await pg.close();
  });
});

describe("migration 018: the duplicate safeguard", () => {
  it("two LIVE contributions cannot share a normalised title in the same sector (unique violation)", async () => {
    const { pg, A } = await build();
    await make(pg, "Shed cleaning takes time", [A]);
    await expect(make(pg, "shed-cleaning:   TAKES time!", [A], "pending_review", 2)).rejects.toThrow(/contribution_title_keys_pkey|duplicate key/);
    expect(await n(pg, "select count(*) n from contribution_title_keys")).toBe(1);
    await pg.close();
  });
  it("the same title is fine in another sector, as a draft, or as demo content", async () => {
    const { pg, A, B } = await build();
    await make(pg, "Shed cleaning takes time", [A]);
    await make(pg, "Shed cleaning takes time", [B], "pending_review", 2);
    await make(pg, "Shed cleaning takes time", [A], "draft", 2);
    await make(pg, "Shed cleaning takes time", [A], "published", 2, true);
    expect(await n(pg, "select count(*) n from contribution_title_keys")).toBe(2);
    await pg.close();
  });
  it("a draft that collides cannot be submitted, and adding a colliding sector to a live one fails", async () => {
    const { pg, A, B } = await build();
    await make(pg, "Weekend robotics club", [A]);
    const d = await make(pg, "Weekend Robotics Club!", [A], "draft", 2);
    await expect(pg.query("update contributions set status='pending_review', submitted_at=now() where id=$1", [d])).rejects.toThrow(/contribution_title_keys_pkey|duplicate key/);
    const live = await make(pg, "Weekend robotics club", [B], "pending_review", 2);
    await expect(pg.query("insert into contribution_scopes (contribution_id, sector_id) values ($1,$2)", [live, A])).rejects.toThrow(/contribution_title_keys_pkey|duplicate key/);
    await pg.close();
  });
  it("renaming a live contribution onto an existing title fails", async () => {
    const { pg, A } = await build();
    await make(pg, "First title", [A]);
    const b = await make(pg, "Second title", [A], "pending_review", 2);
    await expect(pg.query("update contributions set title='FIRST title.' where id=$1", [b])).rejects.toThrow(/contribution_title_keys_pkey|duplicate key/);
    await pg.query("update contributions set title='Second title, improved' where id=$1", [b]);
    expect(await n(pg, "select count(*) n from contribution_title_keys where contribution_id=$1", [b])).toBe(1);
    await pg.close();
  });
  it("rejected, removed and unpublished contributions free the title; changes requested and published keep it", async () => {
    const { pg, A } = await build();
    for (const [st, freed] of [["rejected", true], ["removed", true], ["unpublished", true], ["changes_requested", false], ["published", false]] as const) {
      const t = "Title for " + st;
      const id = await make(pg, t, [A]);
      await pg.query("update contributions set status=$2::varchar, published_at = case when $2::varchar='published' then now() end where id=$1", [id, st]);
      const again = make(pg, t, [A], "pending_review", 2);
      if (freed) await again; else await expect(again).rejects.toThrow(/contribution_title_keys_pkey|duplicate key/);
    }
    await pg.close();
  });
  it("deleting a contribution or one of its sectors removes its keys", async () => {
    const { pg, A, B } = await build();
    const id = await make(pg, "Two sector item", [A, B]);
    expect(await n(pg, "select count(*) n from contribution_title_keys where contribution_id=$1", [id])).toBe(2);
    await pg.query("delete from contribution_scopes where contribution_id=$1 and sector_id=$2", [id, B]);
    expect(await n(pg, "select count(*) n from contribution_title_keys where contribution_id=$1", [id])).toBe(1);
    await pg.query("update contributions set status='draft', submitted_at=null where id=$1", [id]).catch(() => undefined);
    await pg.query("delete from users where id=1");
    expect(await n(pg, "select count(*) n from contribution_title_keys")).toBe(0);
    await pg.close();
  });
  it("keys existing live contributions when it runs, and never fails on an existing collision", async () => {
    const { pg, name, A } = await build("017");
    await make(pg, "Same old title", [A]);
    await make(pg, "same old title!", [A], "published", 2); // possible before 018
    await make(pg, "A different one", [A], "pending_review", 2);
    await applyFile(runner(pg), name, read(UP));
    expect(await n(pg, "select count(*) n from contribution_title_keys")).toBe(2); // the later collision is left unkeyed
    await pg.close();
  });
});

describe("rollback 018", () => {
  it("drops the safeguard and narrows the rules when nothing depends on them; up, down, up", async () => {
    const { pg, name, A } = await build();
    await make(pg, "Kept through the undo", [A]);
    await applyFile(runner(pg), name, read(DOWN));
    expect(await n(pg, "select count(*) n from information_schema.tables where table_name='contribution_title_keys'")).toBe(0);
    expect(await n(pg, "select count(*) n from pg_proc where proname like 'rv_title_key%' or proname = 'rv_sync_title_keys'")).toBe(0);
    expect(await n(pg, "select count(*) n from contributions")).toBe(1);
    await expect(pg.exec("update contributions set status='removed' where id=1")).rejects.toThrow(/contributions_status_ck/);
    await applyFile(runner(pg), name, read(DOWN)); // twice is fine
    await applyFile(runner(pg), name, read(UP)); // up, down, up
    expect(await n(pg, "select count(*) n from contribution_title_keys")).toBe(1); // re-keyed from the live contribution
    await pg.close();
  });
  it("refuses when a contribution is removed or a verify/remove decision exists (the audit trail is never deleted)", async () => {
    const { pg, name, A } = await build();
    const id = await make(pg, "Will be verified", [A]);
    await pg.query("insert into contribution_reviews (contribution_id, reviewer_id, action) values ($1,3,'verify')", [id]);
    await expect(applyFile(runner(pg), name, read(DOWN))).rejects.toThrow(/Verify or remove decisions exist/);
    const pg2 = (await build()).pg;
    const id2 = await make(pg2, "Will be removed", [(await pg2.query("select id from sectors where slug='test-alpha'")).rows.map((r: any) => Number(r.id))[0]!]);
    await pg2.query("update contributions set status='removed' where id=$1", [id2]);
    await expect(applyFile(runner(pg2), name, read(DOWN))).rejects.toThrow(/removed/);
    await pg.close(); await pg2.close();
  });
});
