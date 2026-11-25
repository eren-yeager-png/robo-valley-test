-- RoboValley migration 025: the robot a contribution is about, one per chosen sector (P3)
-- Additive only: one column on contribution_scopes, one column on contributions, one unique rule on sector_robot_types (024) and one
-- link between them. Nothing is dropped, renamed or rewritten; existing rows only get the defaults (no robot = "Not sure", not
-- started from a robot card). Safe to run more than once.
-- Run AFTER 001-024 (needs contribution_scopes from 012 and sector_robot_types from 024). NOT applied automatically.
-- Review, take a fresh backup, then run it yourself, e.g.:
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 025          (dry run)
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 025 --apply
-- Undo: db/rollback/025_down.sql (refuses while any contribution has a robot chosen: see the note there).
--
-- WHAT IT IS. From plugin 0.1.11 the Contribute form asks, for each chosen sector that has robot types, "Which robot is it about?"
-- (optional, "Not sure" by default), using the robot types administrators keep in Sector forms (024).
--   * contribution_scopes.robot_type_id: the robot chosen for THAT sector of the contribution; NULL = "Not sure" (or not asked).
--     The link (robot_type_id, sector_id) -> sector_robot_types (id, sector_id) makes sure the robot belongs to the same sector. A
--     robot type that has been chosen cannot be deleted (robot types are never deleted anyway; switching one off is allowed).
--   * contributions.from_robot_page: true = the form was opened from a robot card ("Contribute about <robot>", ?robot=), so it
--     showed that robot as fixed text. Set once when the contribution is created; Edit uses it to look the same way.
-- Robot choices are private like the rest of a contribution: the owner and the reviewers see them, nothing public shows them.
-- The application also works BEFORE this migration is applied: the form's robot answers are not saved, and nothing shows a robot.

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

-- (id, sector_id) is unique already because id is; this states it so the link below can name both columns.
-- Both constraints below are looked up on the very table this file changes ('<table>'::regclass names one table in one schema, the
-- same one the ALTER TABLE reaches), so a constraint of the same name on any other table or in any other schema does not count.
-- A constraint of that name on the right table but with a different definition was not made by this file: it stops the migration
-- (nothing is changed) instead of being taken for this one.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'sector_robot_types'::regclass AND conname = 'sector_robot_types_id_sector_uq') THEN
    ALTER TABLE sector_robot_types ADD CONSTRAINT sector_robot_types_id_sector_uq UNIQUE (id, sector_id);
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'sector_robot_types'::regclass AND c.conname = 'sector_robot_types_id_sector_uq' AND c.contype = 'u'
       AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                   JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum ORDER BY k.ord) = ARRAY['id', 'sector_id']) THEN
    RAISE EXCEPTION 'sector_robot_types already has a constraint named sector_robot_types_id_sector_uq that is not UNIQUE (id, sector_id). This migration did not make it; look at it before running 025 again. Nothing was changed.';
  END IF;
END $$;

ALTER TABLE contribution_scopes ADD COLUMN IF NOT EXISTS robot_type_id integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'contribution_scopes'::regclass AND conname = 'contribution_scopes_robot_fk') THEN
    ALTER TABLE contribution_scopes ADD CONSTRAINT contribution_scopes_robot_fk
      FOREIGN KEY (robot_type_id, sector_id) REFERENCES sector_robot_types (id, sector_id) ON DELETE RESTRICT;
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'contribution_scopes'::regclass AND c.conname = 'contribution_scopes_robot_fk' AND c.contype = 'f'
       AND c.confrelid = 'sector_robot_types'::regclass AND c.confdeltype = 'r'
       AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                   JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum ORDER BY k.ord) = ARRAY['robot_type_id', 'sector_id']
       AND ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
                   JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum ORDER BY k.ord) = ARRAY['id', 'sector_id']) THEN
    RAISE EXCEPTION 'contribution_scopes already has a constraint named contribution_scopes_robot_fk that is not the link (robot_type_id, sector_id) to sector_robot_types (id, sector_id) ON DELETE RESTRICT. This migration did not make it; look at it before running 025 again. Nothing was changed.';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS contribution_scopes_robot_idx ON contribution_scopes (robot_type_id) WHERE robot_type_id IS NOT NULL;

ALTER TABLE contributions ADD COLUMN IF NOT EXISTS from_robot_page boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN contribution_scopes.robot_type_id IS
  'P3: the robot this contribution is about in this sector (a robot type of the same sector, 024). NULL = Not sure / not asked.';
COMMENT ON COLUMN contributions.from_robot_page IS
  'P3: the form was opened from a robot card (?robot=) and showed that robot as fixed text. Set once at creation; Edit looks the same way.';

COMMIT;
