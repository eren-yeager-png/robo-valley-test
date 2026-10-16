-- RoboValley migration 002: record email verification (needed for email OTP signup)
-- Additive and backward-compatible: only ADD ... IF NOT EXISTS. Nothing is dropped,
-- renamed, truncated or rewritten. Safe to run more than once. Run AFTER 001.
-- NOT applied automatically. Review, then run it yourself as the owner of `users`, e.g.:
--   psql -h localhost -p 5433 -U app_user -d robovalley_auth -v ON_ERROR_STOP=1 -f db/migrations/002_email_verification.sql

BEGIN;

-- Safety guard: abort (and change nothing) if this script is run against any
-- database other than robovalley_auth, e.g. because -d was forgotten.
DO $$
BEGIN
  IF current_database() <> 'robovalley_auth' THEN
    RAISE EXCEPTION 'Wrong database: %. Expected robovalley_auth.', current_database();
  END IF;
END $$;

-- 1. How the user's email address was verified. 'email' = a real code delivered by email
--    (Resend). 'mock' = local test OTP, nothing was sent, NOT proof of ownership.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verification varchar(10) NOT NULL DEFAULT 'none'
    CHECK (email_verification IN ('none', 'mock', 'email'));

-- 2. Guardian contact email (the guardian's code is sent here) and how it was verified.
--    consent_status stays 'pending' / consent_mode 'test': controlling an inbox is not
--    legally valid parental consent.
ALTER TABLE guardian_details
  ADD COLUMN IF NOT EXISTS guardian_email varchar(254);

ALTER TABLE guardian_details
  ADD COLUMN IF NOT EXISTS email_verification varchar(10) NOT NULL DEFAULT 'none'
    CHECK (email_verification IN ('none', 'mock', 'email'));

COMMIT;
