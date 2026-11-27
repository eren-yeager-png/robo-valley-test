-- RoboValley migration 029: a flag for the contribution workflow's DEMO ideas (scripts/seed-contribution-demo.mjs).
-- Adds cw_contributions.is_demo (default false) and a small index for it. Every existing idea stays a real idea (false); nothing else
-- changes. The flag does NOT hide anything: demo ideas show everywhere like real ones (so a local or preview copy of the site has
-- data on every page); it only lets the seed script remove exactly what it added (--reset). The demo seed is never run against a
-- live database (it refuses to). Safe to run more than once.
-- Run AFTER 028. NOT applied automatically. Review, take a fresh backup, then run it yourself, e.g.:
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 029          (dry run)
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 029 --apply
-- Undo: db/rollback/029_down.sql (refuses while any demo idea exists).

BEGIN;

DO $$
DECLARE
  expected text := nullif(current_setting('rv.expected_db', true), '');
BEGIN
  IF expected IS NULL THEN
    RAISE EXCEPTION 'rv.expected_db is not set. Run this through the migration runner with --expect-db <database name> so the target database is confirmed. Nothing was changed.';
  END IF;
  IF current_database() <> expected THEN
    RAISE EXCEPTION 'Wrong database: connected to "%" but expected "%". Nothing was changed.', current_database(), expected;
  END IF;
  IF to_regclass('cw_contributions') IS NULL THEN
    RAISE EXCEPTION 'The contribution workflow tables are missing: apply migration 027 first. Nothing was changed.';
  END IF;
END $$;

ALTER TABLE cw_contributions ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS cw_contributions_demo_idx ON cw_contributions (id) WHERE is_demo;

COMMIT;
