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
BEGIN
  IF expected IS NULL THEN
    RAISE EXCEPTION 'rv.expected_db is not set. Run this through "npm run db:migrate -- --expect-db <database name>". Nothing was changed.';
  END IF;
  IF current_database() <> expected THEN
    RAISE EXCEPTION 'Wrong database: connected to "%" but expected "%". Nothing was changed.', current_database(), expected;
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
