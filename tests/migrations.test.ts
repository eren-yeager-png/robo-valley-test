// Runs the REAL migration files on an in-process PostgreSQL (PGlite). No real database is involved.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { applyFile, dbNameFromUrl, pickFiles } from "../scripts/migrate.mjs";

const read = (p: string) => readFileSync(resolve(p), "utf8");
const BASE = read("tests/helpers/baseSchema.sql");
const fresh = async () => { const pg = new PGlite(); await pg.exec(BASE); return pg; };
const runner = (pg: PGlite) => ({
  setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]),
  exec: (sql: string) => pg.exec(sql),
});
const dbOf = async (pg: PGlite) => String((await pg.query("select current_database() d")).rows[0]!["d" as never]);
const tables = async (pg: PGlite) =>
  (await pg.query("select table_name t from information_schema.tables where table_schema='public' order by 1")).rows.map((r: any) => r.t);

describe("migration files", () => {
  it("are 001, 002, 003 and 004, in order, and rollback is NOT in the migrations folder", () => {
    const names = pickFiles().map((f) => f.split(/[\\/]/).pop());
    expect(names).toEqual(["001_signup_additions.sql", "002_email_verification.sql", "003_otp_and_login_throttle.sql", "004_admin_support.sql"]);
    expect(pickFiles({ only: "003" })).toHaveLength(1);
    expect(names.join()).not.toMatch(/down/);
  });

  it("contain no hard-coded database name and no destructive statements (except the separate rollback file)", () => {
    for (const f of pickFiles()) {
      const sql = read(f);
      expect(sql, f).not.toMatch(/robovalley_auth'|<> 'robovalley/); // the old hard-coded guard is gone
      expect(sql, f).toMatch(/rv\.expected_db/);
      expect(sql, f).not.toMatch(/\b(DROP|TRUNCATE|DELETE FROM|UPDATE\s+\w+\s+SET)\b/i);
    }
    expect(read("db/rollback/003_down.sql")).toMatch(/DROP TABLE IF EXISTS/);
  });
});

describe("database-name guard (option B: fails closed)", () => {
  it("refuses when the target database was not confirmed (setting missing) and changes nothing", async () => {
    const pg = await fresh();
    const before = await tables(pg);
    for (const f of pickFiles()) {
      await expect(pg.exec(read(f)), f).rejects.toThrow(/rv\.expected_db is not set/);
      await pg.exec("ROLLBACK"); // a failed file leaves its transaction open; the runner rolls back (see applyFile)
    }
    expect(await tables(pg)).toEqual(before);
    await pg.close();
  });

  it("refuses an empty confirmation as well", async () => {
    const pg = await fresh();
    await pg.query("select set_config('rv.expected_db', '', false)");
    await expect(pg.exec(read("db/migrations/003_otp_and_login_throttle.sql"))).rejects.toThrow(/not set/);
    await pg.exec("ROLLBACK");
    await pg.close();
  });

  it("refuses when the confirmed name differs from the connected database, and changes nothing", async () => {
    const pg = await fresh();
    const before = await tables(pg);
    await expect(applyFile(runner(pg), "robovalley_auth_but_wrong", read("db/migrations/003_otp_and_login_throttle.sql")))
      .rejects.toThrow(/Wrong database: connected to ".+" but expected "robovalley_auth_but_wrong"/);
    expect(await tables(pg)).toEqual(before);
    await pg.close();
  });

  it("an aborted run leaves no half-applied state (all-or-nothing per file)", async () => {
    const pg = await fresh();
    await expect(applyFile(runner(pg), "nope", read("db/migrations/001_signup_additions.sql"))).rejects.toThrow();
    const cols = (await pg.query("select column_name c from information_schema.columns where table_name='users'")).rows.map((r: any) => r.c);
    expect(cols).not.toContain("age_category");
    await pg.close();
  });

  it("applies when the correct name is confirmed, and is safe to run twice", async () => {
    const pg = await fresh();
    const name = await dbOf(pg);
    for (let round = 0; round < 2; round++) for (const f of pickFiles()) await applyFile(runner(pg), name, read(f));
    expect(await tables(pg)).toEqual(expect.arrayContaining(["email_verifications", "guardian_details", "login_attempts", "otp_challenges", "users"]));
    await pg.close();
  });

  it("the rollback file is guarded too and removes only the three new tables", async () => {
    const pg = await fresh();
    const name = await dbOf(pg);
    for (const f of pickFiles()) await applyFile(runner(pg), name, read(f));
    await pg.exec("insert into users (full_name,email,role,password_hash) values ('A','a@e.co','ST','x')");
    await pg.query("select set_config('rv.expected_db', '', false)"); // a fresh session that never confirmed a name
    await expect(pg.exec(read("db/rollback/003_down.sql"))).rejects.toThrow(/not set/);
    await pg.exec("ROLLBACK");
    expect(await tables(pg)).toEqual(expect.arrayContaining(["login_attempts", "otp_challenges"])); // nothing was dropped
    await applyFile(runner(pg), name, read("db/rollback/003_down.sql"));
    expect(await tables(pg)).toEqual(["guardian_details", "users"]);
    expect(Number((await pg.query("select count(*)::int n from users")).rows[0]!["n" as never])).toBe(1); // data untouched
    await pg.close();
  });
});

