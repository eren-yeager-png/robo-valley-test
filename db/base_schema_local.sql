-- RoboValley BASE schema for a brand-new LOCAL development database (not a migration; not run by db:migrate).
-- The two original tables were created by hand in the live database; this recreates them as they were BEFORE
-- migrations 001-003. It mirrors tests/helpers/baseSchema.sql, which the test-suite applies before the real
-- migrations. Apply this first, then run migrations 001, 002, 003 (npm/node scripts/migrate.mjs, --apply).
--
-- Apply to the local Docker database only:
--   docker exec -i robovalley-postgres psql -U postgres -d robovalley_dev -v ON_ERROR_STOP=1 < db/base_schema_local.sql
-- Plain CREATE TABLE (no IF NOT EXISTS): it fails instead of touching a database that already has these tables.

BEGIN;

-- Safety guard: refuse to run anywhere except the local dev database.
DO $$
BEGIN
  IF current_database() <> 'robovalley_dev' THEN
    RAISE EXCEPTION 'Wrong database: connected to "%" but this file is for robovalley_dev only. Nothing was changed.', current_database();
  END IF;
END $$;

CREATE TABLE users (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  full_name          varchar(150) NOT NULL,
  email              varchar(255) NOT NULL UNIQUE,   -- constraint name users_email_key (referred to in migration 001)
  mobile             varchar(20),
  role               varchar(50)  NOT NULL,          -- role code: ST, PA, TC, SA, MG, ME, TR, AR, KS, FS, SP, IP
  district           varchar(100),
  preferred_language varchar(50),
  age                smallint,                       -- stays NULL; the app stores age_category (added by 001) instead
  password_hash      varchar(255) NOT NULL,          -- bcrypt
  guardian_consent   boolean,
  terms_accepted_at  timestamptz  NOT NULL DEFAULT now(),
  created_at         timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE guardian_details (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id               bigint NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  guardian_name         varchar(150) NOT NULL,
  guardian_relationship varchar(50)  NOT NULL,
  guardian_mobile       varchar(20)  NOT NULL,
  consent_status        varchar(20)  NOT NULL DEFAULT 'pending'
                          CHECK (consent_status IN ('pending', 'granted', 'denied')),
  consent_recorded_at   timestamptz,
  created_at            timestamptz  NOT NULL DEFAULT now()
);

COMMIT;
