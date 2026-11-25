// Migration 012 (sectors, contributions, contribution_scopes) and its rollback, on an in-process PostgreSQL (PGlite).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { applyFile, pickFiles } from "../scripts/migrate.mjs";
import { contributionDbError } from "../src/lib/contributions";
import { migratedClone } from "./helpers/migratedClone";

const read = (p: string) => readFileSync(resolve(p), "utf8");
const runner = (pg: PGlite) => ({
  setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]),
  exec: (sql: string) => pg.exec(sql),
});
const tables = async (pg: PGlite) =>
  (await pg.query("select table_name t from information_schema.tables where table_schema='public' order by 1")).rows.map((r: any) => r.t);
const count = async (pg: PGlite, sql: string) => Number(((await pg.query(sql)).rows[0] as any).n);

const UP = "db/migrations/012_contributions.sql";
const DOWN = "db/rollback/012_down.sql";
const NEW = ["contribution_scopes", "contributions", "sectors"];
const PHOTOS = ["contribution_contacts", "contribution_photo_blobs", "contribution_photos", "contribution_title_keys"]; // later migrations that depend on contributions (013, 014, 018)

async function build() {
  const { pg, name } = await migratedClone(); // built once per file, a fresh copy per test (tests/helpers/migratedClone.ts)
  await pg.exec("insert into users (full_name,email,role,password_hash) values ('Asha','a@example.com','TC','x'),('Ravi','r@example.com','TC','x')");
  await pg.exec("insert into sectors (slug,name) values ('education','Education'),('healthcare','Healthcare')"); // agriculture-dairy is already there (id 1): migration 016 adds it
  return { pg, name };
}
let titleNo = 0; // each fixture gets its own title: migration 018 refuses two live contributions with the same title in one sector
const draftSql = () => `insert into contributions (user_id,type,title,body) values (1,'problem','Shed cleaning by hand ${++titleNo}','Two workers clean the shed by hand.') returning id`;
const newDraft = async (pg: PGlite) => Number(((await pg.query(draftSql())).rows[0] as any).id);
const bad = (pg: PGlite, sql: string, re?: RegExp) => expect(pg.exec(sql)).rejects.toThrow(re);

