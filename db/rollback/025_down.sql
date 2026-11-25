-- Undo migration 025. Drops contribution_scopes.robot_type_id (and its link and index), contributions.from_robot_page and the
-- (id, sector_id) unique rule on sector_robot_types.
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --file db/rollback/025_down.sql --apply
-- REFUSES while any contribution has a robot chosen, or any contribution was started from a robot card (from_robot_page = true):
-- dropping the columns would erase the members' answers and that record. To undo anyway, someone must first decide those answers may
-- go; a person with database access then exports and clears them on purpose
-- (UPDATE contribution_scopes SET robot_type_id = NULL; UPDATE contributions SET from_robot_page = false;) and runs this file again.
-- It removes only what 025 made: if the link, the unique rule or the index of the same name exists with a different definition (so
-- 025 did not make it), it REFUSES instead of removing it.
-- NOT run automatically and not in db/migrations, so the runner can never apply it by accident.
-- NOTE: the application treats the missing columns as "no robot", so it keeps working after this.
BEGIN;

DO $$
DECLARE
  expected text := nullif(current_setting('rv.expected_db', true), '');
  n bigint;
BEGIN
  IF expected IS NULL THEN
    RAISE EXCEPTION 'rv.expected_db is not set. Run this through the migration runner with --expect-db <database name>. Nothing was changed.';
  END IF;
  IF current_database() <> expected THEN
    RAISE EXCEPTION 'Wrong database: connected to "%" but expected "%". Nothing was changed.', current_database(), expected;
  END IF;
  -- columns are looked up on the very tables the statements below change (to_regclass: one table in one schema); dynamic SQL is safe
  -- when a column is already gone
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('contribution_scopes') AND attname = 'robot_type_id' AND attnum > 0 AND NOT attisdropped) THEN
    EXECUTE 'SELECT count(*) FROM contribution_scopes WHERE robot_type_id IS NOT NULL' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'Some contributions have a robot chosen (% sector choice(s) in contribution_scopes.robot_type_id). Dropping the column would erase those answers. Export them first, clear them on purpose, then run this again. Nothing was changed.', n;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('contributions') AND attname = 'from_robot_page' AND attnum > 0 AND NOT attisdropped) THEN
    EXECUTE 'SELECT count(*) FROM contributions WHERE from_robot_page' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION '% contribution(s) were started from a robot card (contributions.from_robot_page = true). Dropping the column would erase that. Export their ids first, set it to false on purpose, then run this again. Nothing was changed.', n;
    END IF;
  END IF;
  -- remove only what 025 made: a same-named object with another definition stops the undo instead of being removed
  IF EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('contribution_scopes') AND c.conname = 'contribution_scopes_robot_fk')
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = to_regclass('contribution_scopes') AND c.conname = 'contribution_scopes_robot_fk' AND c.contype = 'f'
          AND c.confrelid = to_regclass('sector_robot_types') AND c.confdeltype = 'r'
          AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum ORDER BY k.ord) = ARRAY['robot_type_id', 'sector_id']
          AND ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
                      JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum ORDER BY k.ord) = ARRAY['id', 'sector_id']) THEN
    RAISE EXCEPTION 'contribution_scopes has a constraint named contribution_scopes_robot_fk that is not the link 025 makes, so 025 did not make it and it is not removed. Look at it first. Nothing was changed.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('sector_robot_types') AND c.conname = 'sector_robot_types_id_sector_uq')
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = to_regclass('sector_robot_types') AND c.conname = 'sector_robot_types_id_sector_uq' AND c.contype = 'u'
          AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum ORDER BY k.ord) = ARRAY['id', 'sector_id']) THEN
    RAISE EXCEPTION 'sector_robot_types has a constraint named sector_robot_types_id_sector_uq that is not UNIQUE (id, sector_id), so 025 did not make it and it is not removed. Look at it first. Nothing was changed.';
  END IF;
  IF to_regclass('contribution_scopes_robot_idx') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
        WHERE i.indexrelid = to_regclass('contribution_scopes_robot_idx') AND i.indrelid = to_regclass('contribution_scopes')
          AND i.indnatts = 1 AND a.attname = 'robot_type_id') THEN
    RAISE EXCEPTION 'An index named contribution_scopes_robot_idx exists but is not 025''s index on contribution_scopes (robot_type_id), so it is not removed. Look at it first. Nothing was changed.';
  END IF;
END $$;

ALTER TABLE contribution_scopes DROP CONSTRAINT IF EXISTS contribution_scopes_robot_fk;
DROP INDEX IF EXISTS contribution_scopes_robot_idx;
ALTER TABLE contribution_scopes DROP COLUMN IF EXISTS robot_type_id;
ALTER TABLE contributions DROP COLUMN IF EXISTS from_robot_page;
DO $$
BEGIN
  IF to_regclass('sector_robot_types') IS NOT NULL THEN
    ALTER TABLE sector_robot_types DROP CONSTRAINT IF EXISTS sector_robot_types_id_sector_uq;
  END IF;
END $$;

COMMIT;
