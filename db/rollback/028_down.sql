-- Undo migration 028: puts back 027's narrower checks (no 'unpublished' status, no 'decline' or 'reopen' reasons).
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --file db/rollback/028_down.sql --apply
-- REFUSES while any idea is Unpublished or any decline or reopen reason exists: those rows would no longer be valid. Publish the
-- Unpublished ideas again (or decide with the owner what happens to them) first; reasons are append-only history and stay.
-- NOT run automatically and not in db/migrations, so the runner can never apply it by accident.
BEGIN;

DO $$
DECLARE
  expected text := nullif(current_setting('rv.expected_db', true), '');
  n bigint;
BEGIN
  IF expected IS NULL THEN
    RAISE EXCEPTION 'rv.expected_db is not set. Run this through the migration runner with --expect-db <database name>. Nothing was changed.';
  END IF;
  IF current_database() <> expected THEN
    RAISE EXCEPTION 'Wrong database: connected to "%" but expected "%". Nothing was changed.', current_database(), expected;
  END IF;
  IF to_regclass('cw_contributions') IS NULL THEN
    RETURN; -- 027 is not there either: nothing to undo
  END IF;
  EXECUTE 'SELECT count(*) FROM cw_contributions WHERE status = ''unpublished''' INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION '% idea(s) are Unpublished. 027''s check would not allow them. Nothing was changed.', n;
  END IF;
  EXECUTE 'SELECT count(*) FROM cw_contribution_feedback WHERE type IN (''decline'', ''reopen'')' INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION '% decline or reopen reason(s) exist (append-only history). 027''s check would not allow them. Nothing was changed.', n;
  END IF;
  ALTER TABLE cw_contributions DROP CONSTRAINT IF EXISTS cw_contributions_status_ck;
  ALTER TABLE cw_contributions ADD CONSTRAINT cw_contributions_status_ck CHECK (status IN ('submitted', 'under_review', 'draft', 'pending',
    'changes_requested', 'resubmitted', 'publishing', 'published', 'failed', 'rejected'));
  ALTER TABLE cw_contributions DROP CONSTRAINT IF EXISTS cw_contributions_published_ck;
  ALTER TABLE cw_contributions ADD CONSTRAINT cw_contributions_published_ck CHECK (status <> 'published' OR published_at IS NOT NULL);
  ALTER TABLE cw_contribution_feedback DROP CONSTRAINT IF EXISTS cw_contribution_feedback_ck;
  ALTER TABLE cw_contribution_feedback ADD CONSTRAINT cw_contribution_feedback_ck CHECK (type IN ('changes', 'reject') AND char_length(btrim(text)) BETWEEN 1 AND 2000);
END $$;

COMMIT;
