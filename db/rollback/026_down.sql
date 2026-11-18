-- Undo migration 026. Drops sector_questions (each sector's questions).
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --file db/rollback/026_down.sql --apply
-- REFUSES while any question exists: dropping the table would erase what the administrators wrote. To undo anyway, an administrator
-- must first decide those questions may go; a person with database access then empties the table on purpose
-- (DELETE FROM sector_questions;) and runs this file again. If a later migration (P6, the answers) points at this table, that
-- migration must be rolled back first; until then this file refuses.
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
  IF to_regclass('sector_questions') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM sector_questions)' INTO used; -- dynamic: safe if the table is already gone
    IF used THEN
      RAISE EXCEPTION 'Questions have been written in Sector forms. Dropping the table would erase them. Nothing was changed.';
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS sector_questions;

COMMIT;
