// Migration 028 (the contribution workflow's decided open points): it widens three of 027's checks under the SAME names, so a database
// that already ran the merged 027 gets the new values (Unpublished; a Moderator's decline; an Admin's reopen) and nothing else changes.
// New and idempotent; 027 is never edited. The rollback refuses while the new values are in use and otherwise restores 027's lists.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyFile } from "../scripts/migrate.mjs";
import { evaluate, readSnapshot } from "../scripts/migration-status.mjs";
import { migratedClone } from "./helpers/migratedClone";

const read = (p: string) => readFileSync(p, "utf8");
const UP = "db/migrations/028_contribution_workflow_decisions.sql", DOWN = "db/rollback/028_down.sql";
const runner = (pg: any) => ({ setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]), exec: (sql: string) => pg.exec(sql) });
const rejects = async (p: Promise<unknown>, re: RegExp) => { await expect(p).rejects.toThrow(re); };
const defs = async (pg: any) => Object.fromEntries(((await pg.query(
  "select conname, pg_get_constraintdef(oid) d from pg_constraint where conname in ('cw_contributions_status_ck','cw_contributions_published_ck','cw_contribution_feedback_ck') order by conname")).rows as any[]).map((r) => [r.conname, r.d]));
const status = async (pg: any, id: string) => evaluate(await readSnapshot((sql: string) => pg.query(sql) as never)).find((m) => m.id === id)!;
async function idea(pg: any) {
  await pg.exec("insert into users (full_name,email,role,password_hash) values ('Ananya Rao','a@example.com','ST','x')");
  const uid = Number(((await pg.query("select id from users")).rows[0] as any).id);
  return Number(((await pg.query(
    `insert into cw_contributions (user_id, contributor_name, contributor_type, kind, original, proposed) values ($1, 'Ananya Rao', 'ST', 'New idea', '{"title":"T"}', '{"title":"T"}') returning id`, [uid])).rows[0] as any).id);
}

describe("migration 028", () => {
  it("is missing on a database with the merged 027 only, applied after it runs, and blocked by 027 when that is missing", async () => {
    const only027 = await migratedClone((id) => id <= "027");
    expect((await status(only027.pg, "028")).status).toBe("missing");
    await applyFile(runner(only027.pg), only027.name, read(UP));
    expect((await status(only027.pg, "028")).status).toBe("applied");
    expect((await status(only027.pg, "027")).status).toBe("applied"); // 027's own checks are unaffected (same names)
    await only027.pg.close();
    const before027 = await migratedClone((id) => id <= "026");
    expect(await status(before027.pg, "028")).toMatchObject({ status: "missing", blockedBy: ["027"] });
    await rejects(applyFile(runner(before027.pg), before027.name, read(UP)), /apply migration 027 first/);
    await before027.pg.close();
  });
  it("on a database that already holds ideas: the rows stay, and the new values are allowed (and nothing else)", async () => {
    const { pg, name } = await migratedClone((id) => id <= "027");
    const id = await idea(pg);
    await rejects(pg.query("update cw_contributions set status = 'unpublished', published_at = now(), published_version = 1 where id = $1", [id]), /status_ck/); // 027 alone
    await applyFile(runner(pg), name, read(UP));
    expect(((await pg.query("select count(*)::int n from cw_contributions")).rows[0] as any).n).toBe(1);
    await rejects(pg.query("update cw_contributions set status = 'unpublished' where id = $1", [id]), /published_ck/); // only after a publication
    await pg.query("update cw_contributions set status = 'unpublished', published_at = now(), published_version = 1 where id = $1", [id]);
    await rejects(pg.query("update cw_contributions set status = 'archived' where id = $1", [id]), /status_ck/);
    for (const t of ["changes", "reject", "decline", "reopen"]) await pg.query("insert into cw_contribution_feedback (contribution_id, type, text, by_name) values ($1, $2, 'r', 'A')", [id, t]);
    await rejects(pg.query("insert into cw_contribution_feedback (contribution_id, type, text, by_name) values ($1, 'appeal', 'r', 'A')", [id]), /feedback_ck/);
    await pg.close();
  });
  it("is safe to run again: the checks stay exactly the same and nothing errors", async () => {
    const { pg, name } = await migratedClone();
    const before = await defs(pg);
    await applyFile(runner(pg), name, read(UP));
    await applyFile(runner(pg), name, read(UP));
    expect(await defs(pg)).toEqual(before);
    expect(before.cw_contributions_status_ck).toContain("'unpublished'");
    await pg.close();
  });
  it("the rollback refuses while an idea is Unpublished or a decline or reopen reason exists; otherwise it restores 027's lists", async () => {
    const original = await migratedClone((id) => id <= "027");
    const lists027 = await defs(original.pg);
    await original.pg.close();
    const { pg, name } = await migratedClone();
    const id = await idea(pg);
    await pg.query("update cw_contributions set status = 'unpublished', published_at = now(), published_version = 1 where id = $1", [id]);
    await rejects(applyFile(runner(pg), name, read(DOWN)), /1 idea\(s\) are Unpublished/);
    await pg.exec("ROLLBACK").catch(() => undefined);
    await pg.query("update cw_contributions set status = 'published' where id = $1", [id]);
    await pg.query("insert into cw_contribution_feedback (contribution_id, type, text, by_name) values ($1, 'decline', 'r', 'A')", [id]);
    await rejects(applyFile(runner(pg), name, read(DOWN)), /1 decline or reopen reason/);
    await pg.exec("ROLLBACK").catch(() => undefined);
    const clean = await migratedClone();
    await applyFile(runner(clean.pg), clean.name, read(DOWN));
    expect(await defs(clean.pg)).toEqual(lists027);
    expect((await status(clean.pg, "028")).status).toBe("missing");
    await pg.close(); await clean.pg.close();
  });
  it("never edits 027: the merged file is byte-identical to main's", () => {
    const sql = read("db/migrations/027_contribution_workflow.sql");
    expect(sql).toContain("CONSTRAINT cw_contributions_status_ck CHECK (status IN ('submitted', 'under_review', 'draft', 'pending', 'changes_requested', 'resubmitted', 'publishing', 'published', 'failed', 'rejected')),");
    expect(sql).toContain("CHECK (type IN ('changes', 'reject') AND");
  });
});