describe("migration 012", () => {
  let pg: PGlite; let name: string;
  beforeAll(async () => { ({ pg, name } = await build()); });

  it("adds only sectors, contributions and contribution_scopes, and is safe to run twice", async () => {
    const t = await tables(pg);
    for (const n of NEW) expect(t).toContain(n);
    await applyFile(runner(pg), name, read(UP));
    expect((await tables(pg)).filter((x) => NEW.includes(x))).toHaveLength(3);
    expect(await count(pg, "select count(*) n from pg_trigger where tgname in ('contributions_needs_scope','contribution_scopes_keep_last')")).toBe(2);
  });

  it("seeds nothing (the first sector comes from migration 016, not from 012)", async () => {
    const fresh = new PGlite();
    await fresh.exec(read("tests/helpers/baseSchema.sql"));
    const n = String(((await fresh.query("select current_database() d")).rows[0] as any).d);
    for (const f of pickFiles().filter((x: string) => x.replace(/\\/g, "/").split("/").pop()!.slice(0, 3) <= "012")) await applyFile(runner(fresh), n, read(f)); // up to and including 012 only
    expect(await count(fresh, "select count(*) n from sectors")).toBe(0);
    expect(await count(fresh, "select count(*) n from contributions")).toBe(0);
    await fresh.close();
  });

  it("refuses to run without a confirmed database name, or with the wrong one", async () => {
    const other = new PGlite();
    await other.exec(read("tests/helpers/baseSchema.sql"));
    await expect(other.exec(read(UP))).rejects.toThrow(/not set/);
    await other.exec("ROLLBACK");
    await other.query("select set_config('rv.expected_db', 'some_other_db', false)");
    await expect(other.exec(read(UP))).rejects.toThrow(/Wrong database/);
    await other.exec("ROLLBACK");
    expect(await tables(other)).not.toContain("contributions");
    await other.close();
  });

  it("accepts a draft and defaults it to a non-demo draft", async () => {
    const id = await newDraft(pg);
    const r: any = (await pg.query("select status,is_demo,submitted_at,published_at from contributions where id=$1", [id])).rows[0];
    expect(r).toMatchObject({ status: "draft", is_demo: false, submitted_at: null, published_at: null });
  });

  it("accepts all 14 types and rejects any other", async () => {
    for (const t of ["problem", "discovered", "experience", "costs", "resource", "challenge", "improve", "rental", "repairs", "support", "trial", "learning", "supplier", "correct"])
      await pg.exec(`insert into contributions (user_id,type,title,body) values (1,'${t}','A fine title','A fine body text')`);
    await bad(pg, "insert into contributions (user_id,type,title,body) values (1,'spam','A fine title','A fine body text')", /contributions_type_ck/);
  });

  it("rejects bad lengths, bad robot types, bad statuses and a missing user", async () => {
    const ins = (cols: string, vals: string) => `insert into contributions (user_id,type,title,body${cols}) values (1,'problem','A fine title','A fine body text'${vals})`;
    await bad(pg, "insert into contributions (user_id,type,title,body) values (1,'problem','abc','A fine body text')", /title_ck/);
    await bad(pg, "insert into contributions (user_id,type,title,body) values (1,'problem','     ','A fine body text')", /title_ck/);
    await bad(pg, `insert into contributions (user_id,type,title,body) values (1,'problem','${"x".repeat(151)}','A fine body text')`);
    await bad(pg, "insert into contributions (user_id,type,title,body) values (1,'problem','A fine title','short')", /body_ck/);
    await bad(pg, `insert into contributions (user_id,type,title,body) values (1,'problem','A fine title','${"y".repeat(4001)}')`, /body_ck/);
    await bad(pg, ins(",robot_type", ",'Drone Sprayers'"), /robot_type_ck/);
    await bad(pg, ins(",status", ",'approved'"), /status_ck|at least one sector/); // the sector guard may fire first; either way it is refused
    await bad(pg, "insert into contributions (user_id,type,title,body) values (999,'problem','A fine title','A fine body text')", /foreign key|violates/);
    await pg.exec(ins(",robot_type", ",'drone-sprayers'"));
  });

  it("keeps status and timestamps consistent", async () => {
    const id = await newDraft(pg);
    await pg.exec(`insert into contribution_scopes values (${id},1)`);
    await bad(pg, `update contributions set status='approved', submitted_at=now() where id=${id}`, /status_ck/); // not one of the four
    await bad(pg, `update contributions set status='pending_review' where id=${id}`, /submitted_ck/);
    await pg.exec(`update contributions set status='pending_review', submitted_at=now() where id=${id}`);
    await bad(pg, `update contributions set status='published' where id=${id}`, /published_ck/);
    await bad(pg, `update contributions set published_at=now() where id=${id}`, /published_ck/);
    await pg.exec(`update contributions set status='published', published_at=now() where id=${id}`);
    await bad(pg, `update contributions set submitted_at=null where id=${id}`, /submitted_ck/);
  });

  it("supports several sectors per contribution and refuses the same sector twice", async () => {
    const id = await newDraft(pg);
    await pg.exec(`insert into contribution_scopes (contribution_id,sector_id) values (${id},1),(${id},2),(${id},3)`);
    expect(await count(pg, `select count(*) n from contribution_scopes where contribution_id=${id}`)).toBe(3);
    const dup = `insert into contribution_scopes (contribution_id,sector_id) values (${id},2)`;
    await bad(pg, dup, /duplicate key|contribution_scopes_pkey/);
    let caught: unknown;
    try { await pg.exec(dup); } catch (e) { caught = e; }
    expect(contributionDbError(caught)).toMatchObject({ field: "sectors" });
    await bad(pg, `insert into contribution_scopes (contribution_id,sector_id) values (${id},999)`, /foreign key|violates/);
    await bad(pg, "insert into contribution_scopes (contribution_id,sector_id) values (999999,1)", /foreign key|violates/);
  });

  it("a sector count includes a multi-sector contribution once per sector, never twice in one sector", async () => {
    const { pg: p } = await build();
    const mk = async (user: number, sectors: number[], published: boolean, demo = false) => {
      const id = Number(((await p.query(`insert into contributions (user_id,type,title,body,is_demo) values (${user},'problem','A fine title ${++titleNo}','A fine body text',${demo}) returning id`)).rows[0] as any).id);
      for (const s of sectors) await p.exec(`insert into contribution_scopes values (${id},${s})`);
      if (published) await p.exec(`update contributions set status='published', submitted_at=now(), published_at=now() where id=${id}`);
      return id;
    };
    await mk(1, [1, 2], true);
    await mk(2, [1], true);
    await mk(1, [1, 2, 3], false);
    await mk(1, [3], true, true);
    const counts = (await p.query(`
      select s.slug, count(distinct c.id)::int n, count(distinct c.user_id)::int people
      from sectors s left join contribution_scopes cs on cs.sector_id = s.id
      left join contributions c on c.id = cs.contribution_id and c.status='published' and not c.is_demo
      group by s.slug order by s.slug`)).rows as any[];
    expect(counts.map((r) => [r.slug, r.n, r.people])).toEqual([["agriculture-dairy", 2, 2], ["education", 1, 1], ["healthcare", 0, 0]]);
    await p.close();
  });

  it("will not submit a contribution with no sector, nor remove the last sector of a submitted one", async () => {
    const id = await newDraft(pg);
    await bad(pg, `update contributions set status='pending_review', submitted_at=now() where id=${id}`, /at least one sector/);
    await pg.exec(`insert into contribution_scopes values (${id},1),(${id},2)`);
    await pg.exec(`update contributions set status='pending_review', submitted_at=now() where id=${id}`);
    await pg.exec(`delete from contribution_scopes where contribution_id=${id} and sector_id=1`);
    await bad(pg, `delete from contribution_scopes where contribution_id=${id} and sector_id=2`, /keep at least one sector/);
    expect(contributionDbError({ code: "23514", message: "A submitted contribution must keep at least one sector." })).toMatchObject({ field: "sectors" });
    const d = await newDraft(pg);
    await pg.exec(`insert into contribution_scopes values (${d},1)`);
    await pg.exec(`delete from contribution_scopes where contribution_id=${d}`);
    await bad(pg, "insert into contributions (user_id,type,title,body,status,submitted_at) values (1,'problem','A fine title','A fine body text','pending_review',now())", /at least one sector/);
  });

  it("deleting a user removes their contributions and sectors; a sector in use cannot be deleted", async () => {
    const { pg: p } = await build();
    const id = Number(((await p.query(draftSql())).rows[0] as any).id);
    await p.exec(`insert into contribution_scopes values (${id},1),(${id},2)`);
    await p.exec(`update contributions set status='pending_review', submitted_at=now() where id=${id}`);
    await expect(p.exec("delete from sectors where id=1")).rejects.toThrow(/foreign key|violates/);
    await p.exec("delete from users where id=1");
    expect(await count(p, "select count(*) n from contributions")).toBe(0);
    expect(await count(p, "select count(*) n from contribution_scopes")).toBe(0);
    await p.close();
  });

  it("checks sector slugs and names", async () => {
    await bad(pg, "insert into sectors (slug,name) values ('Bad Slug','Bad')", /sectors_slug_ck/);
    await bad(pg, "insert into sectors (slug,name) values ('ok-slug','x')", /sectors_name_ck/);
    await bad(pg, "insert into sectors (slug,name) values ('education','Education again')", /duplicate key|unique/);
  });
});

