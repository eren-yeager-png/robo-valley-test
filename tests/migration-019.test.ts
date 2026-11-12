// Migration 019 (the moderation portal's records: replies, internal notes, views, structured categories, review_round_at, the work-log
// view) and its rollback, on in-process PostgreSQL (PGlite). Throwaway in-memory databases only; no real or shared database is involved.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyFile, pickFiles } from "../scripts/migrate.mjs";
import { migrationStatus, statusOf } from "../scripts/migration-status.mjs";

const read = (p: string) => readFileSync(resolve(p), "utf8");
const runner = (pg: PGlite) => ({ setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]), exec: (sql: string) => pg.exec(sql) });
const n = async (pg: PGlite, sql: string, p: unknown[] = []) => Number(((await pg.query(sql, p as any[])).rows[0] as any).n);
const UP = "db/migrations/019_moderation_portal.sql";
const DOWN = "db/rollback/019_down.sql";

async function build(upTo = "019") {
  const pg = new PGlite();
  await pg.exec(read("tests/helpers/baseSchema.sql"));
  const name = String(((await pg.query("select current_database() d")).rows[0] as any).d);
  for (const f of pickFiles().filter((f) => f.split(/[\\/]/).pop()!.slice(0, 3) <= upTo)) await applyFile(runner(pg), name, read(f));
  await pg.exec("insert into users (full_name,email,role,password_hash) values ('Asha','a@example.com','TC','x'),('Ravi','r@example.com','TC','x'),('Ola','o@example.com','admin','x')");
  const sector = Number(((await pg.query("select id from sectors where slug='agriculture-dairy'")).rows[0] as any).id);
  return { pg, name, sector };
}
async function make(pg: PGlite, sector: number, title = "A contribution title", status = "pending_review") {
  const id = Number(((await pg.query("insert into contributions (user_id,type,title,body) values (1,'problem',$1,'A body that is long enough.') returning id", [title])).rows[0] as any).id);
  await pg.query("insert into contribution_scopes (contribution_id, sector_id) values ($1,$2)", [id, sector]);
  if (status !== "draft") await pg.query("update contributions set status=$2::varchar, submitted_at=now(), published_at = case when $2::varchar='published' then now() end where id=$1", [id, status]);
  return id;
}
const roundAt = async (pg: PGlite, id: number) => ((await pg.query("select review_round_at r from contributions where id=$1", [id])).rows[0] as any).r as Date | null;
const status = async (pg: PGlite) => migrationStatus((sql: string) => pg.query(sql));

describe("migration 019: schema", () => {
  it("adds five tables, the work-log view, review_round_at and three triggers; the status check says applied; safe to run twice", async () => {
    const { pg, name } = await build("018");
    expect(statusOf(await status(pg), "019")!.status).toBe("missing");
    await applyFile(runner(pg), name, read(UP));
    await applyFile(runner(pg), name, read(UP)); // twice: no error, nothing duplicated
    expect(await n(pg, "select count(*) n from information_schema.tables where table_name in ('contribution_replies','contribution_notes','contribution_views','contribution_categories','contribution_category_links') and table_type='BASE TABLE'")).toBe(5);
    expect(await n(pg, "select count(*) n from information_schema.views where table_name='contribution_work_log'")).toBe(1);
    expect(await n(pg, "select count(*) n from information_schema.columns where table_name='contributions' and column_name='review_round_at'")).toBe(1);
    expect(await n(pg, "select count(*) n from pg_trigger where tgname in ('contribution_replies_append_only','contribution_notes_append_only','contributions_review_round')")).toBe(3);
    expect(statusOf(await status(pg), "019")!.status).toBe("applied");
    await pg.close();
  });
  it("refuses to run without a confirmed database name, or with the wrong one, and changes nothing", async () => {
    const { pg } = await build("018");
    await pg.query("select set_config('rv.expected_db', '', false)");
    await expect(pg.exec(read(UP))).rejects.toThrow(/not set/); await pg.exec("ROLLBACK");
    await pg.query("select set_config('rv.expected_db', 'some_other_db', false)");
    await expect(pg.exec(read(UP))).rejects.toThrow(/Wrong database/); await pg.exec("ROLLBACK");
    expect(await n(pg, "select count(*) n from information_schema.tables where table_name='contribution_replies'")).toBe(0);
    await pg.close();
  });
  it("changes no existing row: every contribution keeps its status and no review_round_at is invented", async () => {
    const { pg, name, sector } = await build("018");
    const id = await make(pg, sector);
    await applyFile(runner(pg), name, read(UP));
    expect(await roundAt(pg, id)).toBeNull();
    expect(((await pg.query("select status from contributions where id=$1", [id])).rows[0] as any).status).toBe("pending_review");
    await pg.close();
  });
});

