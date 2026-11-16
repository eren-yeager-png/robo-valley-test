-- RoboValley migration 021: "Let moderators contact me using my profile details" (contributions.share_contact_with_moderators)
-- Additive only: ONE new column with a default. Nothing is dropped, renamed or rewritten, and no existing row changes except that it
-- gets the default (false = not shared). Safe to run more than once.
-- Run AFTER 001-020 (needs contributions from 012). It does not depend on 019 or 020. NOT applied automatically.
-- Review, take a fresh backup, then run it yourself, e.g.:
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 021          (dry run)
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 021 --apply
-- Undo: db/rollback/021_down.sql (refuses while any contribution has the box ticked: see the note there).
--
-- WHAT IT IS. The Contribute form no longer asks for a name, email and mobile number. It has ONE checkbox instead, unticked by
-- default: "Let moderators contact me using my profile details". This column stores that choice, per contribution.
--   * true  = a flagged moderator (users.is_moderator) may see the contributor's PROFILE contact (name, email, mobile) for THIS
--             contribution. The rule is in the read query itself (src/lib/contributionContacts.ts), never left to the caller.
--   * false = nobody but the contributor sees any contact. It is never shown publicly, counted or exported to anyone else.
-- Contact details typed into the old form (the table from migration 014) are KEPT and still follow their own
-- "share with moderators" box; the new form simply stops collecting them.
-- The application also works BEFORE this migration is applied: the choice is then not saved (treated as "not shared").

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

ALTER TABLE contributions ADD COLUMN IF NOT EXISTS share_contact_with_moderators boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN contributions.share_contact_with_moderators IS
  'The contributor ticked "Let moderators contact me using my profile details" for this contribution. Read only through src/lib/contributionContacts.ts.';

COMMIT;
