-- Undo migration 018. Removes the duplicate safeguard (contribution_title_keys, its triggers and functions) and narrows the two rules
-- back to what 017 allowed.
--   npm run db:migrate -- --expect-db <database name> --file db/rollback/018_down.sql --apply
-- It REFUSES (and changes nothing) when any contribution is 'removed' or any 'verify'/'remove' review decision exists: the audit trail
-- is never deleted by an undo. With nothing like that yet, it only drops the safeguard; no contribution or review row is touched.
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
  IF EXISTS (SELECT 1 FROM contributions WHERE status = 'removed') THEN
    RAISE EXCEPTION 'Some contributions are removed, so the old status rule cannot be restored. Nothing was changed.';
  END IF;
  IF EXISTS (SELECT 1 FROM contribution_reviews WHERE action IN ('verify','remove')) THEN
    RAISE EXCEPTION 'Verify or remove decisions exist and the audit trail is never deleted by an undo. Nothing was changed.';
  END IF;
END $$;

DROP TRIGGER IF EXISTS contributions_title_keys ON contributions;
DROP TRIGGER IF EXISTS contribution_scopes_title_keys ON contribution_scopes;
DROP TABLE IF EXISTS contribution_title_keys;
DROP FUNCTION IF EXISTS rv_title_keys_from_contribution();
DROP FUNCTION IF EXISTS rv_title_keys_from_scope();
DROP FUNCTION IF EXISTS rv_sync_title_keys(bigint);
DROP FUNCTION IF EXISTS rv_title_key(text);
ALTER TABLE contribution_reviews DROP CONSTRAINT IF EXISTS contribution_reviews_note_ck;
ALTER TABLE contribution_reviews ADD CONSTRAINT contribution_reviews_note_ck CHECK (
  (action IN ('request_changes','reject','unpublish') AND char_length(btrim(coalesce(note, ''))) BETWEEN 3 AND 1000)
  OR (action IN ('approve','republish') AND (note IS NULL OR char_length(note) <= 1000)));
ALTER TABLE contribution_reviews DROP CONSTRAINT IF EXISTS contribution_reviews_action_ck;
ALTER TABLE contribution_reviews ADD CONSTRAINT contribution_reviews_action_ck
  CHECK (action IN ('approve','request_changes','reject','unpublish','republish'));
ALTER TABLE contributions DROP CONSTRAINT IF EXISTS contributions_status_ck;
ALTER TABLE contributions ADD CONSTRAINT contributions_status_ck
  CHECK (status IN ('draft','pending_review','changes_requested','published','rejected','unpublished'));
COMMIT;
