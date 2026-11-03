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
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_datasets_category_check') THEN
    ALTER TABLE service_datasets ADD CONSTRAINT service_datasets_category_check
      CHECK (category IN ('atl-labs', 'robotics-labs', 'stem-labs', '3d-printing-facilities', 'robotics-training-centres', 'innovation-centres'));
  END IF;
END $$;

-- One active dataset per category (was: one active dataset in total). This is the ONLY statement here that removes anything:
-- the old single-active index, which would otherwise stop a second category from going live.
DROP INDEX IF EXISTS service_datasets_one_active;
CREATE UNIQUE INDEX IF NOT EXISTS service_datasets_one_active_per_category ON service_datasets (category) WHERE status = 'active';

COMMIT;
