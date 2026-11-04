-- Undo migration 010. Removes the duplicate-handling columns and the unique index.
--   npm run db:migrate -- --expect-db <database name> --file db/rollback/010_down.sql --apply
-- WARNING: this deletes the upload reports and the is_demo flag, and the dedupe keys. The school rows themselves are not touched.
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

DROP INDEX IF EXISTS service_dataset_rows_dedupe_key_uq;
ALTER TABLE service_dataset_rows DROP COLUMN IF EXISTS dedupe_key;
ALTER TABLE service_datasets DROP COLUMN IF EXISTS is_demo;
ALTER TABLE service_datasets DROP COLUMN IF EXISTS report;
ALTER TABLE service_datasets DROP COLUMN IF EXISTS possible_duplicate_count;
ALTER TABLE service_datasets DROP COLUMN IF EXISTS filled_row_count;
ALTER TABLE service_datasets DROP COLUMN IF EXISTS duplicate_row_count;
ALTER TABLE service_datasets DROP COLUMN IF EXISTS rows_read;
ALTER TABLE service_datasets DROP COLUMN IF EXISTS dedupe_version;
COMMIT;
