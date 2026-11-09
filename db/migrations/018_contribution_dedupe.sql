-- RoboValley migration 018: duplicate safeguard and two more review actions
-- Additive except two rules that are WIDENED (no data is touched): the contribution status rule gains 'removed', and the review
-- action rule gains 'verify' and 'remove'. Safe to run more than once. Run AFTER 001-017. NOT applied automatically.
-- Review, take a fresh backup, then run it yourself, e.g.:
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 018          (dry run)
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 018 --apply
-- Undo: db/rollback/018_down.sql (refuses once anything is 'removed' or a verify/remove decision exists: the audit trail is never deleted).
--
-- WHAT IT ADDS
--   * status 'removed': an administrator removes a submission as a duplicate or as unsuitable. It is a soft delete: the row and its
--     append-only review history stay, nothing about it is public, and the owner sees it as removed.
--   * review actions 'verify' (a reviewer has checked it; status does not change) and 'remove' (needs a reason).
--   * contribution_title_keys: the database-level duplicate safeguard. For every LIVE contribution (pending review, changes requested,
--     published; never demo) there is one row per sector with the normalised title (rv_title_key: lower case, punctuation removed,
--     spaces collapsed). The primary key (sector_id, title_key) makes it impossible for two live contributions to have the same
--     normalised title in the same sector, whatever the application does: the second one fails with a unique violation (23505).
--     Triggers keep the rows in step when a contribution's status, title or sectors change. Drafts, rejected, removed and unpublished
--     contributions hold no key, so a title is free again once the earlier one is no longer live.
--   Existing live contributions are keyed when this runs; if two of them already collide, the second is simply not keyed (the
--   migration never fails on existing data) and the application's near-duplicate check still shows them side by side.

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

-- 1. widen the status rule (same transaction, no data touched)
ALTER TABLE contributions DROP CONSTRAINT IF EXISTS contributions_status_ck;
ALTER TABLE contributions ADD CONSTRAINT contributions_status_ck
  CHECK (status IN ('draft','pending_review','changes_requested','published','rejected','unpublished','removed'));

-- 2. widen the review action rules: 'verify' (note optional) and 'remove' (reason required)
ALTER TABLE contribution_reviews DROP CONSTRAINT IF EXISTS contribution_reviews_action_ck;
ALTER TABLE contribution_reviews ADD CONSTRAINT contribution_reviews_action_ck
  CHECK (action IN ('approve','request_changes','reject','unpublish','republish','verify','remove'));
ALTER TABLE contribution_reviews DROP CONSTRAINT IF EXISTS contribution_reviews_note_ck;
ALTER TABLE contribution_reviews ADD CONSTRAINT contribution_reviews_note_ck CHECK (
  (action IN ('request_changes','reject','unpublish','remove') AND char_length(btrim(coalesce(note, ''))) BETWEEN 3 AND 1000)
  OR (action IN ('approve','republish','verify') AND (note IS NULL OR char_length(note) <= 1000)));

-- 3. the duplicate safeguard
CREATE OR REPLACE FUNCTION rv_title_key(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT btrim(regexp_replace(regexp_replace(lower(coalesce(t, '')), '[[:punct:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g'))
$fn$;

CREATE TABLE IF NOT EXISTS contribution_title_keys (
  sector_id       integer NOT NULL REFERENCES sectors(id) ON DELETE CASCADE,
  title_key       text    NOT NULL,
  contribution_id bigint  NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  CONSTRAINT contribution_title_keys_pkey PRIMARY KEY (sector_id, title_key),
  CONSTRAINT contribution_title_keys_key_ck CHECK (char_length(title_key) BETWEEN 1 AND 150)
);
CREATE INDEX IF NOT EXISTS contribution_title_keys_item_idx ON contribution_title_keys (contribution_id);

CREATE OR REPLACE FUNCTION rv_sync_title_keys(cid bigint) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  DELETE FROM contribution_title_keys WHERE contribution_id = cid;
  INSERT INTO contribution_title_keys (sector_id, title_key, contribution_id)
    SELECT s.sector_id, rv_title_key(c.title), c.id
    FROM contributions c JOIN contribution_scopes s ON s.contribution_id = c.id
    WHERE c.id = cid AND c.status IN ('pending_review','changes_requested','published') AND NOT c.is_demo AND rv_title_key(c.title) <> '';
END $fn$;

CREATE OR REPLACE FUNCTION rv_title_keys_from_contribution() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM rv_sync_title_keys(NEW.id);
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION rv_title_keys_from_scope() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM rv_sync_title_keys(OLD.contribution_id);
    RETURN OLD;
  END IF;
  PERFORM rv_sync_title_keys(NEW.contribution_id);
  RETURN NEW;
END $fn$;

-- CREATE TRIGGER has no IF NOT EXISTS (and CREATE OR REPLACE TRIGGER needs PostgreSQL 14), so check the catalog first.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'contributions_title_keys' AND tgrelid = 'contributions'::regclass) THEN
    CREATE TRIGGER contributions_title_keys AFTER INSERT OR UPDATE OF status, title, is_demo ON contributions
      FOR EACH ROW EXECUTE FUNCTION rv_title_keys_from_contribution();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'contribution_scopes_title_keys' AND tgrelid = 'contribution_scopes'::regclass) THEN
    CREATE TRIGGER contribution_scopes_title_keys AFTER INSERT OR DELETE ON contribution_scopes
      FOR EACH ROW EXECUTE FUNCTION rv_title_keys_from_scope();
  END IF;
END $$;

-- 4. key the contributions that are already live (never fails on an existing collision: the later one is left unkeyed)
INSERT INTO contribution_title_keys (sector_id, title_key, contribution_id)
  SELECT s.sector_id, rv_title_key(c.title), c.id
  FROM contributions c JOIN contribution_scopes s ON s.contribution_id = c.id
  WHERE c.status IN ('pending_review','changes_requested','published') AND NOT c.is_demo AND rv_title_key(c.title) <> ''
  ORDER BY c.id
  ON CONFLICT DO NOTHING;

COMMIT;