describe("replies and internal notes", () => {
  it("need 3 to 2000 (reply) / 1000 (note) characters after trimming", async () => {
    const { pg, sector } = await build();
    const id = await make(pg, sector);
    await expect(pg.query("insert into contribution_replies (contribution_id, author_id, message) values ($1,3,'  ab  ')", [id])).rejects.toThrow(/contribution_replies_message_ck/);
    await expect(pg.query("insert into contribution_replies (contribution_id, author_id, message) values ($1,3,$2)", [id, "x".repeat(2001)])).rejects.toThrow();
    await expect(pg.query("insert into contribution_notes (contribution_id, author_id, note) values ($1,3,'no')", [id])).rejects.toThrow(/contribution_notes_note_ck/);
    await pg.query("insert into contribution_replies (contribution_id, author_id, message) values ($1,3,'Thanks, please add a photo.')", [id]);
    await pg.query("insert into contribution_notes (contribution_id, author_id, note) values ($1,3,'Checked the website: real club.')", [id]);
    await pg.close();
  });
  it("are append only: no edit, no delete; a reply's email_sent_at can be filled in once, and nothing else with it", async () => {
    const { pg, sector } = await build();
    const id = await make(pg, sector);
    const r = Number(((await pg.query("insert into contribution_replies (contribution_id, author_id, message) values ($1,3,'A first reply') returning id", [id])).rows[0] as any).id);
    await pg.query("insert into contribution_notes (contribution_id, author_id, note) values ($1,3,'An internal note')", [id]);
    await expect(pg.query("update contribution_replies set message='Changed' where id=$1", [r])).rejects.toThrow(/never changed or deleted/);
    await expect(pg.query("delete from contribution_replies where id=$1", [r])).rejects.toThrow(/never changed or deleted/);
    await expect(pg.exec("update contribution_notes set note='Changed note'")).rejects.toThrow(/never changed or deleted/);
    await expect(pg.exec("delete from contribution_notes")).rejects.toThrow(/never changed or deleted/);
    await expect(pg.query("update contribution_replies set email_sent_at=now(), message='Sneaky' where id=$1", [r])).rejects.toThrow(/never changed or deleted/);
    await pg.query("update contribution_replies set email_sent_at=now() where id=$1", [r]);
    await expect(pg.query("update contribution_replies set email_sent_at=now() where id=$1", [r])).rejects.toThrow(/never changed or deleted/); // only once
    await pg.close();
  });
  it("go with the contribution when it is deleted (the database's own cleanup is allowed)", async () => {
    const { pg, sector } = await build();
    const id = await make(pg, sector, "To be deleted", "draft");
    await pg.query("insert into contribution_replies (contribution_id, author_id, message) values ($1,3,'A reply here')", [id]);
    await pg.query("insert into contribution_notes (contribution_id, author_id, note) values ($1,3,'A note here')", [id]);
    await pg.query("delete from contributions where id=$1", [id]);
    expect(await n(pg, "select count(*) n from contribution_replies")).toBe(0);
    expect(await n(pg, "select count(*) n from contribution_notes")).toBe(0);
    await pg.close();
  });
});

