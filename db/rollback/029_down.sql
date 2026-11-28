-- Undo migration 029: removes cw_contributions.is_demo and its index.
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --file db/rollback/029_down.sql --apply
-- REFUSES while any demo idea exists: remove them first with the seed script (scripts/seed-contribution-demo.mjs --reset --apply),
-- otherwise they would become indistinguishable from real ideas.
-- NOT run automatically and not in db/migrations, so the runner can never apply it by accident.
BEGIN;

DO $$
DECLARE
  expected text := nullif(current_setting('rv.expected_db', true), '');
  n bigint := 0;
BEGIN
  IF expected IS NULL THEN
    RAISE EXCEPTION 'rv.expected_db is not set. Run this through the migration runner with --expect-db <database name>. Nothing was changed.';
  END IF;
  IF current_database() <> expected THEN
    RAISE EXCEPTION 'Wrong database: connected to "%" but expected "%". Nothing was changed.', current_database(), expected;
  END IF;
  IF to_regclass('cw_contributions') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cw_contributions' AND column_name = 'is_demo' AND table_schema = current_schema()) THEN
    EXECUTE 'SELECT count(*) FROM cw_contributions WHERE is_demo' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION '% demo idea(s) exist. Remove them first (scripts/seed-contribution-demo.mjs --reset --apply). Nothing was changed.', n;
    END IF;
  END IF;
END $$;

DROP INDEX IF EXISTS cw_contributions_demo_idx;
ALTER TABLE IF EXISTS cw_contributions DROP COLUMN IF EXISTS is_demo;

COMMIT;
