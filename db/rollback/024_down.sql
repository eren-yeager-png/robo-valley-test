-- Undo migration 024. Drops sector_robot_types (the robot types of each sector).
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --file db/rollback/024_down.sql --apply
-- REFUSES while any robot type exists: dropping the table would erase the lists the administrators entered. To undo anyway, an
-- administrator must first decide those lists may go; a person with database access then empties the table on purpose
-- (DELETE FROM sector_robot_types;) and runs this file again. Nothing in 001-023 depends on the table.
-- If a later migration (P3) points at this table, that migration must be rolled back first; until then this file refuses.
-- NOT run automatically and not in db/migrations, so the runner can never apply it by accident.
-- NOTE: the application treats a missing table as "not set up yet", so it keeps working after this.
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
  IF to_regclass('sector_robot_types') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM sector_robot_types)' INTO used; -- dynamic: safe if the table is already gone
    IF used THEN
      RAISE EXCEPTION 'Robot types have been entered in Sector forms. Dropping the table would erase them. Nothing was changed.';
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS sector_robot_types;

COMMIT;
