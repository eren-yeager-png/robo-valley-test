-- Undo migration 016. Removes the unique-name index, and removes the seeded sector 'agriculture-dairy' ONLY if no contribution uses it.
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --file db/rollback/016_down.sql --apply
-- If any contribution is already filed under the sector, this STOPS with a plain message and changes nothing (the sector is not removed
-- and neither is the index): contributions are never deleted or detached by this undo. Not in db/migrations, so the runner never applies it by accident.
BEGIN;

DO $$
DECLARE
  expected text := nullif(current_setting('rv.expected_db', true), '');
BEGIN
  IF expected IS NULL THEN
    RAISE EXCEPTION 'rv.expected_db is not set. Run this through the migration runner with --expect-db <database name>. Nothing was changed.';
  END IF;
  IF current_database() <> expected THEN
    RAISE EXCEPTION 'Wrong database: connected to "%" but expected "%". Nothing was changed.', current_database(), expected;
  END IF;
  IF EXISTS (SELECT 1 FROM contribution_scopes cs JOIN sectors s ON s.id = cs.sector_id WHERE s.slug = 'agriculture-dairy') THEN
    RAISE EXCEPTION 'Contributions are already filed under Agriculture & Dairy, so it was not removed. Nothing was changed.';
  END IF;
END $$;

DELETE FROM sectors WHERE slug = 'agriculture-dairy';
DROP INDEX IF EXISTS sectors_name_lower_uq;
COMMIT;