describe("resulting schema", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await fresh();
    const name = await dbOf(pg);
    for (const f of pickFiles()) await applyFile(runner(pg), name, read(f));
  });

  const cols = async (t: string) =>
    (await pg.query(
      `select a.attname n, format_type(a.atttypid,a.atttypmod) ty, (not a.attnotnull) nullable, pg_get_expr(d.adbin,d.adrelid) dflt, a.attidentity ident
         from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace s on s.oid=c.relnamespace
         left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
        where s.nspname='public' and c.relname=$1 and a.attnum>0 and not a.attisdropped order by a.attnum`, [t])).rows as any[];

  // Transcribed from the read-only inspection of the live local database (users and guardian_details).
  const LIVE = {
    users: [
      ["id", "bigint", false, null, "a"], ["full_name", "character varying(150)", false, null, ""], ["email", "character varying(255)", false, null, ""],
      ["mobile", "character varying(20)", true, null, ""], ["role", "character varying(50)", false, null, ""], ["district", "character varying(100)", true, null, ""],
      ["preferred_language", "character varying(50)", true, null, ""], ["age", "smallint", true, null, ""], ["password_hash", "character varying(255)", false, null, ""],
      ["guardian_consent", "boolean", true, null, ""], ["terms_accepted_at", "timestamp with time zone", false, "now()", ""], ["created_at", "timestamp with time zone", false, "now()", ""],
      ["age_category", "character varying(10)", true, null, ""], ["profile", "jsonb", false, "'{}'::jsonb", ""], ["consents", "jsonb", false, "'{}'::jsonb", ""],
      ["mobile_verification", "character varying(10)", false, "'none'::character varying", ""], ["email_verification", "character varying(10)", false, "'none'::character varying", ""],
      ["must_change_password", "boolean", false, "false", ""], // added by migration 004
    ],
    guardian_details: [
      ["id", "bigint", false, null, "a"], ["user_id", "bigint", false, null, ""], ["guardian_name", "character varying(150)", false, null, ""],
      ["guardian_relationship", "character varying(50)", false, null, ""], ["guardian_mobile", "character varying(20)", false, null, ""],
      ["consent_status", "character varying(20)", false, "'pending'::character varying", ""], ["consent_recorded_at", "timestamp with time zone", true, null, ""],
      ["created_at", "timestamp with time zone", false, "now()", ""], ["mobile_verification", "character varying(10)", false, "'none'::character varying", ""],
      ["consent_mode", "character varying(10)", false, "'test'::character varying", ""], ["guardian_email", "character varying(254)", true, null, ""],
      ["email_verification", "character varying(10)", false, "'none'::character varying", ""],
    ],
  } as const;

  it.each(Object.keys(LIVE))("%s: columns, types, nullability, defaults and identity match the live database", async (t) => {
    const got = (await cols(t)).map((c) => [c.n, c.ty, c.nullable, c.dflt, c.ident]);
    expect(got).toEqual(LIVE[t as keyof typeof LIVE].map((r) => [...r]));
  });

  it("has the same constraint and index names as the live database (plus the three new tables')", async () => {
    const cons = (await pg.query("select conname c from pg_constraint where connamespace='public'::regnamespace order by 1")).rows.map((r: any) => r.c);
    for (const n of [
      "users_pkey", "users_email_key", "users_age_category_check", "users_email_verification_check", "users_mobile_verification_check",
      "guardian_details_pkey", "guardian_details_user_id_key", "guardian_details_user_id_fkey", "guardian_details_consent_status_check",
      "guardian_details_consent_mode_check", "guardian_details_email_verification_check", "guardian_details_mobile_verification_check",
    ]) expect(cons, n).toContain(n);
    const idx = (await pg.query("select indexname i, indexdef d from pg_indexes where schemaname='public'")).rows as any[];
    expect(idx.find((i) => i.i === "users_email_lower_key")?.d).toMatch(/UNIQUE.*lower/);
  });

  it("003 creates exactly three tables with the described columns, keys, checks and indexes", async () => {
    const t3 = ["email_verifications", "login_attempts", "otp_challenges"];
    expect((await tables(pg)).filter((t: string) => t3.includes(t))).toEqual(t3);

    expect((await cols("otp_challenges")).map((c) => `${c.n}:${c.ty}`)).toEqual([
      "purpose:character varying(10)", "email:character varying(254)", "code_hash:character(64)", "expires_at:timestamp with time zone",
      "attempts:smallint", "locked_until:timestamp with time zone", "last_sent_at:timestamp with time zone",
      "window_started_at:timestamp with time zone", "sends_in_window:smallint",
    ]);
    expect((await cols("email_verifications")).map((c) => `${c.n}:${c.ty}`)).toEqual([
      "token_hash:character(64)", "purpose:character varying(10)", "email:character varying(254)", "via:character varying(10)", "expires_at:timestamp with time zone",
    ]);
    expect((await cols("login_attempts")).map((c) => `${c.n}:${c.ty}`)).toEqual([
      "email:character varying(254)", "failures:smallint", "window_started_at:timestamp with time zone", "locked_until:timestamp with time zone",
    ]);

    const pk = async (t: string) => String((await pg.query("select pg_get_constraintdef(oid) d from pg_constraint where conrelid=$1::regclass and contype='p'", [t])).rows[0]!["d" as never]);
    expect(await pk("otp_challenges")).toBe("PRIMARY KEY (purpose, email)");
    expect(await pk("email_verifications")).toBe("PRIMARY KEY (token_hash)");
    expect(await pk("login_attempts")).toBe("PRIMARY KEY (email)");

    const idx = (await pg.query("select indexname i from pg_indexes where schemaname='public' and indexname like '%expires_idx' or indexname='login_attempts_window_idx'")).rows.map((r: any) => r.i).sort();
    expect(idx).toEqual(["email_verifications_expires_idx", "login_attempts_window_idx", "otp_challenges_expires_idx"]);

    // CHECK constraints reject bad values
    await expect(pg.exec("insert into otp_challenges (purpose,email,expires_at,last_sent_at,window_started_at) values ('login','a@e.co',now(),now(),now())")).rejects.toThrow();
    await expect(pg.exec("insert into email_verifications (token_hash,purpose,email,via,expires_at) values (repeat('a',64),'signup','a@e.co','sms',now())")).rejects.toThrow();
  });

  it("003 stores no plaintext: the only code/token columns are fixed-length hashes", async () => {
    const hashCols = (await pg.query(
      `select table_name t, column_name c, character_maximum_length l from information_schema.columns
        where table_schema='public' and table_name in ('otp_challenges','email_verifications') and (column_name like '%hash%')`)).rows as any[];
    expect(hashCols.map((r) => `${r.t}.${r.c}:${r.l}`).sort()).toEqual(["email_verifications.token_hash:64", "otp_challenges.code_hash:64"]);
    const names = (await pg.query("select column_name c from information_schema.columns where table_name in ('otp_challenges','email_verifications','login_attempts')")).rows.map((r: any) => r.c);
    expect(names.filter((c: string) => /^(code|otp|token|password|secret)$/.test(c))).toEqual([]);
  });
});

describe("runner helpers", () => {
  it("dbNameFromUrl reads only the database name", () => {
    expect(dbNameFromUrl("postgresql://u:p@host:5432/my_db?sslmode=require")).toBe("my_db");
    expect(dbNameFromUrl("postgresql://u:p@host/")).toBeNull();
    expect(dbNameFromUrl("not a url")).toBeNull();
  });
});
