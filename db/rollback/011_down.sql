-- Undo migration 011. Removes only the rate-limit counters (short-lived, no personal data).
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --file db/rollback/011_down.sql --apply
-- After this the application must be rolled back too (or it fails open: searches keep working without a limit).
BEGIN;

DO $$
DECLARE
  expected text := nullif(current_setting('rv.expected_db', true), '');
BEGIN
  IF expected IS NULL THEN
    RAISE EXCEPTION 'rv.expected_db is not set. Run this through the migration runner with --expect-db <database name>. Nothing was changed.';
  END IF;
  IF current_database() <> expected THEN
    RAISE EXCEPTION 'Wrong database: connected to "%" but expected "%". Nothing was changed.', current_database(), expected;
  END IF;
END $$;

DROP INDEX IF EXISTS api_rate_limits_window_idx;
DROP TABLE IF EXISTS api_rate_limits;
COMMIT;
