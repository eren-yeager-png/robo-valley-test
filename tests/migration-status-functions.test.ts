// The status check's function and trigger checks (migrations 012, 013, 015, 017, 018, 019), on in-process PostgreSQL (PGlite).
// Each test gets its own copy of a fully migrated database (tests/helpers/migratedClone.ts). No real database is involved.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyFile, pickFiles } from "../scripts/migrate.mjs";
import { MIGRATIONS, migrationStatus, readSnapshot, statusOf } from "../scripts/migration-status.mjs";
import { migratedClone } from "./helpers/migratedClone";

const runner = (pg: PGlite) => ({ setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]), exec: (sql: string) => pg.exec(sql) });
const fileOf = (id: string) => readFileSync(pickFiles().find((f) => f.split(/[\\/]/).pop()!.startsWith(id))!, "utf8");
const status = async (pg: PGlite, id: string) => statusOf(await migrationStatus((sql: string) => pg.query(sql) as any), id)!;
const reapply = async (pg: PGlite, name: string, id: string) => applyFile(runner(pg), name, fileOf(id));

describe("function and trigger checks: what the registry asks for", () => {
  it("names, for 012/013/015/017/018/019, exactly the functions (with argument types) and triggers (with the function they call) the SQL creates", () => {
    const of = (id: string, kind: string) => MIGRATIONS.find((m: any) => m.id === id)!.checks.filter((c: any) => c.kind === kind)
      .map((c: any) => (kind === "function" ? `${c.name}(${c.args.join(", ")})` : `${c.table}.${c.name} -> ${c.calls}`));
    expect(of("012", "function")).toEqual(["rv_contribution_needs_scope()", "rv_scope_keep_last()"]);
    expect(of("012", "trigger")).toEqual(["contributions.contributions_needs_scope -> rv_contribution_needs_scope()", "contribution_scopes.contribution_scopes_keep_last -> rv_scope_keep_last()"]);
    expect(of("013", "trigger")).toEqual(["contribution_photo_blobs.contribution_photo_blobs_match -> rv_photo_blob_matches()"]);
    expect(of("015", "trigger")).toEqual(["users.users_moderator_audit_upd -> rv_moderator_audit()", "users.users_moderator_audit_ins -> rv_moderator_audit()"]);
    expect(of("017", "trigger")).toEqual(["contribution_reviews.contribution_reviews_append_only -> rv_review_append_only()"]);
    expect(of("018", "function")).toEqual(["rv_title_key(text)", "rv_sync_title_keys(bigint)", "rv_title_keys_from_contribution()", "rv_title_keys_from_scope()"]);
    expect(of("019", "trigger")).toEqual(["contribution_replies.contribution_replies_append_only -> rv_portal_append_only()",
      "contribution_notes.contribution_notes_append_only -> rv_portal_append_only()", "contributions.contributions_review_round -> rv_review_round()"]);
    expect(of("027", "function")).toEqual(["cw_write_once()", "cw_append_only()"]);
    expect(of("027", "trigger")).toEqual(["cw_contributions.cw_contributions_write_once -> cw_write_once()", "cw_contribution_history.cw_contribution_history_append_only -> cw_append_only()",
      "cw_contribution_versions.cw_contribution_versions_append_only -> cw_append_only()", "cw_contribution_feedback.cw_contribution_feedback_append_only -> cw_append_only()",
      "cw_contribution_attachments.cw_contribution_attachments_append_only -> cw_append_only()"]);
    expect(of("030", "function")).toEqual(["rv_field_status_sync()", "rv_field_keep_plugin()", "cw_field_of()"]);
    expect(of("030", "trigger")).toEqual(["sector_robot_types.sector_robot_types_status_sync -> rv_field_status_sync()", "sector_robot_types.sector_robot_types_keep_plugin -> rv_field_keep_plugin()",
      "cw_contributions.cw_contributions_field -> cw_field_of()", "audit_log.audit_log_append_only -> cw_append_only()"]);
    for (const m of MIGRATIONS) if (!["012", "013", "015", "017", "018", "019", "027", "030"].includes(m.id)) expect(m.checks.some((c: any) => c.kind === "function" || c.kind === "trigger"), m.id).toBe(false);
    // and every name in the registry is really in the migration file it belongs to
    for (const m of MIGRATIONS) for (const c of m.checks as any[]) {
      if (c.kind === "function") expect(fileOf(m.id), `${m.id} ${c.name}`).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION ${c.name}\\(`));
      if (c.kind === "trigger") expect(fileOf(m.id), `${m.id} ${c.name}`).toMatch(new RegExp(`CREATE TRIGGER ${c.name} [^;]+ ON ${c.table}\\s+FOR EACH ROW[\\s\\S]*?EXECUTE FUNCTION ${c.calls.replace(/[()]/g, "\\$&")}`));
    }
  });
});

describe("function and trigger checks on a database", () => {
  it("all present: 012, 013, 015, 017, 018 and 019 are applied (the existing objects are found)", async () => {
    const { pg } = await migratedClone();
    for (const id of ["012", "013", "015", "017", "018", "019"]) expect((await status(pg, id)).status, id).toBe("applied");
    const snap = await readSnapshot((sql: string) => pg.query(sql) as any);
    expect(snap.functions.has("rv_title_key(text)")).toBe(true);
    expect(snap.triggers.has("contributions.contributions_review_round -> rv_review_round()")).toBe(true);
    await pg.close();
  });

  it("a missing function makes its migration partial (never applied); running the migration again puts it back", async () => {
    const { pg, name } = await migratedClone();
    await pg.exec("drop function rv_title_key(text)");
    const s = await status(pg, "018");
    expect(s.status).toBe("partial");
    expect(s.absent).toEqual(["function rv_title_key(text)"]);
    await reapply(pg, name, "018");
    expect((await status(pg, "018")).status).toBe("applied");
    await pg.close();
  });

  it("the wrong signature does not count, and neither does another overload when it is the only one left", async () => {
    const { pg } = await migratedClone();
    await pg.exec("create function rv_title_key(t text, n integer) returns text language sql immutable as $$ select t $$"); // an extra overload
    expect((await status(pg, "018")).status).toBe("applied"); // the right one is still there
    await pg.exec("drop function rv_title_key(text)"); // now only the (text, integer) overload exists
    expect((await status(pg, "018")).absent).toEqual(["function rv_title_key(text)"]);
    await pg.exec("create function rv_title_key(t varchar) returns text language sql immutable as $$ select t::text $$"); // close, but not text
    expect((await status(pg, "018")).absent).toEqual(["function rv_title_key(text)"]);
    expect((await status(pg, "018")).status).toBe("partial");
    await pg.close();
  });

  it("a missing trigger makes its migration partial; running the migration again puts it back", async () => {
    const { pg, name } = await migratedClone();
    await pg.exec("drop trigger contributions_review_round on contributions");
    const s = await status(pg, "019");
    expect(s.status).toBe("partial");
    expect(s.absent).toEqual(["trigger contributions_review_round on contributions calling rv_review_round()"]);
    await reapply(pg, name, "019");
    expect((await status(pg, "019")).status).toBe("applied");
    await pg.close();
  });

  it("a trigger of the right name calling the wrong function does not count (and running 012 again does not hide it)", async () => {
    const { pg, name } = await migratedClone();
    await pg.exec("drop trigger contributions_needs_scope on contributions");
    await pg.exec("create trigger contributions_needs_scope before insert on contributions for each row execute function rv_scope_keep_last()");
    expect((await status(pg, "012")).absent).toEqual(["trigger contributions_needs_scope on contributions calling rv_contribution_needs_scope()"]);
    await reapply(pg, name, "012"); // 012 only adds a trigger of that name when there is none: the wrong one stays, and so does the warning
    expect((await status(pg, "012")).status).toBe("partial");
    await pg.close();
  });

  it("a trigger of the right name on the wrong table does not count", async () => {
    const { pg } = await migratedClone();
    await pg.exec("drop trigger contribution_scopes_keep_last on contribution_scopes");
    await pg.exec("create trigger contribution_scopes_keep_last before delete on contributions for each row execute function rv_scope_keep_last()");
    expect((await status(pg, "012")).absent).toEqual(["trigger contribution_scopes_keep_last on contribution_scopes calling rv_scope_keep_last()"]);
    await pg.close();
  });

  it("a DISABLED trigger does not count: its migration is partial and the trigger is listed as disabled; running 012 again does not enable it (review probe P3)", async () => {
    const { pg, name } = await migratedClone();
    await pg.exec("alter table contributions disable trigger contributions_needs_scope");
    expect(((await pg.query("select tgenabled::text e from pg_trigger where tgname = 'contributions_needs_scope'")).rows[0] as any).e).toBe("D");
    const disabledNote = "trigger contributions_needs_scope on contributions calling rv_contribution_needs_scope() (exists but is disabled; running the migration again does not enable it)";
    const s = await status(pg, "012");
    expect(s.status).toBe("partial");
    expect(s.absent).toEqual([disabledNote]);
    const snap = await readSnapshot((sql: string) => pg.query(sql) as any);
    expect(snap.triggers.has("contributions.contributions_needs_scope -> rv_contribution_needs_scope()")).toBe(false);
    expect(snap.disabledTriggers.has("contributions.contributions_needs_scope -> rv_contribution_needs_scope()")).toBe(true);
    await reapply(pg, name, "012"); // 012 only creates a missing trigger; the disabled one stays disabled, and so does the warning
    expect((await status(pg, "012")).absent).toEqual([disabledNote]);
    await pg.exec("alter table contributions enable trigger contributions_needs_scope"); // a person turns it back on
    expect((await status(pg, "012")).status).toBe("applied");
    expect((await readSnapshot((sql: string) => pg.query(sql) as any)).disabledTriggers.size).toBe(0);
    await pg.close();
  });

  it("internal triggers (the ones PostgreSQL makes for foreign keys) are never counted", async () => {
    const { pg } = await migratedClone();
    const internal = (await pg.query("select t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and t.tgisinternal")).rows as any[];
    expect(internal.length).toBeGreaterThan(0); // the database does have them
    const snap = await readSnapshot((sql: string) => pg.query(sql) as any);
    const counted = [...snap.triggers].map((k: string) => k.split(" -> ")[0]!.split(".")[1]);
    for (const t of internal) expect(counted).not.toContain(t.tgname);
    expect(counted.sort()).toEqual(["audit_log_append_only", "contribution_notes_append_only", "contribution_photo_blobs_match", "contribution_replies_append_only", "contribution_reviews_append_only",
      "contribution_scopes_keep_last", "contribution_scopes_title_keys", "contributions_needs_scope", "contributions_review_round", "contributions_title_keys",
      "cw_contribution_attachments_append_only", "cw_contribution_feedback_append_only", "cw_contribution_history_append_only", "cw_contribution_versions_append_only",
      "cw_contributions_field", "cw_contributions_write_once", "sector_robot_types_keep_plugin", "sector_robot_types_status_sync", "users_moderator_audit_ins", "users_moderator_audit_upd"]);
    await pg.close();
  });

  it("schema-safe: a same-named function, trigger or trigger function in another schema never counts", async () => {
    const { pg } = await migratedClone();
    await pg.exec("create schema other");
    // a function of the right name and signature, but in another schema
    await pg.exec("drop function rv_title_key(text)");
    await pg.exec("create function other.rv_title_key(t text) returns text language sql immutable as $$ select t $$");
    expect((await status(pg, "018")).absent).toEqual(["function rv_title_key(text)"]);
    // a trigger on the right table calling a same-named function in another schema
    await pg.exec("create function other.rv_review_round() returns trigger language plpgsql as $$ begin return new; end $$");
    await pg.exec("drop trigger contributions_review_round on contributions");
    await pg.exec("create trigger contributions_review_round before insert on contributions for each row execute function other.rv_review_round()");
    expect((await status(pg, "019")).absent).toEqual(["trigger contributions_review_round on contributions calling rv_review_round()"]);
    // a same-named table in another schema with the right trigger calling the right function
    await pg.exec("drop trigger contributions_review_round on contributions");
    await pg.exec("create table other.contributions (id int, status text)");
    await pg.exec("create trigger contributions_review_round before insert on other.contributions for each row execute function public.rv_review_round()");
    expect((await status(pg, "019")).absent).toEqual(["trigger contributions_review_round on contributions calling rv_review_round()"]);
    await pg.close();
  });

  it("a migration rolled back with its own file is missing again (its functions and triggers go with it), not partial", async () => {
    const { pg, name } = await migratedClone();
    await applyFile(runner(pg), name, readFileSync(resolve("db/rollback/019_down.sql"), "utf8"));
    expect((await status(pg, "019")).status).toBe("missing");
    await pg.close();
  });
});
