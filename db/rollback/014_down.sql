-- Undo migration 014. Removes the contribution_contacts table.
--   npm run db:migrate -- --expect-db <database name> --file db/rollback/014_down.sql --apply
-- It REFUSES (and changes nothing) while any contact detail exists (name, email, phone and the share choice): private details that
-- contributors gave are never deleted by an undo, because there is no way to get them back except from a backup. To undo anyway,
-- export them first (a backup), delete them on purpose, then run this file again.
-- Contributions, photos, sectors and everything that existed before 014 are NOT touched.
-- NOT run automatically and not in db/migrations, so the runner can never apply it by accident.
BEGIN;

DO $$
DECLARE
  expected text := nullif(current_setting('rv.expected_db', true), '');
  n bigint;
BEGIN
  IF expected IS NULL THEN
    RAISE EXCEPTION 'rv.expected_db is not set. Run this through "npm run db:migrate -- --expect-db <database name>". Nothing was changed.';
  END IF;
  IF current_database() <> expected THEN
    RAISE EXCEPTION 'Wrong database: connected to "%" but expected "%". Nothing was changed.', current_database(), expected;
  END IF;
  IF to_regclass('contribution_contacts') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM contribution_contacts' INTO n; -- dynamic: safe if the table is already gone
    IF n > 0 THEN
      RAISE EXCEPTION 'contribution_contacts holds % private contact record(s). Dropping the table would delete them for good. Export them first, delete them on purpose, then run this again. Nothing was changed.', n;
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS contribution_contacts;
COMMIT;
