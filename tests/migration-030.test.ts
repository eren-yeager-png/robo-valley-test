// Migration 030 (the Contribution Portal's data, Phase B): additive, safe to run twice, backfills only the new columns and tables, and
// its rollback refuses while something entered after it would be lost. Throwaway in-process databases (PGlite) only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyFile } from "../scripts/migrate.mjs";
import { evaluate, readSnapshot } from "../scripts/migration-status.mjs";
import { migratedClone } from "./helpers/migratedClone";

const read = (p: string) => readFileSync(p, "utf8");
const UP = "db/migrations/030_contribution_portal.sql", DOWN = "db/rollback/030_down.sql";
const runner = (pg: any) => ({ setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]), exec: (sql: string) => pg.exec(sql) });
const rejects = async (p: Promise<unknown>, re: RegExp) => { await expect(p).rejects.toThrow(re); };
const status = async (pg: any, id: string) => evaluate(await readSnapshot((sql: string) => pg.query(sql) as never)).find((m) => m.id === id)!;
const rows = async (pg: any, sql: string, params: unknown[] = []) => (await pg.query(sql, params)).rows as any[];
const one = async (pg: any, sql: string, params: unknown[] = []) => (await rows(pg, sql, params))[0];
const count = async (pg: any, table: string) => Number((await one(pg, `select count(*)::int n from ${table}`)).n);
const SECTOR = "Education";

/** A database before 030 that holds a bit of everything 030 reads: fields, ideas (published, declined, suggestions, a demo one), and a
 *  contribution sent with the current form that was verified and published. Returns the ids the tests look at. */
async function seeded(pg: any) {
  const user = async (name: string, email: string, role: string, moderator = false) => Number((await one(pg,
    "insert into users (full_name, email, role, password_hash, is_moderator) values ($1, $2, $3, 'x', $4) returning id", [name, email, role, moderator])).id);
  const admin = await user("Asha Admin", "admin@example.com", "admin");
  const mod = await user("Mohan Moderator", "mod@example.com", "TC", true);
  const member = await user("Neha Sharma", "neha@example.com", "ST");
  const sector = Number((await one(pg, "insert into sectors (slug, name, sort_order) values ('education', $1, 20) returning id", [SECTOR])).id);
  const field = async (slug: string, name: string, active: boolean, order: number) => Number((await one(pg,
    "insert into sector_robot_types (sector_id, slug, name, is_active, sort_order, updated_by) values ($1, $2, $3, $4, $5, $6) returning id", [sector, slug, name, active, order, admin])).id);
  const tutor = await field("tutor-robots", "Tutor robots", true, 10);
  const lab = await field("lab-assistants", "Lab assistants", false, 20);
  const idea = async (title: string, o: { kind?: string; status?: string; robot?: string; path?: string; demo?: boolean } = {}) => {
    const v = JSON.stringify({ title, description: "A description that is long enough to send.", sector: "education", robotType: o.robot ?? "not-sure", categories: ["Projects"], suitableFor: [], learningPath: "" });
    const resource = o.path ? JSON.stringify({ feature: "Robots by Sector", type: "Sector page", path: o.path, url: "", change: "Add it", id: "" }) : null;
    return Number((await one(pg,
      `insert into cw_contributions (user_id, contributor_name, contributor_type, kind, resource, original, proposed, is_demo) values ($1, 'Neha Sharma', 'ST', $2, $3::jsonb, $4::jsonb, $4::jsonb, $5) returning id`,
      [member, o.kind ?? "New idea", resource, v, o.demo === true])).id);
  };
  const version = (id: number, by: number, name: string) => pg.query(
    "insert into cw_contribution_versions (contribution_id, v, by_user_id, by_name, role, data) select $1, 1, $2, $3, 'Moderator', proposed from cw_contributions where id = $1", [id, by, name]);
  const published = await idea("Robot tutors for maths", { robot: "tutor-robots" });
  await version(published, mod, "Mohan Moderator");
  // as the app writes them: the Admin's click, then "Published v1" by System
  await pg.query("insert into cw_contribution_history (contribution_id, actor, actor_user_id, text) values ($1, 'Asha Admin', $2, 'Clicked Publish (attempt 1).')", [published, admin]);
  await pg.query("insert into cw_contribution_history (contribution_id, actor, text) values ($1, 'System', 'Published v1 to the public \"Education\" section, refreshed the page and verified it shows the approved content.')", [published]);
  await pg.query("update cw_contributions set status = 'published', published_at = now(), published_version = 1 where id = $1", [published]);
  const declined = await idea("A robot that marks homework");
  await pg.query("insert into cw_contribution_feedback (contribution_id, type, text, by_user_id, by_name) values ($1, 'decline', 'Not about robots in class.', $2, 'Mohan Moderator')", [declined, mod]);
  await pg.query("update cw_contributions set status = 'rejected' where id = $1", [declined]);
  const path = `Robots by Sector › ${SECTOR}`;
  const sameName = await idea("Lab  assistants", { kind: "Suggestion", path });   // a field of that name exists: approved
  const waiting = await idea("Reading buddies", { kind: "Suggestion", path });     // no such field: pending
  const refused = await idea("Robot janitors", { kind: "Suggestion", path });      // the idea was rejected: rejected
  await pg.query("insert into cw_contribution_feedback (contribution_id, type, text, by_user_id, by_name) values ($1, 'reject', 'Out of scope for schools.', $2, 'Asha Admin')", [refused, admin]);
  await pg.query("update cw_contributions set status = 'rejected' where id = $1", [refused]);
  const demo = await idea("A demo idea", { demo: true });
  await version(demo, mod, "Mohan Moderator");
  const form = Number((await one(pg, "insert into contributions (user_id, type, title, body, status) values ($1, 'improve', 'Robots in the school lab', 'Sent with the current form, long enough.', 'draft') returning id", [member])).id);
  await pg.query("insert into contribution_scopes (contribution_id, sector_id, robot_type_id) values ($1, $2, $3)", [form, sector, tutor]);
  await pg.query("update contributions set status = 'pending_review', submitted_at = now() - interval '3 days' where id = $1", [form]);
  await pg.query("insert into contribution_reviews (contribution_id, reviewer_id, action) values ($1, $2, 'verify')", [form, mod]);
  await pg.query("insert into contribution_reviews (contribution_id, reviewer_id, action) values ($1, $2, 'approve')", [form, admin]);
  await pg.query("update contributions set status = 'published', published_at = now() where id = $1", [form]);
  return { admin, mod, member, sector, tutor, lab, published, declined, sameName, waiting, refused, demo, form };
}

