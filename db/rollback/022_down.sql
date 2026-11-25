-- Undo migration 022. Drops contributions.from_sector_page.
--   npm run db:migrate -- --expect-db <database name> --file db/rollback/022_down.sql --apply
-- It REFUSES (and changes nothing) while any contribution has from_sector_page = true: dropping the column would erase which
-- contributions members started from a sector page, with no way to get it back (Edit would then show them with the sector list).
-- To undo anyway, first save their ids somewhere safe (SELECT id FROM contributions WHERE from_sector_page), set the column to
-- false on purpose, then run this file again. With no true value it only removes the column (nothing else depends on it).
-- It touches ONLY this column, which migration 022 owns; 021's share_contact_with_moderators stays (undone by 021_down.sql, after this).
-- NOT run automatically and not in db/migrations, so the runner can never apply it by accident.
-- NOTE: the application treats a missing column as "not started from a sector page", so it keeps working after this.
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
  -- the column is looked up on the very table the ALTER TABLE below changes (to_regclass: one table in one schema)
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('contributions') AND attname = 'from_sector_page' AND attnum > 0 AND NOT attisdropped) THEN
    EXECUTE 'SELECT count(*) FROM contributions WHERE from_sector_page' INTO n; -- dynamic: safe if the column is already gone
    IF n > 0 THEN
      RAISE EXCEPTION '% contribution(s) were started from a sector page (contributions.from_sector_page = true). Dropping the column would erase that. Export their ids first, set it to false on purpose, then run this again. Nothing was changed.', n;
    END IF;
  END IF;
END $$;

ALTER TABLE contributions DROP COLUMN IF EXISTS from_sector_page;

COMMIT;
