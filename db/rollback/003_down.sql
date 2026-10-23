-- Rollback for migration 003. Deletes ONLY the three tables it created. These hold short-lived data
-- (one-time codes, verification tokens, login-failure counters): no accounts or profile data.
-- NOT run automatically and not in db/migrations, so the runner can never apply it by accident.
-- If you roll this back, also deploy the application version that keeps this state in memory.
--
--   npm run db:migrate -- --expect-db <database name> --file db/rollback/003_down.sql --apply
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

DROP TABLE IF EXISTS login_attempts;
DROP TABLE IF EXISTS email_verifications;
DROP TABLE IF EXISTS otp_challenges;

COMMIT;
