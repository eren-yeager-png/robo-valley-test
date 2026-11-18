-- Undo migration 025. Drops contribution_scopes.robot_type_id (and its link and index), contributions.from_robot_page and the
-- (id, sector_id) unique rule on sector_robot_types.
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --file db/rollback/025_down.sql --apply
-- REFUSES while any contribution has a robot chosen: dropping the column would erase the members' answers. To undo anyway, someone
-- must first decide those answers may go; a person with database access then clears them on purpose
-- (UPDATE contribution_scopes SET robot_type_id = NULL;) and runs this file again.
-- NOT run automatically and not in db/migrations, so the runner can never apply it by accident.
-- NOTE: the application treats the missing columns as "no robot", so it keeps working after this.
BEGIN;

DO $$
DECLARE
  expected text := nullif(current_setting('rv.expected_db', true), '');
  used boolean := false;
BEGIN
  IF expected IS NULL THEN
    RAISE EXCEPTION 'rv.expected_db is not set. Run this through the migration runner with --expect-db <database name>. Nothing was changed.';
  END IF;
  IF current_database() <> expected THEN
    RAISE EXCEPTION 'Wrong database: connected to "%" but expected "%". Nothing was changed.', current_database(), expected;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contribution_scopes' AND column_name = 'robot_type_id') THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM contribution_scopes WHERE robot_type_id IS NOT NULL)' INTO used; -- dynamic: safe if the column is already gone
    IF used THEN
      RAISE EXCEPTION 'Some contributions have a robot chosen. Dropping the column would erase those answers. Nothing was changed.';
    END IF;
  END IF;
END $$;

ALTER TABLE contribution_scopes DROP CONSTRAINT IF EXISTS contribution_scopes_robot_fk;
DROP INDEX IF EXISTS contribution_scopes_robot_idx;
ALTER TABLE contribution_scopes DROP COLUMN IF EXISTS robot_type_id;
ALTER TABLE contributions DROP COLUMN IF EXISTS from_robot_page;
DO $$
BEGIN
  IF to_regclass('sector_robot_types') IS NOT NULL THEN
    ALTER TABLE sector_robot_types DROP CONSTRAINT IF EXISTS sector_robot_types_id_sector_uq;
  END IF;
END $$;

COMMIT;
