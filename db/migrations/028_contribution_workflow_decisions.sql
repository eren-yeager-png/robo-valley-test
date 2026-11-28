-- RoboValley migration 028: the contribution workflow's decided open points (spec section 15, decided by the owner on 27-11-2026).
-- Widens three checks of migration 027 so the new steps can be stored:
--   cw_contributions.status          + 'unpublished'  an Admin took a published card down (it can be published again)
--   cw_contributions published rule  an Unpublished idea was published before, so published_at is set
--   cw_contribution_feedback.type    + 'decline'      a Moderator's decline (Admins see who, why and when in the Rejected filter)
--                                    + 'reopen'       an Admin's reason for reopening a rejected idea
-- Every row that was valid stays valid; no row changes and nothing else is touched. Each check keeps its NAME and is re-created only
-- when it does not allow the new values yet, so the file is safe to run more than once and 027's own status check is unaffected.
-- Run AFTER 027. NOT applied automatically. Review, take a fresh backup, then run it yourself, e.g.:
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 028          (dry run)
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 028 --apply
-- Undo: db/rollback/028_down.sql (refuses while an idea is Unpublished or a decline or reopen reason exists).
-- Before this migration (027 applied) the application keeps working: a Moderator's decline is stored as a rejection, as before, and
-- Unpublish and Reopen answer "not set up yet" without changing anything.

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
  IF to_regclass('cw_contributions') IS NULL OR to_regclass('cw_contribution_feedback') IS NULL THEN
    RAISE EXCEPTION 'The contribution workflow tables are missing: apply migration 027 first. Nothing was changed.';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'cw_contributions'::regclass AND conname = 'cw_contributions_status_ck'
                 AND pg_get_constraintdef(oid) LIKE '%''unpublished''%') THEN
    ALTER TABLE cw_contributions DROP CONSTRAINT IF EXISTS cw_contributions_status_ck;
    ALTER TABLE cw_contributions ADD CONSTRAINT cw_contributions_status_ck CHECK (status IN ('submitted', 'under_review', 'draft', 'pending',
      'changes_requested', 'resubmitted', 'publishing', 'published', 'failed', 'rejected', 'unpublished'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'cw_contributions'::regclass AND conname = 'cw_contributions_published_ck'
                 AND pg_get_constraintdef(oid) LIKE '%''unpublished''%') THEN
    ALTER TABLE cw_contributions DROP CONSTRAINT IF EXISTS cw_contributions_published_ck;
    ALTER TABLE cw_contributions ADD CONSTRAINT cw_contributions_published_ck CHECK (status NOT IN ('published', 'unpublished') OR published_at IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'cw_contribution_feedback'::regclass AND conname = 'cw_contribution_feedback_ck'
                 AND pg_get_constraintdef(oid) LIKE '%''reopen''%') THEN
    ALTER TABLE cw_contribution_feedback DROP CONSTRAINT IF EXISTS cw_contribution_feedback_ck;
    ALTER TABLE cw_contribution_feedback ADD CONSTRAINT cw_contribution_feedback_ck CHECK (type IN ('changes', 'reject', 'decline', 'reopen')
      AND char_length(btrim(text)) BETWEEN 1 AND 2000);
  END IF;
END $$;

COMMIT;
