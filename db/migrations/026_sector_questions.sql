-- RoboValley migration 026: each sector's questions (sector_questions), kept by administrators in Sector forms (P5)
-- Additive only: ONE new table and its indexes. Nothing is dropped, renamed or rewritten, and no existing row changes.
-- Safe to run more than once.
-- Run AFTER 001-025 (needs sectors and users; it does not use 013-025). NOT applied automatically.
-- Review, take a fresh backup, then run it yourself, e.g.:
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 026          (dry run)
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 026 --apply
-- Undo: db/rollback/026_down.sql (refuses while any question exists: see the note there).
--
-- WHAT IT IS. P5: in /admin/sector-forms an administrator writes up to 5 questions per sector that are ON (switched-off ones are kept),
-- each either a short text answer (up to 500 characters) or one choice from a list (2 to 10 choices). Questions are optional by
-- default; at most 2 of the ON questions of a sector can be marked required. The Contribute form asks them in P6, which also stores
-- the answers (its own migration), each with the question as it was asked.
--   * label: the question as members read it. kind: 'text' or 'choice'; it cannot change once the question exists (answers stay
--     comparable). options: the choices of a 'choice' question, in order (NULL for 'text').
--   * Never deleted (the app has no way to): is_active = false hides a question from the form; answers already given keep it, shown
--     in Moderation as "no longer asked" (P6).
--   * The limits (5 on, 2 required) are kept by the app, inside one transaction per change.
-- The application also works BEFORE this migration is applied: Sector forms says the questions are not set up yet, nothing else
-- reads the table.

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

CREATE TABLE IF NOT EXISTS sector_questions (
  id           integer      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sector_id    integer      NOT NULL REFERENCES sectors (id) ON DELETE RESTRICT,
  label        varchar(200) NOT NULL,
  kind         varchar(10)  NOT NULL,
  options      jsonb,
  is_required  boolean      NOT NULL DEFAULT false,
  sort_order   integer      NOT NULL DEFAULT 100,
  is_active    boolean      NOT NULL DEFAULT true,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  updated_by   bigint       REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT sector_questions_label_ck CHECK (char_length(btrim(label)) BETWEEN 5 AND 200 AND label = btrim(label)),
  CONSTRAINT sector_questions_kind_ck CHECK (kind IN ('text', 'choice')),
  CONSTRAINT sector_questions_options_ck CHECK (
    (kind = 'text' AND options IS NULL) OR
    (kind = 'choice' AND CASE WHEN jsonb_typeof(options) = 'array' THEN jsonb_array_length(options) BETWEEN 2 AND 10 ELSE false END)
    -- CASE: the length is only ever read from an array, whatever order the database evaluates the parts in. SQL NULL and JSON null
    -- options fall to ELSE false, so a choice question without choices is refused (a CHECK that came out NULL would pass).
  ),
  CONSTRAINT sector_questions_required_on_ck CHECK (is_active OR NOT is_required) -- a switched-off question is never required
);

CREATE INDEX IF NOT EXISTS sector_questions_order_idx ON sector_questions (sector_id, sort_order, id);

COMMENT ON TABLE sector_questions IS
  'P5: each sector''s questions, kept by administrators in Sector forms. At most 5 on and 2 required per sector (kept by the app). Never deleted.';
COMMENT ON COLUMN sector_questions.kind IS 'text = a short answer (up to 500 characters); choice = one of options. Fixed once the question exists.';

COMMIT;
