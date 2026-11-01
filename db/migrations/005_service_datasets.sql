-- RoboValley migration 005: Find a Service school directory (versioned datasets uploaded by an admin)
-- Additive only: new tables and indexes, nothing existing is touched. Safe to run more than once.
-- Run AFTER 001-004. NOT applied automatically. Review, then run it yourself, e.g.:
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 005          (dry run)
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 005 --apply
-- Undo: db/rollback/005_down.sql (removes only the three tables created here).
--
-- Model: every upload is a dataset VERSION. It is first written as status 'staged' (invisible to search), and only an
-- explicit confirm switches it to 'active' (and the previous active one to 'superseded') in one transaction.
-- Search reads rows of the single 'active' version only. Old versions and their rows are kept for audit and rollback.

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

CREATE TABLE IF NOT EXISTS service_datasets (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  uploaded_by       bigint      NOT NULL REFERENCES users(id),
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  original_filename varchar(255) NOT NULL,
  file_sha256       char(64)    NOT NULL,
  row_count         integer     NOT NULL CHECK (row_count >= 0),
  invalid_row_count integer     NOT NULL DEFAULT 0 CHECK (invalid_row_count >= 0),
  columns           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  status            varchar(20) NOT NULL DEFAULT 'staged'
                      CHECK (status IN ('staged', 'active', 'superseded', 'discarded')),
  activated_at      timestamptz
);

-- At most ONE active dataset, enforced by the database itself (not only by application code).
CREATE UNIQUE INDEX IF NOT EXISTS service_datasets_one_active ON service_datasets ((true)) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS service_datasets_status_idx ON service_datasets (status, uploaded_at);

CREATE TABLE IF NOT EXISTS service_dataset_rows (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_id  bigint NOT NULL REFERENCES service_datasets(id) ON DELETE CASCADE,
  row_number  integer NOT NULL,
  school_name text NOT NULL,
  state       text,
  district    text,
  pincode     varchar(12),
  udise_code  varchar(32),
  data        jsonb NOT NULL,          -- every column of the row, with normalised header names
  search_name text NOT NULL,           -- lower-cased school name
  search_loc  text NOT NULL DEFAULT '' -- lower-cased state, district, pincode and any other location columns
);

CREATE INDEX IF NOT EXISTS service_dataset_rows_dataset_idx ON service_dataset_rows (dataset_id, row_number);
CREATE INDEX IF NOT EXISTS service_dataset_rows_pincode_idx ON service_dataset_rows (dataset_id, pincode);

-- Fast partial matching (LIKE '%text%') needs trigram indexes. pg_trgm is optional: if the database role may not
-- create the extension, the migration still succeeds and search simply falls back to a slower scan.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm is not available (%): partial-match indexes were skipped.', SQLERRM;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS service_dataset_rows_name_trgm ON service_dataset_rows USING gin (search_name gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS service_dataset_rows_loc_trgm ON service_dataset_rows USING gin (search_loc gin_trgm_ops);
  END IF;
END $$;

-- Who did what, when, with what result. user_id keeps the history even if the account is later removed.
CREATE TABLE IF NOT EXISTS upload_audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id    bigint,
  action     varchar(20) NOT NULL CHECK (action IN ('upload', 'confirm')),
  result     varchar(20) NOT NULL CHECK (result IN ('success', 'rejected', 'error')),
  dataset_id bigint,
  filename   varchar(255),
  detail     text
);
CREATE INDEX IF NOT EXISTS upload_audit_log_created_idx ON upload_audit_log (created_at DESC);

COMMIT;
