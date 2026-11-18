-- RoboValley migration 024: each sector's robot types (sector_robot_types), entered by an administrator in Sector forms
-- Additive only: ONE new table and its indexes. Nothing is dropped, renamed or rewritten, and no existing row changes.
-- Safe to run more than once.
-- Run AFTER 001-023 (needs sectors and users from 012 / the base schema). It does not depend on 013-023. NOT applied automatically.
-- Review, take a fresh backup, then run it yourself, e.g.:
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 024          (dry run)
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 024 --apply
-- Undo: db/rollback/024_down.sql (refuses while any robot type exists: see the note there).
--
-- WHAT IT IS. P2: an administrator lists the robot types of each sector at /admin/sector-forms (for example "Drone sprayers" under
-- Agriculture & Dairy). The names are the headings of the robot cards on that sector's page on techytree.in, so the plugin can match
-- them later (P4: "Contribute about <robot>"). From P3 the Contribute form asks for one robot per chosen sector, optional, "Not sure"
-- by default; that choice is stored with the contribution in P3's own migration, not here.
--   * slug: the robot's link code (?robot=<slug> from P3). Made from the name when the robot is added and never changed afterwards,
--     so links keep working when the name is corrected. Unique within its sector.
--   * name: what members and reviewers read. Unique within its sector, ignoring capitals and extra spaces.
--   * is_active: false = switched off. Robot types are never deleted (the app has no way to): a switched-off robot is hidden from the
--     form, but contributions that already chose it keep showing it.
--   * updated_by: the administrator who last added or changed it (an id; the account can be deleted, the robot stays).
-- Nothing here is public by itself: the admin pages read it, and from P3 the form reads the active names of the chosen sectors.
-- The application also works BEFORE this migration is applied: Sector forms says the robot types are not set up yet, and nothing
-- else reads the table.

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

CREATE TABLE IF NOT EXISTS sector_robot_types (
  id          integer      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sector_id   integer      NOT NULL REFERENCES sectors (id) ON DELETE RESTRICT,
  slug        varchar(60)  NOT NULL,
  name        varchar(80)  NOT NULL,
  sort_order  integer      NOT NULL DEFAULT 100,
  is_active   boolean      NOT NULL DEFAULT true,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  updated_by  bigint       REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT sector_robot_types_slug_ck CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT sector_robot_types_name_ck CHECK (char_length(btrim(name)) BETWEEN 2 AND 80 AND name = btrim(name)),
  CONSTRAINT sector_robot_types_slug_uq UNIQUE (sector_id, slug)
);

-- One name per sector, whatever the capitals or spacing ("Drone sprayers" and "drone  Sprayers" are the same robot).
CREATE UNIQUE INDEX IF NOT EXISTS sector_robot_types_name_uq ON sector_robot_types (sector_id, lower(regexp_replace(name, '\s+', ' ', 'g')));
-- The order the manager and the form show them in.
CREATE INDEX IF NOT EXISTS sector_robot_types_order_idx ON sector_robot_types (sector_id, sort_order, id);

COMMENT ON TABLE sector_robot_types IS
  'P2: the robot types of each sector, entered by an administrator in Sector forms. Never deleted; is_active = false hides one from the form.';
COMMENT ON COLUMN sector_robot_types.slug IS 'Link code (?robot=<slug>), made from the name when added and never changed. Unique within the sector.';
COMMENT ON COLUMN sector_robot_types.name IS 'As on the robot card on the sector page. Unique within the sector, ignoring capitals and extra spaces.';

COMMIT;
