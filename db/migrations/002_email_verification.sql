-- RoboValley migration 002: record email verification (needed for email OTP signup)
-- Additive and backward-compatible: only ADD ... IF NOT EXISTS. Nothing is dropped,
-- renamed, truncated or rewritten. Safe to run more than once. Run AFTER 001.
-- NOT applied automatically. Review, then run it yourself (as the owner of `users`), e.g.:
--   npm run db:migrate -- --expect-db <database name> --only 002          (dry run: shows the target, changes nothing)
--   npm run db:migrate -- --expect-db <database name> --only 002 --apply

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