describe("views, structured categories and the review round", () => {
  it("one view row per item and moderator", async () => {
    const { pg, sector } = await build();
    const id = await make(pg, sector);
    await pg.query("insert into contribution_views (contribution_id, viewer_id) values ($1,3)", [id]);
    await expect(pg.query("insert into contribution_views (contribution_id, viewer_id) values ($1,3)", [id])).rejects.toThrow(/contribution_views_pkey/);
    await expect(pg.query("insert into contribution_views (contribution_id, viewer_id, first_viewed_at, last_viewed_at) values ($1,2, now(), now() - interval '1 day')", [id])).rejects.toThrow(/contribution_views_order_ck/);
    await pg.close();
  });
  it("categories and links accept only the form's own options, http(s) links, five links per category", async () => {
    const { pg, sector } = await build();
    const id = await make(pg, sector);
    await pg.query("insert into contribution_categories (contribution_id, category, remarks, position) values ($1,'Labs & Makerspaces','Open on Saturdays',1)", [id]);
    await expect(pg.query("insert into contribution_categories (contribution_id, category, position) values ($1,'Shops',2)", [id])).rejects.toThrow(/contribution_categories_category_ck/);
    const link = (pos: number, type: string, url: string) => pg.query("insert into contribution_category_links (contribution_id, category, position, link_type, url, gist) values ($1,'Labs & Makerspaces',$2,$3,$4,'What it shows')", [id, pos, type, url]);
    await link(1, "Website", "https://example.org/lab");
    await expect(link(2, "Brochure", "https://example.org/x")).rejects.toThrow(/contribution_category_links_type_ck/);
    await expect(link(2, "Website", "javascript:alert(1)")).rejects.toThrow(/contribution_category_links_url_ck/);
    await expect(link(6, "Website", "https://example.org/6")).rejects.toThrow(/contribution_category_links_position_ck/);
    await expect(pg.query("insert into contribution_category_links (contribution_id, category, position, link_type, url, gist) values ($1,'Projects',1,'Website','https://example.org','x')", [id])).rejects.toThrow(); // no such category chosen
    await pg.query("delete from contribution_categories where contribution_id=$1", [id]);
    expect(await n(pg, "select count(*) n from contribution_category_links")).toBe(0); // links go with their category
    await pg.close();
  });
  it("review_round_at is set whenever the item ENTERS pending_review, and only then", async () => {
    const { pg, sector } = await build();
    const id = await make(pg, sector, "Round trip", "draft");
    expect(await roundAt(pg, id)).toBeNull();
    await pg.query("update contributions set status='pending_review', submitted_at=now() where id=$1", [id]);
    const first = await roundAt(pg, id);
    expect(first).not.toBeNull();
    await pg.query("update contributions set title='Round trip, renamed' where id=$1", [id]);
    await pg.query("update contributions set status='pending_review' where id=$1", [id]); // still pending: not a new round
    expect((await roundAt(pg, id))!.getTime()).toBe(first!.getTime());
    await pg.query("update contributions set status='changes_requested' where id=$1", [id]);
    expect((await roundAt(pg, id))!.getTime()).toBe(first!.getTime());
    await pg.query("select pg_sleep(0.01)");
    await pg.query("update contributions set status='pending_review' where id=$1", [id]); // resubmitted: a new round
    expect((await roundAt(pg, id))!.getTime()).toBeGreaterThan(first!.getTime());
    await pg.close();
  });
  it("the work log lists every moderator action with who, what, when and the item, from where each is stored", async () => {
    const { pg, sector } = await build();
    const id = await make(pg, sector);
    await pg.query("insert into contribution_views (contribution_id, viewer_id) values ($1,3)", [id]);
    await pg.query("insert into contribution_reviews (contribution_id, reviewer_id, action) values ($1,3,'verify')", [id]);
    await pg.query("insert into contribution_replies (contribution_id, author_id, message) values ($1,3,'Please add a photo')", [id]);
    await pg.query("insert into contribution_notes (contribution_id, author_id, note) values ($1,3,'Looks genuine')", [id]);
    const rows = (await pg.query("select actor_id, action, contribution_id, detail from contribution_work_log order by action")).rows as any[];
    expect(rows.map((r) => [Number(r.actor_id), r.action, Number(r.contribution_id), r.detail])).toEqual([
      [3, "note", id, "Looks genuine"], [3, "reply", id, "Please add a photo"], [3, "verify", id, null], [3, "view", id, null],
    ]);
    await pg.close();
  });
});