/** What earlier migrations store, row by row (the new columns left out): it must be identical before and after 030. */
async function existing(pg: any) {
  return {
    sectors: await rows(pg, "select id, slug, name, sort_order, is_active, is_demo from sectors order by id"),
    fields: await rows(pg, "select id, sector_id, slug, name, sort_order, is_active, updated_at, updated_by from sector_robot_types order by id"),
    ideas: await rows(pg, "select id, status, original, proposed, row_version, updated_at, published_at, moderator_id from cw_contributions order by id"),
    form: await rows(pg, "select id, status, title, submitted_at, published_at from contributions order by id"),
    counts: Object.fromEntries(await Promise.all(["users", "contribution_reviews", "contribution_scopes", "cw_contribution_versions", "cw_contribution_history", "cw_contribution_feedback"]
      .map(async (t) => [t, await count(pg, t)]))),
  };
}
/** Everything 030 adds, for the "run it twice" comparison. */
async function added(pg: any) {
  return {
    fields: await rows(pg, "select id, status, source, plugin_key, description, icon, created_by from sector_robot_types order by id"),
    sectors: await rows(pg, "select id, icon, color, archived_at from sectors order by id"),
    ideas: await rows(pg, "select id, field_id, reject_reason, edited_by, approved_by, approved_at, publish_requested_at, published_by from cw_contributions order by id"),
    suggestions: await rows(pg, "select * from field_suggestions order by id"),
    audit: await rows(pg, "select * from audit_log order by id"),
    schema: (await readSnapshot((sql: string) => pg.query(sql) as never)),
  };
}

