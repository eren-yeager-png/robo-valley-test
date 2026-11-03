-- Undo migration 007. Restores "one active dataset in total" and removes the category column.
--   npm run db:migrate -- --expect-db <database name> --file db/rollback/007_down.sql --apply
-- It FAILS (and changes nothing) if more than one category is active at the moment, because the old single-active index
-- cannot hold them. Deactivate (or supersede) the extra categories first, then run this again.
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

DROP INDEX IF EXISTS service_datasets_one_active_per_category;
CREATE UNIQUE INDEX service_datasets_one_active ON service_datasets ((true)) WHERE status = 'active';
ALTER TABLE service_datasets DROP CONSTRAINT IF EXISTS service_datasets_category_check;
ALTER TABLE service_datasets DROP COLUMN IF EXISTS category;
COMMIT;
