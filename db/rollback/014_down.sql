-- Undo migration 014. Removes the contribution_contacts table.
--   npm run db:migrate -- --expect-db <database name> --file db/rollback/014_down.sql --apply
-- WARNING: this DELETES every contact detail (name, email, phone and the share choice) saved since 014 ran. There is no way
-- to get it back except from a backup. Contributions, photos, sectors and everything that existed before 014 are NOT touched.
-- NOT run automatically and not in db/migrations, so the runner can never apply it by accident.
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

DROP TABLE IF EXISTS contribution_contacts;
COMMIT;
