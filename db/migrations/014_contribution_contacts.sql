-- RoboValley migration 014: private contact details for a contribution (contribution_contacts)
-- Part B, PR 3. Additive only: ONE new table. It does not read, change or delete any existing data and adds no row.
-- Safe to run more than once. Run AFTER 001-013 (needs contributions). NOT applied automatically.
-- Review, take a fresh backup, then run it yourself, e.g.:
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 014          (dry run)
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 014 --apply
-- Undo: db/rollback/014_down.sql (WARNING: it DELETES every contact detail saved after this ran).
--
-- PRIVACY BY DESIGN. This table holds a contributor's name, email and phone. It is PRIVATE.
--   * It is a separate table, joined into NOTHING public: no view, no function and no public query refers to it.
--   * Who may read a row (enforced in the application's one read query, src/lib/contributionContacts.ts):
--       - the contributor who owns the contribution, always;
--       - a moderator, ONLY when share_with_moderators is true (it defaults to false);
--       - nobody else.
--   * It never appears in published output, in the sector counts, or in "Your contributions" for anyone else.
--   * Every query on it lists its columns. There is no SELECT *.
--   * Deleting the contribution (or its user) deletes the contact row.
-- The limits are mirrored in CONTRIBUTION_LIMITS (src/lib/contributions.ts); a test fails if they differ.

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

CREATE TABLE IF NOT EXISTS contribution_contacts (
  contribution_id       bigint       PRIMARY KEY REFERENCES contributions(id) ON DELETE CASCADE,
  contact_name          varchar(150) NOT NULL,
  email                 varchar(254),
  phone                 varchar(10),
  share_with_moderators boolean      NOT NULL DEFAULT false,
  created_at            timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT contribution_contacts_name_ck CHECK (char_length(btrim(contact_name)) BETWEEN 1 AND 150),
  CONSTRAINT contribution_contacts_email_ck CHECK (email IS NULL OR (email = lower(email) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')),
  CONSTRAINT contribution_contacts_phone_ck CHECK (phone IS NULL OR phone ~ '^[6-9][0-9]{9}$'),
  CONSTRAINT contribution_contacts_reach_ck CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

COMMIT;
