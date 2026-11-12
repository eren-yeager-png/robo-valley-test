-- RoboValley migration 020: password reset (single-use hashed tokens) and the moment a password last changed
-- Additive only: ONE new table, ONE new nullable column. Nothing is dropped, renamed or rewritten, and no existing row changes
-- (every user gets password_changed_at = NULL, meaning "never changed through a reset"). Safe to run more than once.
-- Run AFTER 001-018 (needs users). It does not depend on 019 and 019 does not depend on it. NOT applied automatically.
-- Review, take a fresh backup, then run it yourself, e.g.:
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 020          (dry run)
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 020 --apply
-- Undo: db/rollback/020_down.sql (refuses once any password has been changed through a reset: see the note there).
--
-- WHAT IT ADDS
--   * password_reset_tokens: one row per reset link that was sent. Only a SHA-256 hash of the token is stored (never the token
--     itself, so a database leak cannot be used to reset anyone's password). A token is valid for at most 60 minutes (the database
--     refuses a longer lifetime) and can be used once (used_at). Deleting a user deletes their tokens.
--   * users.password_changed_at: set when a reset succeeds. The application refuses any sign-in session issued BEFORE this moment,
--     which is how "everyone is signed out everywhere after a reset" works with signed-cookie sessions. NULL = no reset yet = no
--     restriction, so nobody is signed out when this migration or the code that uses it is deployed.
--   The application also works BEFORE this migration is applied: the session check falls back to the old query when the column is
--   missing, and password reset itself stays switched off until the table exists.

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

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64)    NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  CONSTRAINT password_reset_tokens_hash_uq UNIQUE (token_hash),
  CONSTRAINT password_reset_tokens_hash_ck CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT password_reset_tokens_expiry_ck CHECK (expires_at > created_at AND expires_at <= created_at + interval '60 minutes'),
  CONSTRAINT password_reset_tokens_used_ck CHECK (used_at IS NULL OR used_at >= created_at)
);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS password_reset_tokens_expiry_idx ON password_reset_tokens (expires_at);

COMMIT;
