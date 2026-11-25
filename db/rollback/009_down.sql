-- Rollback for migration 009. Removes the two attachment tables and the four columns that 009 added to upload_audit_log.
-- WARNING: this DELETES every stored attachment file, and the attachment-related details (kind, size, hash, link) of the
-- upload history. Dataset uploads, the school directory (service_datasets, service_dataset_rows), accounts and the rest of
-- upload_audit_log (who, when, action, result, filename, detail) are NOT touched. NOT run automatically and not in
-- db/migrations, so the runner can never apply it by accident.
--
--   npm run db:migrate -- --expect-db <database name> --file db/rollback/009_down.sql --apply
BEGIN;

DO $$
DECLARE
  expected text := nullif(current_setting('rv.expected_db', true), '');
  found text;     -- the constraint of 009's name on upload_audit_log, as PostgreSQL writes it
  id_type text;   -- the type of upload_audit_log.attachment_id
  kind_type text; -- the type of upload_audit_log.kind
  wanted text;    -- 009's rule, as the same server writes it
BEGIN
  IF expected IS NULL THEN
    RAISE EXCEPTION 'rv.expected_db is not set. Run this through "npm run db:migrate -- --expect-db <database name>". Nothing was changed.';
  END IF;
  IF current_database() <> expected THEN
    RAISE EXCEPTION 'Wrong database: connected to "%" but expected "%". Nothing was changed.', current_database(), expected;
  END IF;
  -- Remove only what 009 made: a constraint named upload_audit_log_attachment_kind_ck on upload_audit_log counts as 009's only when it
  -- is EXACTLY 009's rule (compared as in 009: both written out by PostgreSQL, 009's rule on a throwaway copy of the two columns in a
  -- temporary table inside an inner block that is always undone, spacing ignored). Any other one, or one on a table without those
  -- columns, was not made by 009, so it is refused instead of removed (looked up on that table only, never by name alone).
  SELECT pg_get_constraintdef(c.oid) INTO found FROM pg_constraint c
   WHERE c.conrelid = to_regclass('upload_audit_log') AND c.conname = 'upload_audit_log_attachment_kind_ck';
  IF found IS NOT NULL THEN
    SELECT format_type(a.atttypid, a.atttypmod) INTO id_type FROM pg_attribute a
     WHERE a.attrelid = to_regclass('upload_audit_log') AND a.attname = 'attachment_id' AND NOT a.attisdropped;
    SELECT format_type(a.atttypid, a.atttypmod) INTO kind_type FROM pg_attribute a
     WHERE a.attrelid = to_regclass('upload_audit_log') AND a.attname = 'kind' AND NOT a.attisdropped;
    IF id_type IS NOT NULL AND kind_type IS NOT NULL THEN
      BEGIN
        EXECUTE format('CREATE TEMPORARY TABLE rv_expected_009 (attachment_id %s, kind %s)', id_type, kind_type);
        ALTER TABLE pg_temp.rv_expected_009
          ADD CONSTRAINT upload_audit_log_attachment_kind_ck CHECK (attachment_id IS NULL OR kind = 'attachment');
        SELECT pg_get_constraintdef(c.oid) INTO wanted FROM pg_constraint c WHERE c.conrelid = 'pg_temp.rv_expected_009'::regclass;
        RAISE SQLSTATE 'RV000'; -- undo this inner block (the temporary table); wanted keeps its value
      EXCEPTION WHEN SQLSTATE 'RV000' THEN
        NULL;
      END;
    END IF;
    IF regexp_replace(btrim(found), '[[:space:]]+', ' ', 'g') IS DISTINCT FROM regexp_replace(btrim(wanted), '[[:space:]]+', ' ', 'g') THEN
      RAISE EXCEPTION 'upload_audit_log has a constraint named upload_audit_log_attachment_kind_ck that is not the rule 009 makes (it reads: %), so 009 did not make it and it is not removed. Look at it first. Nothing was changed.', found;
    END IF;
  END IF;
END $$;

-- The columns first (they reference upload_attachments); their constraints and indexes go with them.
DROP INDEX IF EXISTS upload_audit_log_user_created_idx;
ALTER TABLE upload_audit_log DROP CONSTRAINT IF EXISTS upload_audit_log_attachment_kind_ck;
ALTER TABLE upload_audit_log
  DROP COLUMN IF EXISTS attachment_id,
  DROP COLUMN IF EXISTS file_sha256,
  DROP COLUMN IF EXISTS file_size,
  DROP COLUMN IF EXISTS kind;

DROP TABLE IF EXISTS upload_attachment_blobs;
DROP TABLE IF EXISTS upload_attachments;

COMMIT;
