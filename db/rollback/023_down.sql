-- Undo migration 023. Drops contributions.type_chosen.
--   npm run db:migrate -- --expect-db <database name> --file db/rollback/023_down.sql --apply
-- It REFUSES (and changes nothing) while any contribution has type_chosen = true. The types themselves stay in contributions.type
-- either way, but that column cannot tell a type the member really chose (the 0.1.10+ form asks) from the default the older form
-- saved for everyone ('resource'): type_chosen is the only record of which is which, and dropping it would erase that for good
-- (every contribution would show "Type: not asked (older form)" again). To undo anyway, first save their ids somewhere safe
-- (SELECT id, type FROM contributions WHERE type_chosen), set the column to false on purpose, then run this file again.
-- With no true value it only removes the column (nothing else depends on it; the contributions and everything else stay as they are).
-- NOT run automatically and not in db/migrations, so the runner can never apply it by accident.
-- NOTE: the application treats a missing column as "not asked", so it keeps working after this.
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
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('contributions') AND attname = 'type_chosen' AND attnum > 0 AND NOT attisdropped) THEN
    EXECUTE 'SELECT count(*) FROM contributions WHERE type_chosen' INTO n; -- dynamic: safe if the column is already gone
    IF n > 0 THEN
      RAISE EXCEPTION '% contribution(s) have a type the member chose (contributions.type_chosen = true). Dropping the column would erase which types were chosen and which are the older form''s default. Export their ids first, set it to false on purpose, then run this again. Nothing was changed.', n;
    END IF;
  END IF;
END $$;

ALTER TABLE contributions DROP COLUMN IF EXISTS type_chosen;

COMMIT;
