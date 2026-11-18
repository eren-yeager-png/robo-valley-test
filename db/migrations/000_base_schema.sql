-- RoboValley migration 000: base tables (users, guardian_details)
--
-- WHY: these two tables were originally created by hand, so no migration made them. A brand-new database
-- (for example a new Neon database) has neither, and migration 001 would fail on "ALTER TABLE users".
-- This file creates them in their ORIGINAL shape; migrations 001 and 002 then add the later columns, so a fresh
-- database ends up with exactly the same schema as the existing one.
--
-- Safe on a database that already has these tables (your local one): every statement is CREATE TABLE IF NOT
-- EXISTS, so nothing is created, altered, dropped or deleted. There is deliberately NO rollback script for this
-- file: dropping users would destroy accounts. To undo it on a brand-new database, delete that database.
--
-- Run order: 000, 001, 002, 003. NOT applied automatically. Review, then run it yourself, e.g.:
--   npm run db:migrate -- --expect-db <database name> --only 000          (dry run: shows the target, changes nothing)
--   npm run db:migrate -- --expect-db <database name> --only 000 --apply

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

CREATE TABLE IF NOT EXISTS users (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  full_name          varchar(150) NOT NULL,
  email              varchar(255) NOT NULL UNIQUE,
  mobile             varchar(20),
  role               varchar(50)  NOT NULL,
  district           varchar(100),
  preferred_language varchar(50),
  age                smallint,
  password_hash      varchar(255) NOT NULL,
  guardian_consent   boolean,
  terms_accepted_at  timestamptz  NOT NULL DEFAULT now(),
  created_at         timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guardian_details (
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
