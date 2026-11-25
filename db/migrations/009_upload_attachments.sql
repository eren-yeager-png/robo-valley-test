-- RoboValley migration 009: attachment storage and richer upload history
-- Additive only: two new tables, four new nullable/defaulted columns on upload_audit_log, and indexes. Nothing existing is
-- dropped, renamed, truncated or rewritten. Safe to run more than once. Run AFTER 001-008 (needs `users` and `upload_audit_log`).
-- NOT applied automatically. Review, then run it yourself, e.g.:
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 009          (dry run)
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 009 --apply
-- Undo: db/rollback/009_down.sql (removes the two tables and the four columns; see the warning there).
--
-- ATTACHMENTS ARE KEPT COMPLETELY APART FROM THE SCHOOL DIRECTORY. These tables have no link to service_datasets or
-- service_dataset_rows, so a stored file can never create a dataset row, become the active dataset or change the map.
-- The file bytes live in their own table so that listing queries never read them. Files are limited to 4 MB (4194304
-- bytes) because Vercel functions reject larger request bodies. Nothing is uploaded by this migration: the application
-- code that validates and stores files comes in a later change.

BEGIN;

DO $$
DECLARE
  expected text := nullif(current_setting('rv.expected_db', true), '');
BEGIN
  IF expected IS NULL THEN
    RAISE EXCEPTION 'rv.expected_db is not set. Run this through the migration runner with --expect-db <database name> so the target database is confirmed. Nothing was changed.';
  END IF;
  IF current_database() <> expected THEN
    RAISE EXCEPTION 'Wrong database: connected to "%" but expected "%". Nothing was changed.', current_database(), expected;
  END IF;
END $$;

-- One row per stored file (metadata only).
CREATE TABLE IF NOT EXISTS upload_attachments (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  storage_key       char(32)     NOT NULL UNIQUE CHECK (storage_key ~ '^[0-9a-f]{32}$'),  -- random, server-generated; the only name used in URLs
  uploaded_by       bigint       NOT NULL REFERENCES users(id),
  uploaded_at       timestamptz  NOT NULL DEFAULT now(),
  original_filename varchar(255) NOT NULL CHECK (length(original_filename) > 0),          -- display only; always escaped, never used as a path
  detected_type     varchar(8)   NOT NULL CHECK (detected_type IN ('xlsx', 'csv', 'pdf', 'docx', 'png', 'jpg', 'txt')),  -- decided from the file CONTENT
  content_type      varchar(100) NOT NULL CHECK (content_type IN (                           -- chosen by the server, never taken from the browser
                      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'application/pdf',
                      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/png', 'image/jpeg', 'text/plain')),
  size_bytes        integer      NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 4194304),
  file_sha256       char(64)     NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$')            -- for the "this file was uploaded before" warning
);
CREATE INDEX IF NOT EXISTS upload_attachments_sha_idx ON upload_attachments (file_sha256);
CREATE INDEX IF NOT EXISTS upload_attachments_uploaded_idx ON upload_attachments (uploaded_at DESC);

-- The file bytes, one row per attachment. Deleting the metadata row deletes the bytes with it.
CREATE TABLE IF NOT EXISTS upload_attachment_blobs (
  attachment_id bigint PRIMARY KEY REFERENCES upload_attachments(id) ON DELETE CASCADE,
  content       bytea  NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 4194304)
);

-- Upload history: one audit table for both kinds of upload. Existing rows become kind = 'dataset' automatically.
ALTER TABLE upload_audit_log
  ADD COLUMN IF NOT EXISTS kind          varchar(12) NOT NULL DEFAULT 'dataset' CHECK (kind IN ('dataset', 'attachment')),
  ADD COLUMN IF NOT EXISTS file_size     integer     CHECK (file_size IS NULL OR file_size >= 0),
  ADD COLUMN IF NOT EXISTS file_sha256   char(64)    CHECK (file_sha256 IS NULL OR file_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS attachment_id bigint      REFERENCES upload_attachments(id) ON DELETE SET NULL;

-- A link to a stored file only makes sense on an attachment row.
-- Looked up on upload_audit_log itself ('upload_audit_log'::regclass: one table in one schema, the one the ALTER TABLE reaches), so a
-- constraint of the same name elsewhere does not count. One of that name on upload_audit_log must be EXACTLY this rule: PostgreSQL
-- writes out (pg_get_constraintdef) the existing constraint and this file's rule, made on a throwaway copy of the two columns, and the
-- two texts must be identical apart from spacing. Both come from the same server, so the comparison does not depend on the PostgreSQL
-- version. Anything else (kind <> 'attachment', another column, NOT VALID) was not made by this file: it stops the migration. The copy
-- is a temporary table made inside an inner block that is always undone (as in 007: RAISE SQLSTATE 'RV000', caught only there, rolls
-- back just that block while the variable keeps the text it read). Nothing is left behind and nothing is removed.
DO $$
DECLARE
  found text;  -- the existing constraint of that name on upload_audit_log, as PostgreSQL writes it
  wanted text; -- this file's rule, as the same server writes it
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO found FROM pg_constraint c
   WHERE c.conrelid = 'upload_audit_log'::regclass AND c.conname = 'upload_audit_log_attachment_kind_ck';
  IF found IS NULL THEN
    ALTER TABLE upload_audit_log
      ADD CONSTRAINT upload_audit_log_attachment_kind_ck CHECK (attachment_id IS NULL OR kind = 'attachment');
  ELSE
    BEGIN
      EXECUTE format('CREATE TEMPORARY TABLE rv_expected_009 (attachment_id %s, kind %s)',
        (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
          WHERE a.attrelid = 'upload_audit_log'::regclass AND a.attname = 'attachment_id' AND NOT a.attisdropped),
        (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
          WHERE a.attrelid = 'upload_audit_log'::regclass AND a.attname = 'kind' AND NOT a.attisdropped));
      ALTER TABLE pg_temp.rv_expected_009
        ADD CONSTRAINT upload_audit_log_attachment_kind_ck CHECK (attachment_id IS NULL OR kind = 'attachment');
      SELECT pg_get_constraintdef(c.oid) INTO wanted FROM pg_constraint c WHERE c.conrelid = 'pg_temp.rv_expected_009'::regclass;
      RAISE SQLSTATE 'RV000'; -- undo this inner block (the temporary table); wanted keeps its value
    EXCEPTION WHEN SQLSTATE 'RV000' THEN
      NULL;
    END;
    IF regexp_replace(btrim(found), '[[:space:]]+', ' ', 'g') IS DISTINCT FROM regexp_replace(btrim(wanted), '[[:space:]]+', ' ', 'g') THEN
      RAISE EXCEPTION 'upload_audit_log already has a constraint named upload_audit_log_attachment_kind_ck that is not the attachment/kind rule (it reads: %). This migration did not make it; look at it before running 009 again. Nothing was changed.', found;
    END IF;
  END IF;
END $$;

-- The upload rate limit counts one admin's recent attempts; the history lists newest first.
CREATE INDEX IF NOT EXISTS upload_audit_log_user_created_idx ON upload_audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS upload_audit_log_attachment_idx ON upload_audit_log (attachment_id) WHERE attachment_id IS NOT NULL;

COMMIT;
