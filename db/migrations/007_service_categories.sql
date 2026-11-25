-- RoboValley migration 007: Find a Service categories (one live dataset PER category instead of one live dataset overall)
-- Touches ONLY service_datasets: adds a column, a CHECK, and swaps one index. No rows are deleted or rewritten; every existing
-- dataset reads as category 'atl-labs' (dataset 1, the ATL Labs Excel). Safe to run more than once.
-- Run AFTER 001-006. NOT applied automatically. Review, then run it yourself, e.g.:
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 007          (dry run)
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 007 --apply
-- Undo: db/rollback/007_down.sql.

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

-- Every dataset that exists today becomes the ATL Labs list (the column default fills the existing rows; no UPDATE is needed).
ALTER TABLE service_datasets ADD COLUMN IF NOT EXISTS category varchar(40) NOT NULL DEFAULT 'atl-labs';

-- A fixed allow-list, enforced by the database too, so a typo or a crafted request can never create a category.
-- The constraint is looked up on service_datasets itself ('service_datasets'::regclass names one table in one schema, the one the
-- ALTER TABLE reaches): a constraint of the same name on another table or in another schema does not count. One of that name on
-- service_datasets must be EXACTLY this allow-list: PostgreSQL writes out (pg_get_constraintdef) the existing constraint and this
-- file's rule, made on a throwaway copy of the category column, and the two texts must be identical apart from spacing. Both come
-- from the same server, so the comparison does not depend on the PostgreSQL version. Anything else (another list, an extra value,
-- another column, NOT VALID) was not made by this file: it stops the migration. The copy is a temporary table made inside an inner
-- block that is always undone: it ends with RAISE SQLSTATE 'RV000', which only that block catches, so PostgreSQL rolls back just the
-- block (the temporary table with it) while the variable keeps the text it read. Nothing is left behind and nothing is removed.
DO $$
DECLARE
  found text;  -- the existing constraint of that name on service_datasets, as PostgreSQL writes it
  wanted text; -- this file's rule, as the same server writes it
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO found FROM pg_constraint c
   WHERE c.conrelid = 'service_datasets'::regclass AND c.conname = 'service_datasets_category_check';
  IF found IS NULL THEN
    ALTER TABLE service_datasets ADD CONSTRAINT service_datasets_category_check
      CHECK (category IN ('atl-labs', 'robotics-labs', 'stem-labs', '3d-printing-facilities', 'robotics-training-centres', 'innovation-centres'));
  ELSE
    BEGIN
      EXECUTE format('CREATE TEMPORARY TABLE rv_expected_007 (category %s)',
        (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
          WHERE a.attrelid = 'service_datasets'::regclass AND a.attname = 'category' AND NOT a.attisdropped));
      ALTER TABLE pg_temp.rv_expected_007 ADD CONSTRAINT service_datasets_category_check
        CHECK (category IN ('atl-labs', 'robotics-labs', 'stem-labs', '3d-printing-facilities', 'robotics-training-centres', 'innovation-centres'));
      SELECT pg_get_constraintdef(c.oid) INTO wanted FROM pg_constraint c WHERE c.conrelid = 'pg_temp.rv_expected_007'::regclass;
      RAISE SQLSTATE 'RV000'; -- undo this inner block (the temporary table); wanted keeps its value
    EXCEPTION WHEN SQLSTATE 'RV000' THEN
      NULL;
    END;
    IF regexp_replace(btrim(found), '[[:space:]]+', ' ', 'g') IS DISTINCT FROM regexp_replace(btrim(wanted), '[[:space:]]+', ' ', 'g') THEN
      RAISE EXCEPTION 'service_datasets already has a constraint named service_datasets_category_check that is not the category allow-list (it reads: %). This migration did not make it; look at it before running 007 again. Nothing was changed.', found;
    END IF;
  END IF;
END $$;

-- One active dataset per category (was: one active dataset in total). This is the ONLY statement here that removes anything:
-- the old single-active index, which would otherwise stop a second category from going live.
DROP INDEX IF EXISTS service_datasets_one_active;
CREATE UNIQUE INDEX IF NOT EXISTS service_datasets_one_active_per_category ON service_datasets (category) WHERE status = 'active';

COMMIT;