/** Undoes the later migrations whose tables point at 012's, newest first. Their tables are empty here, so none of them refuses. */
async function undoLater(pg: PGlite, name: string) {
  await applyFile(runner(pg), name, read("db/rollback/026_down.sql")); // newest first (026: questions point at sectors)
  await applyFile(runner(pg), name, read("db/rollback/025_down.sql")); // 025 points at 024, and 024 at sectors
  await applyFile(runner(pg), name, read("db/rollback/024_down.sql")); // 024: robot types point at sectors
  await applyFile(runner(pg), name, read("db/rollback/019_down.sql"));
  await applyFile(runner(pg), name, read("db/rollback/018_down.sql"));
  await applyFile(runner(pg), name, read("db/rollback/017_down.sql"));
  await applyFile(runner(pg), name, read("db/rollback/014_down.sql"));
  await applyFile(runner(pg), name, read("db/rollback/013_down.sql"));
}

describe("rollback 012", () => {
  it("removes exactly the new objects, keeps everything else, and the migration can be applied again", async () => {
    const { pg, name } = await build();
    const P019 = ["contribution_replies", "contribution_notes", "contribution_views", "contribution_categories", "contribution_category_links", "contribution_work_log"];
    const before = (await tables(pg)).filter((t) => !NEW.includes(t) && !PHOTOS.includes(t) && t !== "contribution_reviews" && !P019.includes(t) && t !== "sector_robot_types" && t !== "sector_questions");
    await pg.exec("delete from sectors where slug in ('education','healthcare')"); // the owner decided the added sectors may go (otherwise it refuses: next test)
    await expect(applyFile(runner(pg), name, read(DOWN))).rejects.toThrow(/depend/); // 013 (photos), 014 (contacts), 017 (reviews) depend on contributions, 024 (robot types) and 026 (questions) on sectors: undo them first
    await pg.exec("ROLLBACK");
    await undoLater(pg, name);
    await applyFile(runner(pg), name, read(DOWN));
    const after = await tables(pg);
    for (const n of NEW) expect(after).not.toContain(n);
    expect(after).toEqual(before);
    expect(await count(pg, "select count(*) n from pg_proc where proname in ('rv_contribution_needs_scope','rv_scope_keep_last')")).toBe(0);
    expect(await count(pg, "select count(*) n from users")).toBe(2);
    await applyFile(runner(pg), name, read(DOWN));
    await applyFile(runner(pg), name, read(UP));
    await applyFile(runner(pg), name, read("db/migrations/013_contribution_photos.sql"));
    await applyFile(runner(pg), name, read("db/migrations/014_contribution_contacts.sql"));
    await applyFile(runner(pg), name, read("db/migrations/017_review_statuses.sql"));
    expect(await tables(pg)).toContain("contributions");
    await pg.close();
  });

  it("REFUSES while any contribution, sector choice or added sector exists, and changes nothing; the sector 016 seeds does not count", async () => {
    const { pg, name } = await build();
    await undoLater(pg, name);
    const before = await tables(pg);
    // build() added Education and Healthcare: they are the owner's sectors, not a seed
    await expect(applyFile(runner(pg), name, read(DOWN))).rejects.toThrow(/sectors holds 2 sector\(s\) besides the seeded Agriculture & Dairy/);
    await pg.exec("ROLLBACK").catch(() => undefined);
    expect(await tables(pg)).toEqual(before);
    expect(await count(pg, "select count(*) n from sectors")).toBe(3);
    await pg.exec("delete from sectors where slug in ('education','healthcare')");
    const id = await newDraft(pg);
    await pg.exec(`insert into contribution_scopes (contribution_id, sector_id) select ${id}, id from sectors where slug = 'agriculture-dairy'`);
    await expect(applyFile(runner(pg), name, read(DOWN))).rejects.toThrow(/contributions holds 1 row\(s\)/);
    await pg.exec("ROLLBACK").catch(() => undefined);
    expect(await tables(pg)).toEqual(before);
    expect(await count(pg, "select count(*) n from contributions")).toBe(1);
    expect(await count(pg, "select count(*) n from contribution_scopes")).toBe(1);
    await pg.exec("delete from contributions"); // someone decided the members' work may go (its sector choice goes with it)
    expect(await count(pg, "select count(*) n from sectors where slug = 'agriculture-dairy'")).toBe(1); // only 016's seed is left
    await applyFile(runner(pg), name, read(DOWN)); // the seed alone never blocks the undo
    for (const t of NEW) expect(await tables(pg)).not.toContain(t);
    await pg.close();
  });

  // The agriculture-dairy row counts as 016's seed only when it passes rollback 016's own test (exactly 016's values, and written
  // together with 016's index). A row that rollback 016 kept is someone's, so this undo must refuse instead of dropping it.
  const AGRI = "select slug, name, sort_order, is_active, is_demo from sectors";
  const D016 = "db/rollback/016_down.sql";
  const seedRefusal = /sectors holds 1 sector\(s\) that are not migration 016's untouched seed: agriculture-dairy\. .*cannot be proven to be the one 016 inserted.*Nothing was changed/;

  it("REFUSES when the seeded row was edited after 016: with 016's index still there, and after rollback 016 kept it (review probe P1a)", async () => {
    const { pg, name } = await migratedClone(); // 001-026: 016's untouched seed is the only sector
    await pg.exec("update sectors set sort_order = 20 where slug = 'agriculture-dairy'"); // an administrator moved it: it is theirs now
    await undoLater(pg, name);
    const before = await tables(pg);
    await expect(applyFile(runner(pg), name, read(DOWN))).rejects.toThrow(seedRefusal); // 016's index is there, but the values differ
    await pg.exec("ROLLBACK").catch(() => undefined);
    await applyFile(runner(pg), name, read(D016)); // rollback 016 keeps the edited row (NOTICE) and removes its index
    expect((await pg.query(AGRI)).rows).toEqual([{ slug: "agriculture-dairy", name: "Agriculture & Dairy", sort_order: 20, is_active: true, is_demo: false }]);
    expect(await count(pg, "select count(*) n from pg_indexes where indexname = 'sectors_name_lower_uq'")).toBe(0);
    await expect(applyFile(runner(pg), name, read(DOWN))).rejects.toThrow(seedRefusal);
    await pg.exec("ROLLBACK").catch(() => undefined);
    expect(await tables(pg)).toEqual(before); // nothing was dropped: sectors, contributions and contribution_scopes are all still there
    expect((await pg.query(AGRI)).rows).toEqual([{ slug: "agriculture-dairy", name: "Agriculture & Dairy", sort_order: 20, is_active: true, is_demo: false }]);
    await pg.close();
  });

  it("REFUSES when the owner's agriculture-dairy row existed before 016, even with exactly 016's values (review probe P1b)", async () => {
    const { pg, name } = await migratedClone((id) => id < "016"); // 001-015
    await pg.exec("insert into sectors (slug, name, sort_order, is_active, is_demo) values ('agriculture-dairy', 'Agriculture & Dairy', 10, true, false)");
    for (const f of pickFiles().filter((x: string) => x.replace(/\\/g, "/").split("/").pop()!.slice(0, 3) >= "016")) await applyFile(runner(pg), name, read(f)); // then 016-026
    await undoLater(pg, name);
    await applyFile(runner(pg), name, read(D016)); // 016 did not make the row (its insert did nothing), so rollback 016 keeps it
    expect((await pg.query(AGRI)).rows).toEqual([{ slug: "agriculture-dairy", name: "Agriculture & Dairy", sort_order: 10, is_active: true, is_demo: false }]);
    const before = await tables(pg);
    await expect(applyFile(runner(pg), name, read(DOWN))).rejects.toThrow(seedRefusal); // a matching slug and matching values prove nothing
    await pg.exec("ROLLBACK").catch(() => undefined);
    expect(await tables(pg)).toEqual(before);
    for (const t of NEW) expect(before).toContain(t);
    expect((await pg.query(AGRI)).rows).toEqual([{ slug: "agriculture-dairy", name: "Agriculture & Dairy", sort_order: 10, is_active: true, is_demo: false }]);
    await pg.close();
  });

  it("an untouched 016 seed: rollback 016 removes it, then this undo goes ahead (the normal newest-first order still works)", async () => {
    const { pg, name } = await migratedClone();
    await undoLater(pg, name);
    await applyFile(runner(pg), name, read(D016)); // removes 016's own row and its index
    expect(await count(pg, "select count(*) n from sectors")).toBe(0);
    await applyFile(runner(pg), name, read(DOWN));
    for (const t of NEW) expect(await tables(pg)).not.toContain(t);
    await pg.close();
  });

  it("refuses without a confirmed database name", async () => {
    const { pg } = await build();
    await pg.query("select set_config('rv.expected_db', '', false)");
    await expect(pg.exec(read(DOWN))).rejects.toThrow(/not set/);
    await pg.exec("ROLLBACK");
    expect(await tables(pg)).toContain("contributions");
    await pg.close();
  });
});