describe("migration 030", () => {
  it("is missing before, applied after; 027 to 029 stay applied; it needs 029 first", async () => {
    const before = await migratedClone((id) => id <= "029");
    expect((await status(before.pg, "030")).status).toBe("missing");
    await applyFile(runner(before.pg), before.name, read(UP));
    expect((await status(before.pg, "030")).status).toBe("applied");
    for (const id of ["024", "025", "027", "028", "029"]) expect((await status(before.pg, id)).status, id).toBe("applied");
    await before.pg.close();
    const old = await migratedClone((id) => id <= "028");
    expect(await status(old.pg, "030")).toMatchObject({ status: "missing", blockedBy: ["029"] });
    await rejects(applyFile(runner(old.pg), old.name, read(UP)), /027 to 029 are missing/);
    await old.pg.close();
  });

  it("changes nothing that exists and backfills only the new columns and tables, from what the data already says", async () => {
    const { pg, name } = await migratedClone((id) => id <= "029");
    const ids = await seeded(pg);
    const was = await existing(pg);
    await applyFile(runner(pg), name, read(UP));
    expect(await existing(pg)).toEqual(was);
    // fields: status from is_active; a field made from an approved suggestion was suggested by a member
    expect(await rows(pg, "select id, status, source from sector_robot_types order by id")).toEqual([
      { id: ids.tutor, status: "active", source: "admin" }, { id: ids.lab, status: "hidden", source: "member" }]);
    // the three suggestions, each from its idea
    const sugg = await rows(pg, "select contribution_id, name, slug, status, reject_reason, field_id, suggested_by, suggested_by_name, decided_at is not null as decided from field_suggestions order by contribution_id");
    expect(sugg).toEqual([
      { contribution_id: ids.sameName, name: "Lab assistants", slug: "lab-assistants", status: "approved", reject_reason: null, field_id: ids.lab, suggested_by: ids.member, suggested_by_name: "Neha Sharma", decided: true },
      { contribution_id: ids.waiting, name: "Reading buddies", slug: "reading-buddies", status: "pending", reject_reason: null, field_id: null, suggested_by: ids.member, suggested_by_name: "Neha Sharma", decided: false },
      { contribution_id: ids.refused, name: "Robot janitors", slug: "robot-janitors", status: "rejected", reject_reason: "Out of scope for schools.", field_id: null, suggested_by: ids.member, suggested_by_name: "Neha Sharma", decided: true },
    ]);
    // the ideas' new columns
    const pub = await one(pg, "select field_id, approved_by, approved_at is not null as a, publish_requested_at is not null as r, published_by, edited_by, reject_reason from cw_contributions where id = $1", [ids.published]);
    expect(pub).toEqual({ field_id: ids.tutor, approved_by: ids.mod, a: true, r: true, published_by: ids.admin, edited_by: null, reject_reason: null });
    expect(await one(pg, "select field_id, approved_by, reject_reason from cw_contributions where id = $1", [ids.declined])).toEqual({ field_id: null, approved_by: null, reject_reason: "Not about robots in class." });
    // one audit row per past approval and publication, both kinds, no demo record
    const audit = await rows(pg, "select actor_id, actor_name, actor_role, action, target_type, target_id, meta->>'backfill' as b from audit_log order by target_type, action, target_id");
    expect(audit).toEqual([
      { actor_id: ids.mod, actor_name: "Mohan Moderator", actor_role: "moderator", action: "approve", target_type: "contribution", target_id: ids.form, b: "030" },
      { actor_id: ids.admin, actor_name: "Asha Admin", actor_role: "admin", action: "publish", target_type: "contribution", target_id: ids.form, b: "030" },
      { actor_id: ids.mod, actor_name: "Mohan Moderator", actor_role: "moderator", action: "approve", target_type: "idea", target_id: ids.published, b: "030" },
      { actor_id: ids.admin, actor_name: "Asha Admin", actor_role: "admin", action: "publish", target_type: "idea", target_id: ids.published, b: "030" },
    ]);
    await pg.close();
  });

  it("is safe to run twice: every row and the schema are exactly the same after the second run", async () => {
    const { pg, name } = await migratedClone((id) => id <= "029");
    await seeded(pg);
    await applyFile(runner(pg), name, read(UP));
    const first = await added(pg);
    await applyFile(runner(pg), name, read(UP));
    expect(await added(pg)).toEqual(first);
    await pg.close();
  });

  it("a second run changes no row, also for rows added after the first run (the backfill runs on the first application only)", async () => {
    const { pg, name } = await migratedClone((id) => id <= "029");
    const ids = await seeded(pg);
    await applyFile(runner(pg), name, read(UP));
    // a row that arrives later without 030's columns filled (as code from before 030 would write it)
    await pg.query("insert into cw_contribution_feedback (contribution_id, type, text, by_user_id, by_name) values ($1, 'decline', 'Off topic.', $2, 'Mohan Moderator')", [ids.waiting, ids.mod]);
    await pg.query("update cw_contributions set status = 'rejected' where id = $1", [ids.waiting]);
    const first = await added(pg);
    await applyFile(runner(pg), name, read(UP));
    expect(await added(pg)).toEqual(first);
    expect((await one(pg, "select reject_reason from cw_contributions where id = $1", [ids.waiting])).reject_reason).toBeNull();
    await pg.close();
  });

  it("an empty database gets one \"Migrated from legacy data\" row, once", async () => {
    const { pg, name } = await migratedClone((id) => id <= "029");
    await applyFile(runner(pg), name, read(UP));
    await applyFile(runner(pg), name, read(UP));
    expect(await rows(pg, "select actor_role, action, target_type, target_id, meta from audit_log")).toEqual([
      { actor_role: "system", action: "migrated", target_type: "system", target_id: null, meta: { backfill: "030", note: "Migrated from legacy data" } }]);
    await pg.close();
  });

  it("keeps status and is_active in step, guards plugin fields and used fields, and allows Approved only with its time", async () => {
    const { pg, name } = await migratedClone((id) => id <= "029");
    const ids = await seeded(pg);
    await applyFile(runner(pg), name, read(UP));
    const st = async (id: number) => one(pg, "select status, is_active from sector_robot_types where id = $1", [id]);
    await pg.query("update sector_robot_types set is_active = false where id = $1", [ids.tutor]); // old code
    expect(await st(ids.tutor)).toEqual({ status: "hidden", is_active: false });
    await pg.query("update sector_robot_types set status = 'archived' where id = $1", [ids.tutor]); // new code
    expect(await st(ids.tutor)).toEqual({ status: "archived", is_active: false });
    await pg.query("update sector_robot_types set is_active = false where id = $1", [ids.tutor]);
    expect(await st(ids.tutor)).toEqual({ status: "archived", is_active: false });
    await pg.query("update sector_robot_types set is_active = true where id = $1", [ids.tutor]);
    expect(await st(ids.tutor)).toEqual({ status: "active", is_active: true });
    const added1 = Number((await one(pg, "insert into sector_robot_types (sector_id, slug, name, is_active) values ($1, 'x-one', 'X one', false) returning id", [ids.sector])).id);
    const added2 = Number((await one(pg, "insert into sector_robot_types (sector_id, slug, name, status) values ($1, 'x-two', 'X two', 'archived') returning id", [ids.sector])).id);
    expect([await st(added1), await st(added2)]).toEqual([{ status: "hidden", is_active: false }, { status: "archived", is_active: false }]);
    await rejects(pg.query("update sector_robot_types set status = 'gone' where id = $1", [added1]), /status_ck/);
    // a field a plugin manages is never deleted; a field an idea uses cannot be deleted; an unused admin field can be
    await pg.query("insert into plugins (plugin_key, name) values ('classroom-kit', 'Classroom kit')");
    await rejects(pg.query("update sector_robot_types set source = 'plugin' where id = $1", [added2]), /source_ck/); // needs its plugin
    await pg.query("update sector_robot_types set source = 'plugin', plugin_key = 'classroom-kit' where id = $1", [added2]);
    await rejects(pg.query("delete from sector_robot_types where id = $1", [added2]), /managed by the plugin "classroom-kit" and is never deleted/);
    await rejects(pg.query("delete from sector_robot_types where id = $1", [ids.tutor]), /foreign key/);
    await pg.query("delete from sector_robot_types where id = $1", [added1]);
    // field_id follows the idea's current version
    await pg.query("update cw_contributions set proposed = jsonb_set(proposed, '{robotType}', '\"lab-assistants\"') where id = $1", [ids.declined]);
    expect((await one(pg, "select field_id from cw_contributions where id = $1", [ids.declined])).field_id).toBe(ids.lab);
    await pg.query("update cw_contributions set proposed = jsonb_set(proposed, '{robotType}', '\"not-sure\"') where id = $1", [ids.declined]);
    expect((await one(pg, "select field_id from cw_contributions where id = $1", [ids.declined])).field_id).toBeNull();
    // Approved: only with the time it was approved
    await rejects(pg.query("update cw_contributions set status = 'approved' where id = $1", [ids.waiting]), /approved_ck/);
    await pg.query("update cw_contributions set status = 'approved', approved_at = now(), approved_by = $2 where id = $1", [ids.waiting, ids.mod]);
    await rejects(pg.query("update cw_contributions set status = 'archived' where id = $1", [ids.waiting]), /status_ck/);
    // an archived sector is switched off; the audit log is append-only
    await rejects(pg.query("update sectors set archived_at = now() where id = $1", [ids.sector]), /archived_ck/);
    await pg.query("update sectors set archived_at = now(), is_active = false where id = $1", [ids.sector]);
    await rejects(pg.query("update audit_log set action = 'x'"), /append_only|never changed/);
    await rejects(pg.query("delete from audit_log"), /append_only|never changed/);
    await pg.close();
  });

  it("the rollback takes everything away right after the migration, puts back 028's check, and 030 applies again", async () => {
    const plain = await migratedClone((id) => id <= "029");
    const def028 = (await one(plain.pg, "select pg_get_constraintdef(oid) d from pg_constraint where conname = 'cw_contributions_status_ck'")).d;
    const snap029 = await readSnapshot((sql: string) => plain.pg.query(sql) as never);
    await plain.pg.close();
    const { pg, name } = await migratedClone((id) => id <= "029");
    const ids = await seeded(pg);
    const was = await existing(pg);
    await applyFile(runner(pg), name, read(UP));
    const firstRun = await added(pg);
    await applyFile(runner(pg), name, read(DOWN));
    expect((await status(pg, "030")).status).toBe("missing");
    for (const id of ["027", "028", "029"]) expect((await status(pg, id)).status, id).toBe("applied");
    expect((await one(pg, "select pg_get_constraintdef(oid) d from pg_constraint where conname = 'cw_contributions_status_ck'")).d).toBe(def028);
    const snap = await readSnapshot((sql: string) => pg.query(sql) as never);
    expect([...snap.columns].sort()).toEqual([...snap029.columns].sort());
    expect([...snap.triggers].sort()).toEqual([...snap029.triggers].sort());
    expect(await existing(pg)).toEqual(was);
    await applyFile(runner(pg), name, read(UP));
    expect((await status(pg, "030")).status).toBe("applied");
    expect(await count(pg, "field_suggestions")).toBe(3);
    expect(ids.form).toBeGreaterThan(0);
    // re-applied: the same backfill, row for row and id for id (a fixed order)
    const again = await added(pg);
    expect(again.suggestions).toEqual(firstRun.suggestions);
    expect(again.audit).toEqual(firstRun.audit);
    expect(again.fields).toEqual(firstRun.fields);
    expect(again.ideas).toEqual(firstRun.ideas);
    await pg.close();
  });

  it("the rollback refuses, and changes nothing, while something entered after 030 would be lost", async () => {
    const { pg, name } = await migratedClone((id) => id <= "029");
    const ids = await seeded(pg);
    await applyFile(runner(pg), name, read(UP));
    const refuse = async (setup: string, undo: string, re: RegExp, params: unknown[] = [], undoParams: unknown[] = params) => {
      await pg.query(setup, params);
      const before = await readSnapshot((sql: string) => pg.query(sql) as never);
      await rejects(applyFile(runner(pg), name, read(DOWN)), re);
      await pg.exec("ROLLBACK").catch(() => undefined);
      expect((await readSnapshot((sql: string) => pg.query(sql) as never)).columns).toEqual(before.columns);
      if (undo) await pg.query(undo, undoParams);
    };
    await refuse("update cw_contributions set status = 'approved', approved_at = now() where id = $1", "update cw_contributions set status = 'submitted' where id = $1", /1 idea\(s\) are in the Approved step/, [ids.waiting]);
    await refuse("insert into moderator_sectors (user_id, sector_id) values ($1, $2)", "delete from moderator_sectors where user_id = $1 and sector_id = $2", /1 moderator sector assignment/, [ids.mod, ids.sector]);
    await refuse("update field_suggestions set decided_by = $1 where contribution_id = $2", "update field_suggestions set decided_by = null where contribution_id = $1", /1 suggested field\(s\) were edited or decided/, [ids.admin, ids.sameName], [ids.sameName]);
    await refuse("update sector_robot_types set description = 'Helps in class' where id = $1", "update sector_robot_types set description = null where id = $1", /1 field\(s\) have a description/, [ids.tutor]);
    await refuse("update sectors set icon = '🎓' where id = $1", "update sectors set icon = null where id = $1", /1 sector\(s\) have an icon/, [ids.sector]);
    await refuse("insert into plugins (plugin_key, name) values ('kit', 'Kit')", "", /1 plugin\(s\) are registered/);
    await pg.close();
    // an audit row the application wrote: the log would be lost
    const other = await migratedClone((id) => id <= "029");
    await applyFile(runner(other.pg), other.name, read(UP));
    await other.pg.query("insert into audit_log (actor_role, action, target_type) values ('admin', 'field_add', 'field')");
    await rejects(applyFile(runner(other.pg), other.name, read(DOWN)), /1 audit row\(s\) were written after 030/);
    await other.pg.exec("ROLLBACK").catch(() => undefined);
    expect((await status(other.pg, "030")).status).toBe("applied");
    await other.pg.close();
  });
});
