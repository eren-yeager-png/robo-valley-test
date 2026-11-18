-- RoboValley migration 023: the contribution type the member chose (contributions.type_chosen)
-- Additive only: ONE new column with a default. Nothing is dropped, renamed or rewritten, and no existing row changes except that it
-- gets the default (false = the form did not ask for a type). Safe to run more than once.
-- Run AFTER 001-022 (needs contributions from 012). It does not depend on 019-022. NOT applied automatically.
-- Review, take a fresh backup, then run it yourself, e.g.:
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 023          (dry run)
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 023 --apply
-- Undo: db/rollback/023_down.sql.
--
-- WHAT IT IS. P1 (plugin 0.1.10): the Contribute form asks "What would you like to share?" with three choices, saved in the existing
-- contributions.type column: Describe a problem = 'problem', Share an idea = 'improve', Share a video or resource = 'resource' (all
-- three were already allowed by 012's check). true = the member chose the type in that form. Until now the form had no type
-- question and saved every contribution as 'resource', so that stored value is a default, not a choice: contributions that
-- already exist get false and show "Type: not asked (older form)" in Moderation and in the CSV.
-- Edit keeps the chosen type and lets the member change it; a form older than 0.1.10 never changes a chosen type.
-- The application also works BEFORE this migration is applied: the chosen type is saved in contributions.type, but every
-- contribution still shows "not asked (older form)" until the column exists.

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
END $$;

ALTER TABLE contributions ADD COLUMN IF NOT EXISTS type_chosen boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN contributions.type_chosen IS
  'The member chose contributions.type in the Contribute form (0.1.10 or later). false: an older form, which did not ask; the stored type is a default.';

COMMIT;
