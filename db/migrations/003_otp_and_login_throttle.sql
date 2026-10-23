-- RoboValley migration 003: database-backed OTP codes, verification tokens and login throttling
--
-- WHY: serverless hosting (Vercel) runs many short-lived instances that do not share memory. These three
-- tables replace the in-memory stores so every instance sees the same state.
--
-- Creates THREE NEW tables and their indexes. It does not read, change or delete users, guardian_details
-- or any existing data. Safe to run more than once (IF NOT EXISTS). Run AFTER 001 and 002 (not required by
-- the SQL itself, but the app expects all three).
--
-- NOT applied automatically. Review, then run it yourself, e.g.:
--   npm run db:migrate -- --expect-db <database name> --only 003          (dry run: shows the target, changes nothing)
--   npm run db:migrate -- --expect-db <database name> --only 003 --apply
--
-- Rollback (only deletes short-lived codes/tokens/counters, never accounts): db/rollback/003_down.sql

BEGIN;

-- Safety guard (fails closed): this script runs only if the operator has explicitly named the database
-- they intend to change (session setting rv.expected_db) AND it matches the database we are connected to.
-- No database name is hard-coded here. Set it by running through: npm run db:migrate -- --expect-db <name> --apply
DO $$
DECLARE
  expected text := nullif(current_setting('rv.expected_db', true), '');
BEGIN
  IF expected IS NULL THEN
    RAISE EXCEPTION 'rv.expected_db is not set. Run this through "npm run db:migrate -- --expect-db <database name>" so the target database is confirmed. Nothing was changed.';
  END IF;
  IF current_database() <> expected THEN
    RAISE EXCEPTION 'Wrong database: connected to "%" but expected "%". Nothing was changed.', current_database(), expected;
  END IF;
END $$;

-- One row per (purpose, email): the current one-time code and its limits.
-- The code itself is never stored: only a keyed HMAC derived from SESSION_SECRET.
CREATE TABLE IF NOT EXISTS otp_challenges (
  purpose           varchar(10)  NOT NULL CHECK (purpose IN ('signup', 'guardian')),
  email             varchar(254) NOT NULL,           -- normalised (trimmed, lower-case)
  code_hash         char(64),                        -- hex HMAC-SHA256; NULL once used / voided / locked
  expires_at        timestamptz  NOT NULL,           -- issued time + 10 minutes
  attempts          smallint     NOT NULL DEFAULT 0, -- wrong guesses against the current code
  locked_until      timestamptz,                     -- set after 5 wrong guesses (30 minutes)
  last_sent_at      timestamptz  NOT NULL,           -- for the 30-second resend cooldown
  window_started_at timestamptz  NOT NULL,           -- start of the current 1-hour send window
  sends_in_window   smallint     NOT NULL DEFAULT 1, -- codes sent in this window (max 6)
  PRIMARY KEY (purpose, email)
);
CREATE INDEX IF NOT EXISTS otp_challenges_expires_idx ON otp_challenges (expires_at);

-- Single-use proof that an email address was verified. Only the SHA-256 of the token is stored.
CREATE TABLE IF NOT EXISTS email_verifications (
  token_hash char(64)     PRIMARY KEY,               -- hex SHA-256 of the random token; never the token
  purpose    varchar(10)  NOT NULL CHECK (purpose IN ('signup', 'guardian')),
  email      varchar(254) NOT NULL,
  via        varchar(10)  NOT NULL CHECK (via IN ('email', 'mock')),
  expires_at timestamptz  NOT NULL                   -- issued time + 30 minutes
);
CREATE INDEX IF NOT EXISTS email_verifications_expires_idx ON email_verifications (expires_at);

-- Failed-login counter per email: 5 attempts, then a 15-minute lock.
CREATE TABLE IF NOT EXISTS login_attempts (
  email             varchar(254) PRIMARY KEY,        -- normalised
  failures          smallint     NOT NULL DEFAULT 0,
  window_started_at timestamptz  NOT NULL,
  locked_until      timestamptz
);
CREATE INDEX IF NOT EXISTS login_attempts_window_idx ON login_attempts (window_started_at);

COMMIT;
