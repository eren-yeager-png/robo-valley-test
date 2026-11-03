-- RoboValley migration 008: login_events (privacy-minimal activity log for the admin Reports)
-- Additive only: one new table and its indexes. It does not read, change or delete users or any existing data.
-- Safe to run more than once. Run AFTER 001-007 (it only needs `users`, from 001/base).
-- NOT applied automatically. Review, then run it yourself, e.g.:
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 008          (dry run)
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 008 --apply
-- Undo: db/rollback/008_down.sql (removes only the table created here).
--
-- PRIVACY BY DESIGN. A row says "what happened, when, and to which account" and nothing else:
--   * no IP address, no e-mail address (typed or stored), no password, no OTP value, no token, no free-text message;
--   * `reason` and `ua_family` can only hold the short fixed codes listed below (enforced by CHECK constraints);
--   * `user_id` is NULL when no account is known (for example a failed login for an address that does not exist),
--     and becomes NULL if the account is later deleted.
-- Retention: rows older than 180 days are deleted by the application (a migration may not contain DELETE).
-- Nothing is recorded by this migration: the application code that writes events comes in a later change.

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

CREATE TABLE IF NOT EXISTS login_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  event_type varchar(16) NOT NULL
               CHECK (event_type IN ('login_success', 'login_failed', 'otp_sent', 'otp_failed', 'otp_verified', 'signup', 'logout')),
  user_id    bigint REFERENCES users(id) ON DELETE SET NULL,   -- NULL = no known account
  reason     varchar(16)
               CHECK (reason IS NULL OR reason IN
                 ('bad_credentials', 'throttled', 'not_verified', 'send_failed', 'wrong_code', 'expired', 'locked', 'rate_limited', 'server_error')),
  purpose    varchar(10) CHECK (purpose IS NULL OR purpose IN ('signup', 'guardian')),
  ua_family  varchar(10) CHECK (ua_family IS NULL OR ua_family IN ('chrome', 'safari', 'firefox', 'edge', 'other')),
  -- a purpose only makes sense for OTP events, a reason only for failures
  CONSTRAINT login_events_purpose_ck CHECK (purpose IS NULL OR event_type IN ('otp_sent', 'otp_failed', 'otp_verified')),
  CONSTRAINT login_events_reason_ck  CHECK (reason  IS NULL OR event_type IN ('login_failed', 'otp_failed'))
);

-- Reports read bounded date ranges, always filtered by event type.
CREATE INDEX IF NOT EXISTS login_events_created_idx ON login_events (created_at);
CREATE INDEX IF NOT EXISTS login_events_type_created_idx ON login_events (event_type, created_at) INCLUDE (user_id);

COMMIT;
