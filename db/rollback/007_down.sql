-- Undo migration 007. Restores "one active dataset in total" and removes the category column.
--   npm run db:migrate -- --expect-db <database name> --file db/rollback/007_down.sql --apply
-- It FAILS (and changes nothing) if more than one category is active at the moment, because the old single-active index
-- cannot hold them. Deactivate (or supersede) the extra categories first, then run this again.
BEGIN;

DO $$
DECLARE
  expected text := nullif(current_setting('rv.expected_db', true), '');
  found text;  -- the constraint of 007's name on service_datasets, as PostgreSQL writes it
  col text;    -- the type of service_datasets.category
  wanted text; -- 007's rule, as the same server writes it
BEGIN
  IF expected IS NULL THEN
    RAISE EXCEPTION 'rv.expected_db is not set. Run this through "npm run db:migrate -- --expect-db <database name>". Nothing was changed.';
  END IF;
  IF current_database() <> expected THEN
    RAISE EXCEPTION 'Wrong database: connected to "%" but expected "%". Nothing was changed.', current_database(), expected;
  END IF;
  -- Remove only what 007 made: a constraint named service_datasets_category_check on service_datasets counts as 007's only when it is
  -- EXACTLY 007's allow-list (compared as in 007: both written out by PostgreSQL, 007's rule on a throwaway copy of the category column
  -- in a temporary table inside an inner block that is always undone, spacing ignored). Any other one, or one on a table without that
  -- column, was not made by 007, so it is refused instead of removed (looked up on that table only, never by name alone).
  SELECT pg_get_constraintdef(c.oid) INTO found FROM pg_constraint c
   WHERE c.conrelid = to_regclass('service_datasets') AND c.conname = 'service_datasets_category_check';
  IF found IS NOT NULL THEN
    SELECT format_type(a.atttypid, a.atttypmod) INTO col FROM pg_attribute a
     WHERE a.attrelid = to_regclass('service_datasets') AND a.attname = 'category' AND NOT a.attisdropped;
    IF col IS NOT NULL THEN
      BEGIN
        EXECUTE format('CREATE TEMPORARY TABLE rv_expected_007 (category %s)', col);
        ALTER TABLE pg_temp.rv_expected_007 ADD CONSTRAINT service_datasets_category_check
          CHECK (category IN ('atl-labs', 'robotics-labs', 'stem-labs', '3d-printing-facilities', 'robotics-training-centres', 'innovation-centres'));
        SELECT pg_get_constraintdef(c.oid) INTO wanted FROM pg_constraint c WHERE c.conrelid = 'pg_temp.rv_expected_007'::regclass;
        RAISE SQLSTATE 'RV000'; -- undo this inner block (the temporary table); wanted keeps its value
      EXCEPTION WHEN SQLSTATE 'RV000' THEN
        NULL;
      END;
    END IF;
    IF regexp_replace(btrim(found), '[[:space:]]+', ' ', 'g') IS DISTINCT FROM regexp_replace(btrim(wanted), '[[:space:]]+', ' ', 'g') THEN
      RAISE EXCEPTION 'service_datasets has a constraint named service_datasets_category_check that is not the category allow-list 007 makes (it reads: %), so 007 did not make it and it is not removed. Look at it first. Nothing was changed.', found;
    END IF;
  END IF;
END $$;

DROP INDEX IF EXISTS service_datasets_one_active_per_category;
CREATE UNIQUE INDEX service_datasets_one_active ON service_datasets ((true)) WHERE status = 'active';
ALTER TABLE service_datasets DROP CONSTRAINT IF EXISTS service_datasets_category_check;
ALTER TABLE service_datasets DROP COLUMN IF EXISTS category;
COMMIT;
