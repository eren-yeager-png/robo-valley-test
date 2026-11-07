-- Undo migration 013. Removes the two photo tables (and with them the trigger), then the trigger function.
--   npm run db:migrate -- --expect-db <database name> --file db/rollback/013_down.sql --apply
-- WARNING: this DELETES every contribution photo (the metadata, the alt text and the image bytes) saved since 013 ran.
-- Contributions, sectors and everything that existed before 013 are NOT touched. NOT run automatically and not in
-- db/migrations, so the runner can never apply it by accident.
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

DROP TABLE IF EXISTS contribution_photo_blobs;
DROP TABLE IF EXISTS contribution_photos;
DROP FUNCTION IF EXISTS rv_photo_blob_matches();
COMMIT;
