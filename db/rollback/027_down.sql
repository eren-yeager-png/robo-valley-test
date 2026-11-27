-- Undo migration 027. Drops the six cw_... tables of the Contribution Publishing Workflow, and their two functions.
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --file db/rollback/027_down.sql --apply
-- REFUSES while any contribution exists in cw_contributions: dropping the tables would erase members' ideas, their history and every
-- published card. To undo anyway, the owner must first decide those may go (and take a backup); a person with database access then
-- removes them on purpose and runs this file again.
-- NOT run automatically and not in db/migrations, so the runner can never apply it by accident.
-- NOTE: the application treats missing tables as "not set up yet", so it keeps working after this (the new pages say so).
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
  IF to_regclass('cw_contributions') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM cw_contributions)' INTO used; -- dynamic: safe if the table is already gone
    IF used THEN
      RAISE EXCEPTION 'Contributions exist in the new workflow tables. Dropping them would erase members'' ideas. Nothing was changed.';
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS cw_public_contributions;
DROP TABLE IF EXISTS cw_contribution_attachments;
DROP TABLE IF EXISTS cw_contribution_history;
DROP TABLE IF EXISTS cw_contribution_feedback;
DROP TABLE IF EXISTS cw_contribution_versions;
DROP TABLE IF EXISTS cw_contributions;
DROP FUNCTION IF EXISTS cw_append_only();
DROP FUNCTION IF EXISTS cw_write_once();

COMMIT;
