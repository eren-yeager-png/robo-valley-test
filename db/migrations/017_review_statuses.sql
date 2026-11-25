-- RoboValley migration 017: two more statuses (rejected, unpublished) and the moderators' audit trail (contribution_reviews)
-- Part B, PR 5. Additive: the status rule is widened (nothing existing becomes invalid), ONE new table, ONE trigger function. No data is
-- changed. Safe to run more than once. Run AFTER 001-014 (needs contributions from 012). It does NOT need 015 or 016. NOT applied automatically.
-- Review, take a fresh backup, then run it yourself:
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 017          (dry run)
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 017 --apply
-- Undo: db/rollback/017_down.sql (refuses while any contribution is rejected or unpublished, or any review exists).
--
-- STATUS MACHINE after this migration (the application enforces who may move an item where; see src/lib/contributionApi.ts and
-- src/lib/contributionReview.ts):
--   draft -> pending_review (owner submits)        changes_requested -> pending_review (owner resubmits)
--   pending_review -> published | changes_requested | rejected (moderator or admin; changes_requested and rejected need a note)
--   published -> unpublished (moderator or admin, with a note);  unpublished -> published (moderator or admin)  or -> pending_review (owner edits)
--   an edited published item goes back to pending_review and leaves the public counts. rejected is final.
-- The existing rules stay: draft <=> submitted_at is empty, published <=> published_at is set, and a non-draft item keeps at least one sector.
--
-- contribution_reviews: one row per moderator decision (action, note, who, when). APPEND ONLY: a row can be added, never changed or
-- deleted by anyone (a trigger refuses). The only exception is the database's own cleanup when the contribution (or the reviewer's
-- account) itself is deleted. The author sees only the note of the latest decision on their own item.

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

-- Widen the status rule. 018 later widens the same rule again (with 'removed'), so running this file once more after 018 must leave
-- that wider rule as it is, never narrow it back. The existing rule (on contributions itself) is compared EXACTLY, spacing aside, with
-- the three rules these files make, all written out by PostgreSQL (pg_get_constraintdef) on a throwaway copy of the status column (a
-- temporary table inside an inner block that is always undone, as in 007: RAISE SQLSTATE 'RV000', caught only there, rolls back just
-- that block while the variables keep the texts read); both sides come from the same server, so this does not depend on its version:
--   012's four statuses (also what 017_down restores)  -> widened to the six below
--   this file's six (also what 018_down restores)      -> left as it is
--   018's seven                                        -> left as it is
-- No rule at all: the six are added. Any other rule of that name (one that names all six statuses but forbids one, another list,
-- NOT VALID) was not made by these files: it stops the migration, and nothing is changed.
DO $$
DECLARE
  found text; -- the existing rule, as PostgreSQL writes it (spacing normalised)
  col text;   -- the type of contributions.status
  four text; six text; seven text; -- the three known rules, as the same server writes them (spacing normalised)
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO found FROM pg_constraint c
   WHERE c.conrelid = 'contributions'::regclass AND c.conname = 'contributions_status_ck';
  IF found IS NULL THEN
    ALTER TABLE contributions ADD CONSTRAINT contributions_status_ck
      CHECK (status IN ('draft','pending_review','changes_requested','published','rejected','unpublished'));
    RETURN;
  END IF;
  SELECT format_type(a.atttypid, a.atttypmod) INTO col FROM pg_attribute a
   WHERE a.attrelid = 'contributions'::regclass AND a.attname = 'status' AND NOT a.attisdropped;
  IF col IS NOT NULL THEN -- without a status column no rule of these files can be there; four, six and seven stay empty and it stops below
    BEGIN
      EXECUTE format('CREATE TEMPORARY TABLE rv_expected_017 (status %s)', col);
      ALTER TABLE pg_temp.rv_expected_017
        ADD CONSTRAINT four  CHECK (status IN ('draft','pending_review','changes_requested','published')),
        ADD CONSTRAINT six   CHECK (status IN ('draft','pending_review','changes_requested','published','rejected','unpublished')),
        ADD CONSTRAINT seven CHECK (status IN ('draft','pending_review','changes_requested','published','rejected','unpublished','removed'));
      SELECT max(d) FILTER (WHERE conname = 'four'), max(d) FILTER (WHERE conname = 'six'), max(d) FILTER (WHERE conname = 'seven')
        INTO four, six, seven
        FROM (SELECT c.conname, regexp_replace(btrim(pg_get_constraintdef(c.oid)), '[[:space:]]+', ' ', 'g') AS d
                FROM pg_constraint c WHERE c.conrelid = 'pg_temp.rv_expected_017'::regclass) x;
      RAISE SQLSTATE 'RV000'; -- undo this inner block (the temporary table); four, six and seven keep their values
    EXCEPTION WHEN SQLSTATE 'RV000' THEN
      NULL;
    END;
  END IF;
  found := regexp_replace(btrim(found), '[[:space:]]+', ' ', 'g');
  IF four IS NOT NULL AND found = four THEN
    ALTER TABLE contributions DROP CONSTRAINT IF EXISTS contributions_status_ck;
    ALTER TABLE contributions ADD CONSTRAINT contributions_status_ck
      CHECK (status IN ('draft','pending_review','changes_requested','published','rejected','unpublished'));
  ELSIF found IS DISTINCT FROM six AND found IS DISTINCT FROM seven THEN
    RAISE EXCEPTION 'contributions already has a status rule named contributions_status_ck that is none of the rules these migrations make (012''s four statuses, 017''s six, 018''s seven); it reads: %. This migration did not make it; look at it before running 017 again. Nothing was changed.', found;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS contribution_reviews (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contribution_id bigint      NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  reviewer_id     bigint      REFERENCES users(id) ON DELETE SET NULL,
  action          varchar(20) NOT NULL,
  note            varchar(1000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contribution_reviews_action_ck CHECK (action IN ('approve','request_changes','reject','unpublish','republish')),
  CONSTRAINT contribution_reviews_note_ck CHECK (
    (action IN ('request_changes','reject','unpublish') AND char_length(btrim(coalesce(note, ''))) BETWEEN 3 AND 1000)
    OR (action IN ('approve','republish') AND (note IS NULL OR char_length(note) <= 1000)))
);
CREATE INDEX IF NOT EXISTS contribution_reviews_item_idx ON contribution_reviews (contribution_id, created_at DESC);

-- Nobody changes or removes a decision. pg_trigger_depth() > 1 is the database's own foreign-key cleanup (the contribution or the
-- reviewer's account was deleted), which is allowed; a direct UPDATE or DELETE is depth 1 and is refused.
CREATE OR REPLACE FUNCTION rv_review_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'Review decisions can be added but never changed or deleted.' USING ERRCODE = '23514';
END $fn$;

-- CREATE TRIGGER has no IF NOT EXISTS (and CREATE OR REPLACE TRIGGER needs PostgreSQL 14), so check the catalog first.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'contribution_reviews_append_only' AND tgrelid = 'contribution_reviews'::regclass) THEN
    CREATE TRIGGER contribution_reviews_append_only BEFORE UPDATE OR DELETE ON contribution_reviews
      FOR EACH ROW EXECUTE FUNCTION rv_review_append_only();
  END IF;
END $$;

COMMIT;
