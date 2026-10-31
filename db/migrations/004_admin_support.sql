-- RoboValley migration 004: admin support
-- Additive and backward-compatible: only ADD ... IF NOT EXISTS. Nothing is dropped, renamed, truncated or rewritten.
-- Safe to run more than once. Run AFTER 001-003.
-- NOT applied automatically. Review, then run it yourself, e.g.:
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 004          (dry run)
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 004 --apply
--
-- users.role already exists (varchar(50) NOT NULL, holds the role codes ST, PA, TC ... ), so it is NOT touched here.
-- Administrators use the value 'admin'. Self-signup cannot create one: the signup API only accepts the 12 role codes.

BEGIN;

-- Safety guard (fails closed): this script runs only if the operator has explicitly named the database
-- they intend to change (session setting rv.expected_db) AND it matches the database we are connected to.
-- No database name is hard-coded here. Set it by running through the migration runner with --expect-db <name>.
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

-- Set to true when an administrator is created by the seed script; cleared when they choose a new password.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

COMMIT;