describe("rollback 019", () => {
  it("is guarded by the confirmed database name", async () => {
    const { pg } = await build();
    await pg.query("select set_config('rv.expected_db', '', false)");
    await expect(pg.exec(read(DOWN))).rejects.toThrow(/not set/); await pg.exec("ROLLBACK");
    await pg.close();
  });
  it("refuses while any reply, note or structured category exists, and changes nothing", async () => {
    for (const add of [
      "insert into contribution_replies (contribution_id, author_id, message) values ($1,3,'A reply here')",
      "insert into contribution_notes (contribution_id, author_id, note) values ($1,3,'A note here')",
      "insert into contribution_categories (contribution_id, category, position) values ($1,'Projects',1)",
    ]) {
      const { pg, name, sector } = await build();
      const id = await make(pg, sector);
      await pg.query(add, [id]);
      await expect(applyFile(runner(pg), name, read(DOWN))).rejects.toThrow(/never deleted by an undo/);
      expect(await n(pg, "select count(*) n from information_schema.tables where table_name='contribution_replies'")).toBe(1);
      await pg.close();
    }
  });
  it("undo goes newest first: 017's rollback cannot run while 019 is applied (the work log reads 017's table), and changes nothing", async () => {
    const { pg, name } = await build();
    await applyFile(runner(pg), name, read("db/rollback/018_down.sql"));
    await expect(applyFile(runner(pg), name, read("db/rollback/017_down.sql"))).rejects.toThrow(/depend/);
    expect(await n(pg, "select count(*) n from information_schema.tables where table_name='contribution_reviews'")).toBe(1);
    await applyFile(runner(pg), name, read(DOWN));
    await applyFile(runner(pg), name, read("db/rollback/017_down.sql"));
    expect(await n(pg, "select count(*) n from information_schema.tables where table_name='contribution_reviews'")).toBe(0);
    await pg.close();
  });
  it("with only views recorded, removes everything 019 added and nothing else", async () => {
    const { pg, name, sector } = await build();
    const id = await make(pg, sector);
    await pg.query("insert into contribution_views (contribution_id, viewer_id) values ($1,3)", [id]);
    await pg.query("insert into contribution_reviews (contribution_id, reviewer_id, action) values ($1,3,'verify')", [id]);
    await applyFile(runner(pg), name, read(DOWN));
    expect(await n(pg, "select count(*) n from information_schema.tables where table_name in ('contribution_replies','contribution_notes','contribution_views','contribution_categories','contribution_category_links','contribution_work_log')")).toBe(0);
    expect(await n(pg, "select count(*) n from information_schema.columns where table_name='contributions' and column_name='review_round_at'")).toBe(0);
    expect(await n(pg, "select count(*) n from pg_trigger where tgname='contributions_review_round'")).toBe(0);
    expect(await n(pg, "select count(*) n from contributions")).toBe(1);
    expect(await n(pg, "select count(*) n from contribution_reviews")).toBe(1);
    expect(statusOf(await status(pg), "019")!.status).toBe("missing");
    expect(statusOf(await status(pg), "018")!.status).toBe("applied");
    await pg.close();
  });
});
