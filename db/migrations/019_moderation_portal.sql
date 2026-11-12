-- RoboValley migration 019: the moderation portal's records (replies, internal notes, who opened what, structured directory categories)
-- Portal PR1. Additive only: five new tables, one view, one new column on contributions with the trigger that keeps it, and two trigger
-- functions. No existing row is changed and no existing rule is narrowed. Safe to run more than once. Run AFTER 001-018 (needs
-- contributions from 012 and contribution_reviews from 017). NOT applied automatically. Review, take a fresh backup, then run it yourself:
--   node --env-file=<env file> scripts/migrate.mjs --expect-db <database name> --only 019          (dry run)
--   node --env-file=<env file> scripts/migrate.mjs --expect-db <database name> --only 019 --apply
-- Undo: db/rollback/019_down.sql (refuses while any reply, internal note or structured category exists).
--
-- WHAT EACH PART IS FOR (nothing here copies data that already exists somewhere else):
--   contribution_replies         a moderator's reply to the contributor. The contributor sees it under My Contributions, whatever the
--                                status. APPEND ONLY (only email_sent_at may be filled in once, by the optional notification).
--   contribution_notes           an internal note. Moderators only: no contributor-facing query reads this table. APPEND ONLY.
--   contribution_views           who opened which item, first and last time (one row per item and moderator). It decides "New" versus
--                                "In review" and gives the work log its "opened" entries.
--   contribution_categories      the directory categories chosen in the form, with the remarks (structured; the form still folds the same
--   contribution_category_links  text into the description until the portal reads these tables, as agreed).
--   contributions.review_round_at  when the item last ENTERED pending_review (first submission, resubmission after changes, or an edit of a
--                                published item). Set by the database on every such status change, so "Replied" / "In review" only count
--                                what happened in the current round and a resubmitted item shows as "New" again. NULL on rows that have
--                                not changed status since this migration: the application then uses submitted_at.
--   contribution_work_log        a VIEW (no stored copy) over the decisions (017), replies, notes and first opens: who, what, when, which item.
-- The status values themselves do not change: the labels New / In review / Replied are worked out by the application (src/lib/reviewStatus.ts).

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

-- ---------- replies to the contributor ----------
CREATE TABLE IF NOT EXISTS contribution_replies (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contribution_id bigint        NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  author_id       bigint        REFERENCES users(id) ON DELETE SET NULL,
  message         varchar(2000) NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  email_sent_at   timestamptz,
  CONSTRAINT contribution_replies_message_ck CHECK (char_length(btrim(message)) BETWEEN 3 AND 2000)
);
CREATE INDEX IF NOT EXISTS contribution_replies_item_idx ON contribution_replies (contribution_id, created_at DESC);
CREATE INDEX IF NOT EXISTS contribution_replies_created_idx ON contribution_replies (created_at DESC);

-- ---------- internal notes (moderators only) ----------
CREATE TABLE IF NOT EXISTS contribution_notes (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contribution_id bigint        NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  author_id       bigint        REFERENCES users(id) ON DELETE SET NULL,
  note            varchar(1000) NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT contribution_notes_note_ck CHECK (char_length(btrim(note)) BETWEEN 3 AND 1000)
);
CREATE INDEX IF NOT EXISTS contribution_notes_item_idx ON contribution_notes (contribution_id, created_at DESC);
CREATE INDEX IF NOT EXISTS contribution_notes_created_idx ON contribution_notes (created_at DESC);

-- Replies and notes are added, never changed or deleted. Same rule and same exception as the decisions in 017: pg_trigger_depth() > 1 is
-- the database's own foreign-key cleanup (the contribution or the author's account was deleted). The one allowed change: a reply's
-- email_sent_at may be filled in once, when nothing else in the row changes.
CREATE OR REPLACE FUNCTION rv_portal_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  -- nested on purpose: the inner test names reply-only columns, so it must only ever be evaluated for contribution_replies
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'contribution_replies' THEN
    IF OLD.email_sent_at IS NULL AND NEW.email_sent_at IS NOT NULL
       AND NEW.id = OLD.id AND NEW.contribution_id = OLD.contribution_id AND NEW.author_id IS NOT DISTINCT FROM OLD.author_id
       AND NEW.message = OLD.message AND NEW.created_at = OLD.created_at THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'Replies and internal notes can be added but never changed or deleted.' USING ERRCODE = '23514';
END $fn$;

