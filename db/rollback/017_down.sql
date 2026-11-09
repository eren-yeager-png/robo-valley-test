-- Undo migration 017. Removes the contribution_reviews table, its trigger function, and narrows the status rule back to four values.
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --file db/rollback/017_down.sql --apply
-- It STOPS with a plain message and changes nothing if any contribution is rejected or unpublished (the old rule could not hold them) or
-- if any review decision exists (the audit trail is never deleted by an undo). Not in db/migrations, so the runner never applies it by accident.
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
  IF EXISTS (SELECT 1 FROM contributions WHERE status IN ('rejected','unpublished')) THEN
    RAISE EXCEPTION 'Some contributions are rejected or unpublished, so the old status rule cannot be restored. Nothing was changed.';
  END IF;
  IF to_regclass('contribution_reviews') IS NOT NULL AND EXISTS (SELECT 1 FROM contribution_reviews) THEN
    RAISE EXCEPTION 'Review decisions exist and the audit trail is never deleted by an undo. Nothing was changed.';
  END IF;
END $$;

DROP TABLE IF EXISTS contribution_reviews;
DROP FUNCTION IF EXISTS rv_review_append_only();
ALTER TABLE contributions DROP CONSTRAINT IF EXISTS contributions_status_ck;
ALTER TABLE contributions ADD CONSTRAINT contributions_status_ck CHECK (status IN ('draft','pending_review','changes_requested','published'));
COMMIT;
