-- TEST FIXTURE ONLY (never applied to a real database).
-- The two tables as they were created by hand before migrations 001/002 existed. The tests apply this first,
-- then the REAL migrations 001, 002 and 003, so the in-process test database ends up with the same schema as
-- the live one. (A proper db/migrations/000_base_schema.sql for new environments is a separate, later step.)
CREATE TABLE users (
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
