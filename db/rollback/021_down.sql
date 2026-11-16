-- Undo migration 021. Drops contributions.share_contact_with_moderators.
--   npm run db:migrate -- --expect-db <database name> --file db/rollback/021_down.sql --apply
-- It REFUSES (and changes nothing) while any contribution has the box ticked: dropping the column would erase what contributors
-- chose, with no way to get it back. If you really need to undo it, first save the ids of the ticked contributions somewhere safe.
-- With no box ticked it only removes the column (nothing else depends on it).
-- NOT run automatically and not in db/migrations, so the runner can never apply it by accident.
-- NOTE: roll this back only together with the code that uses it (the application treats a missing column as "not shared").
BEGIN;

DO $$
DECLARE
  expected text := nullif(current_setting('rv.expected_db', true), '');
  ticked boolean := false;
BEGIN
  IF expected IS NULL THEN
    RAISE EXCEPTION 'rv.expected_db is not set. Run this through "npm run db:migrate -- --expect-db <database name>". Nothing was changed.';
  END IF;
  IF current_database() <> expected THEN
    RAISE EXCEPTION 'Wrong database: connected to "%" but expected "%". Nothing was changed.', current_database(), expected;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contributions' AND column_name = 'share_contact_with_moderators') THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM contributions WHERE share_contact_with_moderators)' INTO ticked; -- dynamic: safe if the column is already gone
    IF ticked THEN
      RAISE EXCEPTION 'Some contributors ticked "Let moderators contact me using my profile details". Dropping the column would erase their choice. Nothing was changed.';
    END IF;
  END IF;
END $$;

ALTER TABLE contributions DROP COLUMN IF EXISTS share_contact_with_moderators;

COMMIT;
