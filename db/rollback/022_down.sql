-- Undo migration 022. Drops contributions.from_sector_page.
--   npm run db:migrate -- --expect-db <database name> --file db/rollback/022_down.sql --apply
-- Nothing else depends on the column. Without it, Edit shows the sector list for every contribution (nothing else is lost; the
-- contributions, their sectors and everything else stay as they are).
-- NOT run automatically and not in db/migrations, so the runner can never apply it by accident.
-- NOTE: the application treats a missing column as "not started from a sector page", so it keeps working after this.
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

ALTER TABLE contributions DROP COLUMN IF EXISTS from_sector_page;

COMMIT;
