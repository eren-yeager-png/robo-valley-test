-- RoboValley migration 022: where a contribution was started (contributions.from_sector_page)
-- Additive only: ONE new column with a default. Nothing is dropped, renamed or rewritten, and no existing row changes except that it
-- gets the default (false = not started from a sector page). Safe to run more than once.
-- Run AFTER 001-021 (needs contributions from 012). It does not depend on 019, 020 or 021. NOT applied automatically.
-- Review, take a fresh backup, then run it yourself, e.g.:
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 022          (dry run)
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 022 --apply
-- Undo: db/rollback/022_down.sql.
--
-- WHAT IT IS. true = the member opened the Contribute form from a sector page ("Contribute to this sector"), so the form showed that
-- sector as fixed text. Set once, when the contribution is created, and never changed afterwards. Edit (after "changes requested")
-- uses it to look the same way: the saved sector as fixed text for these, the sector list for the others. Only the contributor's
-- own Edit reads it; it is never shown publicly, counted or exported.
-- Contributions that already exist get false: their origin was never recorded, so Edit shows them with the list.
-- The application also works BEFORE this migration is applied: nothing is saved, and Edit shows the list for every contribution.

BEGIN;

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

ALTER TABLE contributions ADD COLUMN IF NOT EXISTS from_sector_page boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN contributions.from_sector_page IS
  'The form was opened from a sector page, so the sector was fixed. Set when the contribution is created; Edit shows the sector the same way.';

COMMIT;
