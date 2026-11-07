-- RoboValley migration 011: api_rate_limits (shared per-minute request counters for the public Find a Service API)
-- Additive only: ONE new table and ONE index. It does not read, change or delete any existing data. Safe to run more than once.
-- Run AFTER 001-010. NOT applied automatically. Review, take a fresh backup, then run it yourself, e.g.:
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 011          (dry run)
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 011 --apply
-- Undo: db/rollback/011_down.sql (removes only the table created here).
--
-- WHY: /api/services/search and /api/services/categories are public. A fixed-window counter per visitor address keeps one
-- runaway script (or a very busy shared address) from using up the database. Serverless instances do not share memory, so the
-- counters live here.
--
-- PRIVACY BY DESIGN. `key` is "<scope>:<keyed hash of the address>" (HMAC-SHA-256, truncated). The address itself is never
-- stored, and the hash cannot be turned back into an address without the server's secret. Rows hold only a counter and the
-- start of a one-minute window. Rows older than one hour are deleted by the application (a migration may not contain DELETE).
-- The code FAILS OPEN: if this table cannot be reached, searches still work (just without a limit).

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

CREATE TABLE IF NOT EXISTS api_rate_limits (
  key          varchar(80)  NOT NULL,             -- "<scope>:<hash>", for example "search:3fa1..."
  window_start timestamptz  NOT NULL,             -- start of the one-minute window
  hits         integer      NOT NULL DEFAULT 0 CHECK (hits >= 0),
  PRIMARY KEY (key, window_start)
);

-- For the tidy-up of old windows.
CREATE INDEX IF NOT EXISTS api_rate_limits_window_idx ON api_rate_limits (window_start);

COMMIT;
