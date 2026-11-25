-- Undo migration 013. Removes the two photo tables (and with them the trigger), then the trigger function.
--   npm run db:migrate -- --expect-db <database name> --file db/rollback/013_down.sql --apply
-- It REFUSES (and changes nothing) while any contribution photo exists: members' photos are never deleted by an undo. The image bytes
-- live in this same database (contribution_photo_blobs, one row per photo; the application stores no photo file anywhere else), so
-- this check covers them too. To undo anyway, export the photos first (a backup), delete them on purpose, then run this file again.
-- Contributions, sectors and everything that existed before 013 are NOT touched. NOT run automatically and not in
-- db/migrations, so the runner can never apply it by accident.
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
  IF to_regclass('contribution_photos') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM contribution_photos' INTO n; -- dynamic: safe if the table is already gone
    IF n > 0 THEN
      RAISE EXCEPTION 'contribution_photos holds % photo(s) (with their image bytes in contribution_photo_blobs). Dropping the tables would delete them. Export them first, delete them on purpose, then run this again. Nothing was changed.', n;
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS contribution_photo_blobs;
DROP TABLE IF EXISTS contribution_photos;
DROP FUNCTION IF EXISTS rv_photo_blob_matches();
COMMIT;
