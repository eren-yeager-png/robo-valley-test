-- Undo migration 020. Drops password_reset_tokens and the users.password_changed_at column.
--   npm run db:migrate -- --expect-db <database name> --file db/rollback/020_down.sql --apply
-- It REFUSES (and changes nothing) when any user has a password_changed_at: dropping the column would make every session that was
-- signed out by a reset valid again until it expires (up to 30 days), which could re-open an account that was just secured.
-- If you still need to undo it, wait until those sessions have expired, or rotate SESSION_SECRET first (that signs everyone out), then run this.
-- With no reset ever completed it only removes the table (short-lived tokens, nothing else depends on them) and the empty column.
-- NOT run automatically and not in db/migrations, so the runner can never apply it by accident.
-- NOTE: roll this back only together with the code that uses it. The session check falls back to the old query when the column is
-- missing, and password reset switches itself off when the table is missing, so the application keeps working either way.
BEGIN;

DO $$
DECLARE
  expected text := nullif(current_setting('rv.expected_db', true), '');
  changed boolean := false;
BEGIN
  IF expected IS NULL THEN
    RAISE EXCEPTION 'rv.expected_db is not set. Run this through "npm run db:migrate -- --expect-db <database name>". Nothing was changed.';
  END IF;
  IF current_database() <> expected THEN
    RAISE EXCEPTION 'Wrong database: connected to "%" but expected "%". Nothing was changed.', current_database(), expected;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password_changed_at') THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM users WHERE password_changed_at IS NOT NULL)' INTO changed; -- dynamic: safe if the column is already gone
    IF changed THEN
      RAISE EXCEPTION 'Some passwords were changed through a reset. Dropping password_changed_at would make the sessions that reset signed out valid again. Nothing was changed.';
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS password_reset_tokens;
ALTER TABLE users DROP COLUMN IF EXISTS password_changed_at;
COMMIT;
