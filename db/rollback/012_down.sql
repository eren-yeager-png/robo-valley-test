-- Undo migration 012. Removes the contribution tables (and with them their triggers), then the two trigger functions.
--   npm run db:migrate -- --expect-db <database name> --file db/rollback/012_down.sql --apply
-- WARNING: this deletes every contribution and sector saved since 012 ran. Nothing that existed before 012 is touched.
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

DROP TABLE IF EXISTS contribution_scopes;
DROP TABLE IF EXISTS contributions;
DROP TABLE IF EXISTS sectors;
DROP FUNCTION IF EXISTS rv_contribution_needs_scope();
DROP FUNCTION IF EXISTS rv_scope_keep_last();
COMMIT;
