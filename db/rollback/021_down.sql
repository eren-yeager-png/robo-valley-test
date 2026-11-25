-- Undo migration 021. Drops contributions.share_contact_with_moderators.
--   npm run db:migrate -- --expect-db <database name> --file db/rollback/021_down.sql --apply
-- It REFUSES (and changes nothing) while any contribution has the box ticked: dropping the column would erase what contributors
-- chose, with no way to get it back. If you really need to undo it, first save the ids of the ticked contributions somewhere safe
-- (SELECT id FROM contributions WHERE share_contact_with_moderators), untick them on purpose, then run this file again.
-- With no box ticked it only removes the column (nothing else depends on it). It touches ONLY this column: from_sector_page belongs
-- to migration 022 and is undone by 022_down.sql (roll back newest first: 022, then 021).
-- NOT run automatically and not in db/migrations, so the runner can never apply it by accident.
-- NOTE: roll this back only together with the code that uses it (the application treats a missing column as "not shared").
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
  -- the column is looked up on the very table the ALTER TABLE below changes (to_regclass: one table in one schema), never by name in
  -- any schema
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('contributions') AND attname = 'share_contact_with_moderators' AND attnum > 0 AND NOT attisdropped) THEN
    EXECUTE 'SELECT count(*) FROM contributions WHERE share_contact_with_moderators' INTO n; -- dynamic: safe if the column is already gone
    IF n > 0 THEN
      RAISE EXCEPTION 'Some contributors ticked "Let moderators contact me using my profile details" (% contribution(s)). Dropping the column would erase their choice. Export their ids first, untick them on purpose, then run this again. Nothing was changed.', n;
    END IF;
  END IF;
END $$;

ALTER TABLE contributions DROP COLUMN IF EXISTS share_contact_with_moderators;

COMMIT;
