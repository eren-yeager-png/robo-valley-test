-- RoboValley migration 010: no duplicate schools from an upload
-- Additive only: new nullable/defaulted columns and one unique index. Nothing existing is dropped, renamed, truncated or
-- rewritten, and no existing row is changed. Safe to run more than once. Run AFTER 001-009 (needs service_datasets and service_dataset_rows).
-- NOT applied automatically. Review, then run it yourself, e.g.:
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 010          (dry run)
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 010 --apply
-- Undo: db/rollback/010_down.sql (drops the index and the new columns; see the note there).
--
-- HOW IT WORKS. The application collapses duplicate schools in memory before anything is written (src/lib/spreadsheet/dedupe.ts).
-- service_dataset_rows.dedupe_key holds each school's identity ("u:" + 11-digit UDISE code, or "n:" + normalised name, district,
-- state and PIN), and the unique index makes the database refuse a second row with the same key inside one dataset, so two
-- uploads or a retried request can never store the same school twice (the insert uses ON CONFLICT DO NOTHING).
-- Rows that already exist keep dedupe_key NULL. NULLs never conflict, so existing datasets (which may contain duplicates)
-- are untouched; a re-upload of the file stores a clean, de-duplicated dataset instead. dedupe_version stays NULL for those older datasets.

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

ALTER TABLE service_dataset_rows ADD COLUMN IF NOT EXISTS dedupe_key text;
CREATE UNIQUE INDEX IF NOT EXISTS service_dataset_rows_dedupe_key_uq ON service_dataset_rows (dataset_id, dedupe_key);

-- NULL dedupe_version = loaded before duplicate handling existed (row_count then counts every row of the file).
ALTER TABLE service_datasets ADD COLUMN IF NOT EXISTS dedupe_version smallint;
ALTER TABLE service_datasets ADD COLUMN IF NOT EXISTS rows_read integer;
ALTER TABLE service_datasets ADD COLUMN IF NOT EXISTS duplicate_row_count integer NOT NULL DEFAULT 0;
ALTER TABLE service_datasets ADD COLUMN IF NOT EXISTS filled_row_count integer NOT NULL DEFAULT 0;
ALTER TABLE service_datasets ADD COLUMN IF NOT EXISTS possible_duplicate_count integer NOT NULL DEFAULT 0;
-- The upload report: every skipped, merged and refused row with its row number (capped, with the exact counts kept above).
ALTER TABLE service_datasets ADD COLUMN IF NOT EXISTS report jsonb;
-- Demo data is labelled as such in the search box; real data is not.
ALTER TABLE service_datasets ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

COMMIT;
