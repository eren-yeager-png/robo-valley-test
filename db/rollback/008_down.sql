-- Rollback for migration 008. Removes ONLY the login_events table (the activity log behind the admin Reports).
-- No accounts, uploads or other data are touched. NOT run automatically and not in db/migrations, so the runner can
-- never apply it by accident.
--
--   npm run db:migrate -- --expect-db <database name> --file db/rollback/008_down.sql --apply
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

DROP TABLE IF EXISTS login_events;

COMMIT;
