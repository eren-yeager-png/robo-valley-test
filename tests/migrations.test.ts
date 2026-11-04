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
  it("are 001 to 010, in order, and rollback is NOT in the migrations folder", () => {
    const names = pickFiles().map((f) => f.split(/[\\/]/).pop());
    expect(names).toEqual(["001_signup_additions.sql", "002_email_verification.sql", "003_otp_and_login_throttle.sql", "004_admin_support.sql", "005_service_datasets.sql", "006_pincode_locations.sql", "007_service_categories.sql", "008_login_events.sql", "009_upload_attachments.sql", "010_dedupe_uploads.sql"]);
    const nums = names.map((n) => Number(n!.slice(0, 3)));
    expect(nums).toEqual([...nums].sort((a, b) => a - b)); // ordered ...
    expect(new Set(nums).size).toBe(nums.length); // ... and no number used twice
    expect(pickFiles({ only: "003" })).toHaveLength(1);
    expect(names.join()).not.toMatch(/down/);
  });

  it("contain no hard-coded database name and no destructive statements (except the separate rollback file)", () => {
    for (const f of pickFiles()) {
      const sql = read(f);
      expect(sql, f).not.toMatch(/robovalley_auth'|<> 'robovalley/); // the old hard-coded guard is gone
      expect(sql, f).toMatch(/rv\.expected_db/);
      // 007 has to retire the old "one active dataset in total" index so that each category can have its own live dataset.
      // That single statement is allowed; anything else destructive still fails this test.
      const checked = f.includes("007_") ? sql.replace("DROP INDEX IF EXISTS service_datasets_one_active;", "") : sql;
      expect(checked, f).not.toMatch(/\b(DROP|TRUNCATE|DELETE FROM|UPDATE\s+\w+\s+SET)\b/i);
    }
    for (const n of ["003", "008", "009"]) expect(read(`db/rollback/${n}_down.sql`), n).toMatch(/DROP TABLE IF EXISTS/);
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
    expect(await tables(pg)).toEqual(["guardian_details", "login_events", "pincode_locations", "service_dataset_rows", "service_datasets", "upload_attachment_blobs", "upload_attachments", "upload_audit_log", "users"]); // 003 tables gone, every other table untouched
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

// ---------------------------------------------------------------------------------------------------------------------
// 008 login_events and 009 upload attachments (schema only: nothing writes to these tables yet)
// ---------------------------------------------------------------------------------------------------------------------
const colNames = async (pg: PGlite, t: string) =>
  (await pg.query("select column_name c from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position", [t])).rows.map((r: any) => r.c);
const indexNames = async (pg: PGlite, t: string) =>
  (await pg.query("select indexname i from pg_indexes where schemaname='public' and tablename=$1", [t])).rows.map((r: any) => r.i);
const scalar = async (pg: PGlite, sql: string, params: unknown[] = []) => (await pg.query(sql, params)).rows[0]!["n" as never];
const migrated = async (pg: PGlite) => { const name = await dbOf(pg); for (const f of pickFiles()) await applyFile(runner(pg), name, read(f)); return name; };
const addUser = async (pg: PGlite, email = "a@e.co") =>
  Number(await scalar(pg, "insert into users (full_name,email,role,password_hash) values ('A',$1,'admin','x') returning id as n", [email]));
const SHA = "a".repeat(64);
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const attachment = (uploader: number, over: Record<string, unknown> = {}) => {
  const a = { key: "0123456789abcdef0123456789abcdef", type: "pdf", mime: "application/pdf", size: 1000, sha: SHA, name: "report.pdf", ...over };
  return pgInsert("insert into upload_attachments (storage_key, uploaded_by, original_filename, detected_type, content_type, size_bytes, file_sha256) values ($1,$2,$3,$4,$5,$6,$7) returning id as n",
    [a.key, uploader, a.name, a.type, a.mime, a.size, a.sha]);
};
const pgInsert = (sql: string, params: unknown[]) => ({ sql, params });
const put = async (pg: PGlite, q: { sql: string; params: unknown[] }) => Number(await scalar(pg, q.sql, q.params));

describe("008 login_events", () => {
  let pg: PGlite;
  beforeAll(async () => { pg = await fresh(); await migrated(pg); });

  it("has exactly the agreed columns, and none that could hold an IP, e-mail, password, code, token or free text", async () => {
    const cols = await colNames(pg, "login_events");
    expect(cols).toEqual(["id", "created_at", "event_type", "user_id", "reason", "purpose", "ua_family"]);
    expect(cols.filter((c) => /ip|mail|pass|otp|code|token|message|detail|agent$/i.test(c))).toEqual([]);
  });

  it("accepts the seven event types and nothing else", async () => {
    for (const t of ["login_success", "login_failed", "otp_sent", "otp_failed", "otp_verified", "signup", "logout"]) {
      await pg.query("insert into login_events (event_type) values ($1)", [t]);
    }
    for (const t of ["login", "LOGIN_SUCCESS", "password_reset", "", "login_success "]) {
      await expect(pg.query("insert into login_events (event_type) values ($1)", [t]), JSON.stringify(t)).rejects.toThrow();
    }
  });

  it("reason, purpose and ua_family accept only short fixed codes (no free text can be stored)", async () => {
    await pg.query("insert into login_events (event_type, reason, ua_family) values ('login_failed','bad_credentials','chrome')");
    await pg.query("insert into login_events (event_type, purpose) values ('otp_verified','guardian')");
    for (const bad of [
      "insert into login_events (event_type, reason) values ('login_failed','wrong password for asha@example.com')",
      "insert into login_events (event_type, reason) values ('login_failed','483920')",
      "insert into login_events (event_type, purpose) values ('otp_sent','other')",
      "insert into login_events (event_type, ua_family) values ('login_success','Mozilla/5.0 (Windows NT 10.0)')",
    ]) await expect(pg.query(bad), bad).rejects.toThrow();
  });

  it("a purpose belongs only to OTP events and a reason only to failures", async () => {
    await expect(pg.query("insert into login_events (event_type, purpose) values ('login_success','signup')")).rejects.toThrow();
    await expect(pg.query("insert into login_events (event_type, reason) values ('login_success','locked')")).rejects.toThrow();
    await expect(pg.query("insert into login_events (event_type, reason) values ('otp_sent','expired')")).rejects.toThrow();
    await pg.query("insert into login_events (event_type, reason, purpose) values ('otp_failed','wrong_code','signup')");
  });

  it("a NULL user is allowed (unknown account); an unknown user id is refused; deleting the account keeps the event with user_id NULL", async () => {
    await pg.query("insert into login_events (event_type, reason, user_id) values ('login_failed','bad_credentials', NULL)");
    await expect(pg.query("insert into login_events (event_type, user_id) values ('login_success', 987654321)")).rejects.toThrow(/foreign key|violates/i);
    const uid = await addUser(pg, "gone@e.co");
    const ev = Number(await scalar(pg, "insert into login_events (event_type, user_id) values ('logout', $1) returning id as n", [uid]));
    expect(Number(await scalar(pg, "select user_id n from login_events where id=$1", [ev]))).toBe(uid);
    await pg.query("delete from users where id=$1", [uid]);
    expect(await scalar(pg, "select user_id n from login_events where id=$1", [ev])).toBeNull(); // the event stays, unlinked
  });

  it("created_at defaults to now() and the report indexes exist", async () => {
    const r = await pg.query("insert into login_events (event_type) values ('signup') returning created_at");
    expect(Math.abs(Date.now() - new Date(String((r.rows[0] as any).created_at)).getTime())).toBeLessThan(60_000);
    expect(await indexNames(pg, "login_events")).toEqual(expect.arrayContaining(["login_events_created_idx", "login_events_type_created_idx"]));
  });
});

describe("009 upload attachments", () => {
  let pg: PGlite;
  let admin: number;
  beforeAll(async () => { pg = await fresh(); await migrated(pg); admin = await addUser(pg, "admin@e.co"); });

  it("has the agreed columns, with the file bytes in a separate table", async () => {
    expect(await colNames(pg, "upload_attachments")).toEqual(
      ["id", "storage_key", "uploaded_by", "uploaded_at", "original_filename", "detected_type", "content_type", "size_bytes", "file_sha256"]);
    expect(await colNames(pg, "upload_attachment_blobs")).toEqual(["attachment_id", "content"]);
    expect((await colNames(pg, "upload_audit_log")).slice(-4)).toEqual(["kind", "file_size", "file_sha256", "attachment_id"]);
    expect(await indexNames(pg, "upload_attachments")).toEqual(expect.arrayContaining(["upload_attachments_sha_idx", "upload_attachments_uploaded_idx"]));
    expect(await indexNames(pg, "upload_audit_log")).toEqual(expect.arrayContaining(["upload_audit_log_user_created_idx", "upload_audit_log_attachment_idx"]));
  });

  it("accepts the seven allowed types with their server-chosen content types", async () => {
    const ok: Array<[string, string]> = [["xlsx", XLSX_MIME], ["csv", "text/csv"], ["pdf", "application/pdf"],
      ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], ["png", "image/png"], ["jpg", "image/jpeg"], ["txt", "text/plain"]];
    let i = 0;
    for (const [type, mime] of ok) await put(pg, attachment(admin, { type, mime, key: (++i).toString(16).padStart(32, "0") }));
  });

  it("refuses types that can run code or are not on the allow-list, and content types that do not belong", async () => {
    let i = 100;
    for (const type of ["html", "svg", "exe", "js", "php", "sh", "bat", "xls", "xlsm", "gif", "PDF"]) {
      await expect(put(pg, attachment(admin, { type, key: (++i).toString(16).padStart(32, "0") })), type).rejects.toThrow();
    }
    for (const mime of ["text/html", "image/svg+xml", "application/javascript", "application/x-msdownload", "application/octet-stream"]) {
      await expect(put(pg, attachment(admin, { mime, key: (++i).toString(16).padStart(32, "0") })), mime).rejects.toThrow();
    }
  });

  it("enforces the 4 MB limit (4194304 bytes) and rejects empty files, in metadata and in the blob table", async () => {
    await put(pg, attachment(admin, { size: 4194304, key: "e".repeat(32) }));
    for (const size of [0, -1, 4194305, 5 * 1024 * 1024]) {
      await expect(put(pg, attachment(admin, { size, key: "f".repeat(32) })), String(size)).rejects.toThrow();
    }
    const id = await put(pg, attachment(admin, { key: "d".repeat(32) }));
    await pg.query("insert into upload_attachment_blobs (attachment_id, content) values ($1, $2)", [id, new Uint8Array(4194304)]);
    const id2 = await put(pg, attachment(admin, { key: "c".repeat(32) }));
    await expect(pg.query("insert into upload_attachment_blobs (attachment_id, content) values ($1, $2)", [id2, new Uint8Array(4194305)])).rejects.toThrow();
    await expect(pg.query("insert into upload_attachment_blobs (attachment_id, content) values ($1, $2)", [id2, new Uint8Array(0)])).rejects.toThrow();
  });

  it("SHA-256 must be 64 lower-case hex characters; the storage key must be 32 lower-case hex and unique", async () => {
    for (const sha of ["a".repeat(63), "A".repeat(64), "g".repeat(64), ""]) {
      await expect(put(pg, attachment(admin, { sha, key: "b".repeat(32) })), sha).rejects.toThrow();
    }
    for (const key of ["short", "G".repeat(32), "../../etc/passwd".padEnd(32, "x"), "A".repeat(32)]) {
      await expect(put(pg, attachment(admin, { key })), key).rejects.toThrow();
    }
    await put(pg, attachment(admin, { key: "9".repeat(32) }));
    await expect(put(pg, attachment(admin, { key: "9".repeat(32) }))).rejects.toThrow(/unique|duplicate/i);
    expect(Number(await scalar(pg, "select count(*)::int n from upload_attachments where file_sha256 = $1", [SHA]))).toBeGreaterThan(1); // same file twice is allowed: the app warns, the database only indexes
  });

  it("every attachment has a real uploader, and the file bytes are deleted with their metadata", async () => {
    await expect(put(pg, attachment(987654321, { key: "8".repeat(32) }))).rejects.toThrow(/foreign key|violates/i);
    const id = await put(pg, attachment(admin, { key: "7".repeat(32) }));
    await pg.query("insert into upload_attachment_blobs (attachment_id, content) values ($1, $2)", [id, new Uint8Array([1, 2, 3])]);
    await pg.query("delete from upload_attachments where id=$1", [id]);
    expect(Number(await scalar(pg, "select count(*)::int n from upload_attachment_blobs where attachment_id=$1", [id]))).toBe(0);
  });

  it("upload_audit_log: new columns validated; an attachment link needs kind = 'attachment'; deleting the file keeps the history row", async () => {
    const att = await put(pg, attachment(admin, { key: "6".repeat(32) }));
    const log = (kind: string, extra = "", p: unknown[] = []) =>
      pg.query(`insert into upload_audit_log (user_id, action, result, filename, kind ${extra ? "," + extra.split("|")[0] : ""}) values ($1,'upload','success','f.pdf',$2 ${extra ? "," + extra.split("|")[1] : ""})`, [admin, kind, ...p]);
    await log("attachment", "attachment_id|$3", [att]);
    await log("dataset");
    await expect(log("dataset", "attachment_id|$3", [att])).rejects.toThrow();            // link on a dataset row
    await expect(log("video")).rejects.toThrow();                                          // unknown kind
    await expect(log("attachment", "file_size|$3", [-1])).rejects.toThrow();
    await expect(log("attachment", "file_sha256|$3", ["XYZ"])).rejects.toThrow();
    await pg.query("delete from upload_attachments where id=$1", [att]);
    expect(Number(await scalar(pg, "select count(*)::int n from upload_audit_log where kind='attachment' and attachment_id is null"))).toBeGreaterThanOrEqual(1);
  });

  it("attachments are completely separate from the school directory: no link to the dataset tables, and storing one adds no dataset row", async () => {
    const links = (await pg.query(
      `select conrelid::regclass::text a, confrelid::regclass::text b from pg_constraint
        where contype='f' and (conrelid::regclass::text in ('upload_attachments','upload_attachment_blobs')
                            or confrelid::regclass::text in ('upload_attachments','upload_attachment_blobs'))`)).rows as any[];
    expect(links.filter((l) => /service_dataset/.test(`${l.a}${l.b}`))).toEqual([]);
    const before = [await scalar(pg, "select count(*)::int n from service_datasets"), await scalar(pg, "select count(*)::int n from service_dataset_rows")];
    const id = await put(pg, attachment(admin, { key: "5".repeat(32) }));
    await pg.query("insert into upload_attachment_blobs (attachment_id, content) values ($1, $2)", [id, new Uint8Array([9])]);
    expect([await scalar(pg, "select count(*)::int n from service_datasets"), await scalar(pg, "select count(*)::int n from service_dataset_rows")]).toEqual(before);
  });

  it("existing upload history rows survive the migration and become kind 'dataset'", async () => {
    const old = await fresh();
    const name = await dbOf(old);
    for (const f of pickFiles({ only: "00" }).filter((p) => !/00[89]_/.test(p))) await applyFile(runner(old), name, read(f)); // 001-006 only
    await old.exec("insert into upload_audit_log (action, result, filename) values ('upload','success','old.xlsx')");
    for (const f of pickFiles().filter((p) => /00[89]_/.test(p))) await applyFile(runner(old), name, read(f));
    const row = (await old.query("select kind, file_size, file_sha256, attachment_id from upload_audit_log")).rows[0] as any;
    expect(row).toEqual({ kind: "dataset", file_size: null, file_sha256: null, attachment_id: null });
    await old.close();
  });
});

describe("rollback 008 and 009", () => {
  const unconfirmed = (pg: PGlite) => pg.query("select set_config('rv.expected_db', '', false)");

  it("both rollback files are guarded (refuse without a confirmed database) and change nothing when refused", async () => {
    const pg = await fresh();
    await migrated(pg);
    const before = await tables(pg);
    for (const n of ["008", "009"]) {
      await unconfirmed(pg);
      await expect(pg.exec(read(`db/rollback/${n}_down.sql`)), n).rejects.toThrow(/not set/);
      await pg.exec("ROLLBACK");
    }
    expect(await tables(pg)).toEqual(before);
    await pg.close();
  });

  it("008_down removes only login_events", async () => {
    const pg = await fresh();
    const name = await migrated(pg);
    const before = (await tables(pg)).filter((t: string) => t !== "login_events");
    await applyFile(runner(pg), name, read("db/rollback/008_down.sql"));
    expect(await tables(pg)).toEqual(before);
    await pg.close();
  });

  it("009_down removes the two attachment tables and the four columns, and keeps every upload-history row", async () => {
    const pg = await fresh();
    const name = await migrated(pg);
    const admin = await addUser(pg);
    await pg.query("insert into upload_audit_log (user_id, action, result, filename) values ($1,'upload','success','keep.xlsx')", [admin]);
    await applyFile(runner(pg), name, read("db/rollback/009_down.sql"));
    const t = await tables(pg);
    expect(t).not.toContain("upload_attachments");
    expect(t).not.toContain("upload_attachment_blobs");
    expect(t).toEqual(expect.arrayContaining(["login_events", "service_datasets", "service_dataset_rows", "upload_audit_log", "users"]));
    expect((await colNames(pg, "upload_audit_log")).some((c: string) => ["kind", "file_size", "file_sha256", "attachment_id"].includes(c))).toBe(false);
    expect(Number(await scalar(pg, "select count(*)::int n from upload_audit_log where filename='keep.xlsx'"))).toBe(1);
    // and the migration can be applied again afterwards
    await applyFile(runner(pg), name, read("db/migrations/009_upload_attachments.sql"));
    expect(await tables(pg)).toContain("upload_attachments");
    await pg.close();
  });
});

describe("runner helpers", () => {
  it("dbNameFromUrl reads only the database name", () => {
    expect(dbNameFromUrl("postgresql://u:p@host:5432/my_db?sslmode=require")).toBe("my_db");
    expect(dbNameFromUrl("postgresql://u:p@host/")).toBeNull();
    expect(dbNameFromUrl("not a url")).toBeNull();
  });
});