-- CREATE TRIGGER has no IF NOT EXISTS (and CREATE OR REPLACE TRIGGER needs PostgreSQL 14), so check the catalog first.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'contribution_replies_append_only' AND tgrelid = 'contribution_replies'::regclass) THEN
    CREATE TRIGGER contribution_replies_append_only BEFORE UPDATE OR DELETE ON contribution_replies
      FOR EACH ROW EXECUTE FUNCTION rv_portal_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'contribution_notes_append_only' AND tgrelid = 'contribution_notes'::regclass) THEN
    CREATE TRIGGER contribution_notes_append_only BEFORE UPDATE OR DELETE ON contribution_notes
      FOR EACH ROW EXECUTE FUNCTION rv_portal_append_only();
  END IF;
END $$;

-- ---------- who opened which item ----------
CREATE TABLE IF NOT EXISTS contribution_views (
  contribution_id bigint      NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  viewer_id       bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_viewed_at timestamptz NOT NULL DEFAULT now(),
  last_viewed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contribution_id, viewer_id),
  CONSTRAINT contribution_views_order_ck CHECK (last_viewed_at >= first_viewed_at)
);
CREATE INDEX IF NOT EXISTS contribution_views_first_idx ON contribution_views (first_viewed_at DESC);

-- ---------- structured directory categories ----------
CREATE TABLE IF NOT EXISTS contribution_categories (
  contribution_id bigint        NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  category        varchar(40)   NOT NULL,
  remarks         varchar(2000),
  position        smallint      NOT NULL,
  PRIMARY KEY (contribution_id, category),
  CONSTRAINT contribution_categories_category_ck CHECK (category IN ('Projects','Services','Events','Robo Clubs','Labs & Makerspaces','Training & Workshops','Not sure')),
  CONSTRAINT contribution_categories_position_ck CHECK (position BETWEEN 1 AND 7),
  CONSTRAINT contribution_categories_remarks_ck CHECK (remarks IS NULL OR char_length(btrim(remarks)) BETWEEN 1 AND 2000)
);
CREATE INDEX IF NOT EXISTS contribution_categories_category_idx ON contribution_categories (category);

CREATE TABLE IF NOT EXISTS contribution_category_links (
  contribution_id bigint        NOT NULL,
  category        varchar(40)   NOT NULL,
  position        smallint      NOT NULL,
  link_type       varchar(30)   NOT NULL,
  url             varchar(2048) NOT NULL,
  gist            varchar(180)  NOT NULL,
  PRIMARY KEY (contribution_id, category, position),
  FOREIGN KEY (contribution_id, category) REFERENCES contribution_categories (contribution_id, category) ON DELETE CASCADE,
  CONSTRAINT contribution_category_links_position_ck CHECK (position BETWEEN 1 AND 5),
  CONSTRAINT contribution_category_links_type_ck CHECK (link_type IN ('Image','News article','LinkedIn','Subcategory item','Technical','Architectural','Functional','Website','Video','Document','Other')),
  CONSTRAINT contribution_category_links_url_ck CHECK (url ~ '^https?://[^[:space:]]+$'),
  CONSTRAINT contribution_category_links_gist_ck CHECK (char_length(btrim(gist)) BETWEEN 1 AND 180)
);

-- ---------- when the item last entered review ----------
ALTER TABLE contributions ADD COLUMN IF NOT EXISTS review_round_at timestamptz;

CREATE OR REPLACE FUNCTION rv_review_round() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.status = 'pending_review' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'pending_review') THEN
    NEW.review_round_at := now();
  END IF;
  RETURN NEW;
END $fn$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'contributions_review_round' AND tgrelid = 'contributions'::regclass) THEN
    CREATE TRIGGER contributions_review_round BEFORE INSERT OR UPDATE OF status ON contributions
      FOR EACH ROW EXECUTE FUNCTION rv_review_round();
  END IF;
END $$;

-- ---------- the work log: one row per moderator action, read from where each action is already stored ----------
CREATE OR REPLACE VIEW contribution_work_log AS
  SELECT r.created_at AS at, r.reviewer_id AS actor_id, r.action::varchar(20) AS action, r.contribution_id, r.note::varchar(2000) AS detail
    FROM contribution_reviews r
  UNION ALL
  SELECT p.created_at, p.author_id, 'reply'::varchar(20), p.contribution_id, p.message::varchar(2000)
    FROM contribution_replies p
  UNION ALL
  SELECT n.created_at, n.author_id, 'note'::varchar(20), n.contribution_id, n.note::varchar(2000)
    FROM contribution_notes n
  UNION ALL
  SELECT v.first_viewed_at, v.viewer_id, 'view'::varchar(20), v.contribution_id, NULL::varchar(2000)
    FROM contribution_views v;

COMMIT;
