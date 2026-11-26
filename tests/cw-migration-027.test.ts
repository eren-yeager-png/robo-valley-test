// Migration 027 (contribution workflow): additive, safe to run twice, ids from 1025, the original submission written once (enforced by
// the database too: acceptance 7), history/versions/feedback/attachments append-only, and a rollback that refuses while ideas exist.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyFile } from "../scripts/migrate.mjs";
import { evaluate, readSnapshot } from "../scripts/migration-status.mjs";
import { migratedClone } from "./helpers/migratedClone";

const read = (p: string) => readFileSync(p, "utf8");
const runner = (pg: any) => ({ setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]), exec: (sql: string) => pg.exec(sql) });
async function db() {
  const { pg, name } = await migratedClone();
  await pg.exec("insert into users (full_name,email,role,password_hash) values ('Ananya Rao','a@example.com','ST','x')");
  const uid = Number(((await pg.query("select id from users")).rows[0] as any).id);
  const add = async () => Number(((await pg.query(
    `insert into cw_contributions (user_id, contributor_name, contributor_type, kind, original, proposed, reference_links, resource)
     values ($1, 'Ananya Rao', 'ST', 'New idea', '{"title":"T"}', '{"title":"T"}', '[]', null) returning id`, [uid])).rows[0] as any).id);
  return { pg, name, uid, add };
}
const rejects = async (p: Promise<unknown>, re: RegExp) => { await expect(p).rejects.toThrow(re); };

describe("migration 027", () => {
  it("is reported applied by the status checker, with every object present", async () => {
    const { pg } = await db();
    const r = evaluate(await readSnapshot((sql: string) => pg.query(sql) as never)).find((m) => m.id === "027")!;
    expect(r.status).toBe("applied");
    expect(r.absent).toEqual([]);
    await pg.close();
  });
  it("numbers ideas from 1025", async () => {
    const { pg, add } = await db();
    expect([await add(), await add()]).toEqual([1025, 1026]);
    await pg.close();
  });
  it("the original submission cannot be changed, even with SQL; proposed, notes and status can", async () => {
    const { pg, add } = await db();
    const id = await add();
    for (const set of [`original = '{"title":"X"}'`, `resource = '{"path":"x"}'`, `reference_links = '[{"url":"https://x"}]'`, `kind = 'Suggestion'`, `contributor_name = 'Someone'`, `contributor_type = 'PA'`, `submitted_at = now() - interval '1 day'`]) {
      await rejects(pg.query(`update cw_contributions set ${set} where id = $1`, [id]), /cannot be changed/);
    }
    await pg.query(`update cw_contributions set proposed = '{"title":"Better"}', notes = 'n', status = 'under_review', row_version = row_version + 1 where id = $1`, [id]);
    expect(((await pg.query("select proposed->>'title' t, original->>'title' o from cw_contributions where id = $1", [id])).rows[0] as any)).toEqual({ t: "Better", o: "T" });
    await pg.close();
  });
  it("deleting the account keeps the idea (the link is cleared, the name stays)", async () => {
    const { pg, uid, add } = await db();
    const id = await add();
    await pg.query("delete from users where id = $1", [uid]);
    expect((await pg.query("select user_id, contributor_name from cw_contributions where id = $1", [id])).rows[0]).toEqual({ user_id: null, contributor_name: "Ananya Rao" });
    await pg.close();
  });
  it("history, versions, feedback and attachments are append-only", async () => {
    const { pg, add } = await db();
    const id = await add();
    await pg.query("insert into cw_contribution_history (contribution_id, actor, text) values ($1, 'A', 'x')", [id]);
    await pg.query(`insert into cw_contribution_versions (contribution_id, v, by_name, role, data) values ($1, 1, 'M', 'Moderator', '{}')`, [id]);
    await pg.query("insert into cw_contribution_feedback (contribution_id, type, text, by_name) values ($1, 'changes', 'f', 'A')", [id]);
    await pg.query("insert into cw_contribution_attachments (contribution_id, file_name, mime, byte_size, file_sha256, data) values ($1, 'a.png', 'image/png', 1, $2, $3)", [id, "a".repeat(64), new Uint8Array([1])]);
    for (const t of ["cw_contribution_history", "cw_contribution_versions", "cw_contribution_feedback", "cw_contribution_attachments"]) {
      await rejects(pg.query(`update ${t} set created_at = now() where contribution_id = $1`, [id]), /append_only|never changed/);
      await rejects(pg.query(`delete from ${t} where contribution_id = $1`, [id]), /append_only|never changed/);
    }
    await rejects(pg.query("insert into cw_contribution_attachments (contribution_id, file_name, mime, byte_size, file_sha256, data) values ($1, 'b.gif', 'image/gif', 1, $2, $3)", [await add(), "b".repeat(64), new Uint8Array([1])]), /check/i);
    await pg.close();
  });
  it("is safe to run again: nothing changes and no error", async () => {
    const { pg, name, add } = await db();
    const id = await add();
    await applyFile(runner(pg), name, read("db/migrations/027_contribution_workflow.sql"));
    await applyFile(runner(pg), name, read("db/migrations/027_contribution_workflow.sql"));
    expect(Number(((await pg.query("select count(*)::int n from cw_contributions")).rows[0] as any).n)).toBe(1);
    expect(((await pg.query("select count(*)::int n from pg_trigger where tgname like 'cw_%'")).rows[0] as any).n).toBe(5);
    expect(await add()).toBe(id + 1);
    await pg.close();
  });
  it("the rollback refuses while ideas exist, and otherwise removes only the cw_ objects", async () => {
    const { pg, name, add } = await db();
    await add();
    await rejects(applyFile(runner(pg), name, read("db/rollback/027_down.sql")), /erase members/);
    await pg.exec("ROLLBACK").catch(() => undefined);
    await pg.exec("truncate cw_contributions cascade");
    const before = ((await pg.query("select count(*)::int n from information_schema.tables where table_schema = current_schema() and table_name not like 'cw\\_%'")).rows[0] as any).n;
    await applyFile(runner(pg), name, read("db/rollback/027_down.sql"));
    const left = (await pg.query("select table_name from information_schema.tables where table_schema = current_schema() and table_name like 'cw\\_%'")).rows;
    expect(left).toEqual([]);
    expect(((await pg.query("select count(*)::int n from information_schema.tables where table_schema = current_schema() and table_name not like 'cw\\_%'")).rows[0] as any).n).toBe(before);
    expect(Number(((await pg.query("select count(*)::int n from users")).rows[0] as any).n)).toBe(1);
    await pg.close();
  });
});
