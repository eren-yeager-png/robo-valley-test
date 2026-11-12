-- Undo migration 019. Removes the moderation portal's records: the work-log view, replies, internal notes, views, structured categories,
-- contributions.review_round_at and their trigger functions.
--   node --env-file=<env file> scripts/migrate.mjs --expect-db <database name> --file db/rollback/019_down.sql --apply
-- It REFUSES (and changes nothing) while any reply, internal note or structured category exists: what moderators wrote and what members
-- chose is never deleted by an undo. "Who opened what" (contribution_views) and review_round_at are only bookkeeping and are dropped.
-- No contribution, review decision, photo or contact row is touched.
-- NOT run automatically and not in db/migrations, so the runner can never apply it by accident.
BEGIN;

DO $$
DECLARE
  expected text := nullif(current_setting('rv.expected_db', true), '');
BEGIN
  IF expected IS NULL THEN
    RAISE EXCEPTION 'rv.expected_db is not set. Run this through "npm run db:migrate -- --expect-db <database name>". Nothing was changed.';
  END IF;
  IF current_database() <> expected THEN
    RAISE EXCEPTION 'Wrong database: connected to "%" but expected "%". Nothing was changed.', current_database(), expected;
  END IF;
  IF to_regclass('contribution_replies') IS NOT NULL AND EXISTS (SELECT 1 FROM contribution_replies) THEN
    RAISE EXCEPTION 'Replies to contributors exist and are never deleted by an undo. Nothing was changed.';
  END IF;
  IF to_regclass('contribution_notes') IS NOT NULL AND EXISTS (SELECT 1 FROM contribution_notes) THEN
    RAISE EXCEPTION 'Internal notes exist and are never deleted by an undo. Nothing was changed.';
  END IF;
  IF to_regclass('contribution_categories') IS NOT NULL AND EXISTS (SELECT 1 FROM contribution_categories) THEN
    RAISE EXCEPTION 'Structured directory categories exist and are never deleted by an undo. Nothing was changed.';
  END IF;
END $$;

DROP VIEW IF EXISTS contribution_work_log;
DROP TRIGGER IF EXISTS contributions_review_round ON contributions;
DROP FUNCTION IF EXISTS rv_review_round();
ALTER TABLE contributions DROP COLUMN IF EXISTS review_round_at;
DROP TABLE IF EXISTS contribution_category_links;
DROP TABLE IF EXISTS contribution_categories;
DROP TABLE IF EXISTS contribution_views;
DROP TABLE IF EXISTS contribution_notes;
DROP TABLE IF EXISTS contribution_replies;
DROP FUNCTION IF EXISTS rv_portal_append_only();
COMMIT;
