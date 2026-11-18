// Migrations 008 and 009 against the application: every allowed value in the database rules must match the code, and the
// status probes must cover every object the migration files create (so "applied" can never be reported just because
// one table exists). In-process database only.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { testDb } from "./helpers";
import { MIGRATIONS, migrationStatus } from "../scripts/migration-status.mjs";
import { CONTENT_TYPES, MAX_ATTACHMENT_BYTES } from "../src/lib/attachments";
import { EVENT_TYPES, REASONS } from "../src/lib/loginEvents";

const sql = (f: string) => readFileSync(resolve("db/migrations", f), "utf8");
const m008 = sql("008_login_events.sql");
const m009 = sql("009_upload_attachments.sql");
const q = async (s: string, p: unknown[] = []) => (await testDb().raw.query(s, p)).rows as any[];

/** The quoted values inside the first `IN ( ... )` that follows `marker`. */
function allowed(text: string, marker: RegExp): string[] {
  const m = marker.exec(text);
  if (!m) throw new Error("marker not found: " + marker);
  const rest = text.slice(m.index + m[0].length);
  const open = rest.indexOf("(");
  const close = rest.indexOf(")", open);
  return [...rest.slice(open + 1, close).matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}
const names = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => m[1]!);

describe("008 login_events matches the application", () => {
  it("event types in the database are exactly the ones the code records", () => {
    expect(allowed(m008, /event_type\s+varchar\(16\)\s+NOT NULL\s+CHECK\s*\(event_type\s+IN/).sort()).toEqual([...EVENT_TYPES].sort());
  });
  it("reason codes in the database are exactly the ones the code uses", () => {
    expect(allowed(m008, /reason\s+varchar\(16\)\s+CHECK\s*\(reason IS NULL OR reason\s+IN/).sort()).toEqual([...REASONS].sort());
  });
  it("purposes and browser families match", () => {
    expect(allowed(m008, /purpose\s+varchar\(10\)\s+CHECK\s*\(purpose IS NULL OR purpose\s+IN/).sort()).toEqual(["guardian", "signup"]);
    expect(allowed(m008, /ua_family\s+varchar\(10\)\s+CHECK\s*\(ua_family IS NULL OR ua_family\s+IN/).sort()).toEqual(["chrome", "edge", "firefox", "other", "safari"]);
  });
  it("the live table accepts every event type and reason the code can send, and nothing sensitive can be stored", async () => {
    for (const t of EVENT_TYPES) await q("insert into login_events (event_type) values ($1)", [t]);
    for (const r of REASONS) await q("insert into login_events (event_type, reason) values ('login_failed', $1)", [r]);
    const cols = (await q("select column_name c from information_schema.columns where table_name = 'login_events' order by 1")).map((r) => r.c);
    expect(cols).toEqual(["created_at", "event_type", "id", "purpose", "reason", "ua_family", "user_id"]);
  });
});

describe("009 attachments match the application", () => {
  it("file types and server-chosen content types are exactly the ones the code accepts", () => {
    expect(allowed(m009, /detected_type\s+varchar\(8\)\s+NOT NULL\s+CHECK\s*\(detected_type\s+IN/).sort()).toEqual(Object.keys(CONTENT_TYPES).sort());
    expect(allowed(m009, /content_type\s+varchar\(100\)\s+NOT NULL\s+CHECK\s*\(content_type\s+IN/).sort()).toEqual(Object.values(CONTENT_TYPES).sort());
  });
  it("the size limit is the same 4 MB in the database (metadata and bytes) and in the code", () => {
    expect(m009.match(/4194304/g)!.length).toBeGreaterThanOrEqual(3);
    expect(MAX_ATTACHMENT_BYTES).toBe(4194304);
  });
  it("the audit-log kinds and the columns the code writes exist", async () => {
    expect(allowed(m009, /kind\s+varchar\(12\)\s+NOT NULL DEFAULT 'dataset'\s+CHECK\s*\(kind\s+IN/).sort()).toEqual(["attachment", "dataset"]);
    const cols = (await q("select column_name c from information_schema.columns where table_name = 'upload_audit_log'")).map((r) => r.c);
    for (const c of ["kind", "file_size", "file_sha256", "attachment_id", "user_id", "action", "result", "filename", "detail", "dataset_id", "created_at"]) expect(cols, c).toContain(c);
    const att = (await q("select column_name c from information_schema.columns where table_name = 'upload_attachments'")).map((r) => r.c);
    for (const c of ["storage_key", "uploaded_by", "original_filename", "detected_type", "content_type", "size_bytes", "file_sha256"]) expect(att, c).toContain(c);
  });
});

describe("the status probes cover everything the migration files create", () => {
  for (const [id, text] of [["008", m008], ["009", m009]] as const) {
    it(`${id}: every table, index, constraint and added column is probed`, () => {
      const probes = JSON.stringify(MIGRATIONS.find((m: any) => m.id === id)!.checks);
      const created = [
        ...names(text, /CREATE TABLE IF NOT EXISTS (\w+)/g),
        ...names(text, /CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)/g),
        ...names(text, /ADD CONSTRAINT (\w+)/g),
        ...names(text, /ADD COLUMN IF NOT EXISTS (\w+)/g),
        ...names(text, /CONSTRAINT (\w+)\s+CHECK/g),
      ];
      expect(created.length).toBeGreaterThan(4);
      for (const n of new Set(created)) expect(probes, `${id} creates ${n} but the status check does not look for it`).toContain(`"${n}"`);
    });
  }

  it("a migration is never reported applied when only its main table exists", async () => {
    await q("alter table upload_attachments rename to upload_attachments_x");
    await q("create table upload_attachments (id bigint)"); // a table with the right name but nothing else
    try {
      const s = await migrationStatus((t: string) => testDb().raw.query(t) as any);
      expect(s.find((r: any) => r.id === "009").status).not.toBe("applied");
    } finally { await q("drop table upload_attachments"); await q("alter table upload_attachments_x rename to upload_attachments"); }
    const s2 = await migrationStatus((t: string) => testDb().raw.query(t) as any);
    expect(s2.find((r: any) => r.id === "009").status).toBe("applied");
  });
});
