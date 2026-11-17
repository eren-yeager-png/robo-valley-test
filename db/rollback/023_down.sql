-- Undo migration 023. Drops contributions.type_chosen.
--   npm run db:migrate -- --expect-db <database name> --file db/rollback/023_down.sql --apply
-- Nothing else depends on the column. The chosen types themselves stay in contributions.type; without the column every contribution
-- shows "Type: not asked (older form)" again (nothing else is lost; the contributions and everything else stay as they are).
-- NOT run automatically and not in db/migrations, so the runner can never apply it by accident.
-- NOTE: the application treats a missing column as "not asked", so it keeps working after this.
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

ALTER TABLE contributions DROP COLUMN IF EXISTS type_chosen;

COMMIT;
