-- RoboValley migration 016: the first real sector (Agriculture & Dairy) and a rule that sector names are unique
-- Part B, PR 6. Additive only: ONE new index and ONE row. Nothing is dropped, renamed or rewritten. Safe to run more than once.
-- Run AFTER 001-015 (needs the sectors table from 012). NOT applied automatically. Review, take a fresh backup, then run it yourself:
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 016          (dry run)
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 016 --apply
-- Undo: db/rollback/016_down.sql (removes the index, and the seeded sector only if no contribution uses it).
--
-- WHY. The Contribute hub lists the sectors in this table. Only Agriculture & Dairy exists as a real sector page on the site today.
-- Education and Healthcare are design samples only and are NOT added here. A new sector later is one more small migration with
-- one INSERT (or an admin screen, if the owner prefers), so every sector is a deliberate, reviewed change.
--   * the INSERT does nothing if the sector already exists (ON CONFLICT DO NOTHING): it never overwrites a name or order that was edited;
--   * the unique index on the lower-case, trimmed name stops two sectors that differ only in capital letters or spaces
--     (the slug is already unique). It is also what `migrate.mjs --status` looks for to tell that 016 has been applied.

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

CREATE UNIQUE INDEX IF NOT EXISTS sectors_name_lower_uq ON sectors (lower(btrim(name)));

INSERT INTO sectors (slug, name, sort_order, is_active, is_demo)
VALUES ('agriculture-dairy', 'Agriculture & Dairy', 10, true, false)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
