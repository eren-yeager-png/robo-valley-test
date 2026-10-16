-- RoboValley signup additions (migration 001)
-- Additive and backward-compatible: only ADD ... IF NOT EXISTS. Nothing is
-- dropped, renamed, truncated or rewritten. Safe to run more than once.
-- NOT applied automatically. Review, then run it yourself, e.g.:
--   psql "$DATABASE_URL" -f db/migrations/001_signup_additions.sql

BEGIN;

-- Safety guard: abort (and change nothing) if this script is run against any
-- database other than robovalley_auth, e.g. because -d was forgotten.
DO $$
BEGIN
  IF current_database() <> 'robovalley_auth' THEN
    RAISE EXCEPTION 'Wrong database: %. Expected robovalley_auth.', current_database();
  END IF;
END $$;

-- 1. Age category. The numeric users.age column is left untouched and stays
--    nullable; the app stores NULL there because the UI never collects an exact age.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS age_category varchar(10)
    CHECK (age_category IN ('adult', 'minor'));

-- 2. Role-specific profile answers (class, school, subjects, ...), validated
--    against a per-role allowlist by the server before storage.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 3. Consent choices from the privacy step (privacy, terms, whatsapp, email, photo)
--    plus the privacy notice version that was shown.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS consents jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 4. How the mobile number was verified. 'mock' = local test OTP, no SMS sent,
--    NOT proof of phone ownership. 'sms' is reserved for a future real provider.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mobile_verification varchar(10) NOT NULL DEFAULT 'none'
    CHECK (mobile_verification IN ('none', 'mock', 'sms'));

-- 5. Guardian verification + consent mode. consent_status stays 'pending'
--    while consent_mode = 'test': a mock OTP never counts as real consent.
ALTER TABLE guardian_details
  ADD COLUMN IF NOT EXISTS mobile_verification varchar(10) NOT NULL DEFAULT 'none'
    CHECK (mobile_verification IN ('none', 'mock', 'sms'));

ALTER TABLE guardian_details
  ADD COLUMN IF NOT EXISTS consent_mode varchar(10) NOT NULL DEFAULT 'test'
    CHECK (consent_mode IN ('test', 'real'));

-- 6. Case-insensitive email uniqueness (the existing users_email_key is case
--    sensitive). The app also lowercases emails before insert.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));

COMMIT;
