-- RoboValley migration 012: contributions (sectors, contributions, contribution_scopes)
-- Part B, PR 1. Additive only: THREE new tables, their indexes and two guard triggers. It does not read, change or delete any
-- existing data, and it adds no row (the sector list is NOT seeded; sectors are added later by the owner). Safe to run more than once.
-- Run AFTER 001-010 (needs users). NOT applied automatically. Review, take a fresh backup, then run it yourself, e.g.:
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 012          (dry run)
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 012 --apply
-- Undo: db/rollback/012_down.sql (drops only the objects created here; WARNING: deletes any contributions saved after this ran).
--
-- NUMBERING: a different, not yet merged change also uses the number 011 (api_rate_limits). This file is 012 so the two cannot collide.
--
-- MODEL
--   sectors              the list of sectors the Contribute hub shows. Owned by the database (a sector is added with one row).
--   contributions        one submission by one signed-in user. type = one of the 14 types; status = draft -> pending_review ->
--                        (changes_requested <-> pending_review) -> published. is_demo marks sample rows; counts must exclude them.
--   contribution_scopes  which sector(s) a submission is about. Primary key (contribution_id, sector_id): a submission is
--                        in a sector at most once, so COUNT(DISTINCT contribution_id) per sector never counts it twice.
-- RULES IN THE DATABASE (the application checks the same things first and gives friendly messages)
--   * a submission that is not a draft must be in at least one sector, and its last sector cannot be removed;
--   * submitted_at is set exactly when a submission has left draft; published_at exactly when it is published.

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

CREATE TABLE IF NOT EXISTS sectors (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug        varchar(60)  NOT NULL UNIQUE,
  name        varchar(100) NOT NULL,
  sort_order  integer      NOT NULL DEFAULT 100,
  is_active   boolean      NOT NULL DEFAULT true,
  is_demo     boolean      NOT NULL DEFAULT false,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT sectors_slug_ck CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT sectors_name_ck CHECK (char_length(btrim(name)) BETWEEN 2 AND 100)
);

CREATE TABLE IF NOT EXISTS contributions (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      bigint       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         varchar(20)  NOT NULL,
  robot_type   varchar(60),
  title        varchar(150) NOT NULL,
  body         text         NOT NULL,
  status       varchar(20)  NOT NULL DEFAULT 'draft',
  is_demo      boolean      NOT NULL DEFAULT false,
  submitted_at timestamptz,
  published_at timestamptz,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT contributions_type_ck CHECK (type IN ('problem','discovered','experience','costs','resource','challenge','improve','rental','repairs','support','trial','learning','supplier','correct')),
  CONSTRAINT contributions_status_ck CHECK (status IN ('draft','pending_review','changes_requested','published')),
  CONSTRAINT contributions_robot_type_ck CHECK (robot_type IS NULL OR robot_type ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT contributions_title_ck CHECK (char_length(btrim(title)) BETWEEN 5 AND 150),
  CONSTRAINT contributions_body_ck CHECK (char_length(btrim(body)) BETWEEN 10 AND 4000),
  CONSTRAINT contributions_submitted_ck CHECK ((status = 'draft') = (submitted_at IS NULL)),
  CONSTRAINT contributions_published_ck CHECK ((status = 'published') = (published_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS contribution_scopes (
  contribution_id bigint  NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  sector_id       integer NOT NULL REFERENCES sectors(id) ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contribution_id, sector_id)
);

CREATE INDEX IF NOT EXISTS contributions_user_status_idx ON contributions (user_id, status);
-- the public counts only ever look at published, non-demo rows
CREATE INDEX IF NOT EXISTS contributions_public_idx ON contributions (id) WHERE status = 'published' AND NOT is_demo;
CREATE INDEX IF NOT EXISTS contribution_scopes_sector_idx ON contribution_scopes (sector_id, contribution_id);

CREATE OR REPLACE FUNCTION rv_contribution_needs_scope() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.status <> 'draft' AND NOT EXISTS (SELECT 1 FROM contribution_scopes WHERE contribution_id = NEW.id) THEN
    RAISE EXCEPTION 'A contribution must be in at least one sector before it is submitted.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION rv_scope_keep_last() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM contributions WHERE id = OLD.contribution_id AND status <> 'draft')
     AND NOT EXISTS (SELECT 1 FROM contribution_scopes WHERE contribution_id = OLD.contribution_id AND sector_id <> OLD.sector_id) THEN
    RAISE EXCEPTION 'A submitted contribution must keep at least one sector.' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END $fn$;

-- CREATE TRIGGER has no IF NOT EXISTS (and CREATE OR REPLACE TRIGGER needs PostgreSQL 14), so check the catalog first.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'contributions_needs_scope' AND tgrelid = 'contributions'::regclass) THEN
    CREATE TRIGGER contributions_needs_scope BEFORE INSERT OR UPDATE OF status ON contributions
      FOR EACH ROW EXECUTE FUNCTION rv_contribution_needs_scope();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'contribution_scopes_keep_last' AND tgrelid = 'contribution_scopes'::regclass) THEN
    CREATE TRIGGER contribution_scopes_keep_last BEFORE DELETE ON contribution_scopes
      FOR EACH ROW EXECUTE FUNCTION rv_scope_keep_last();
  END IF;
END $$;

COMMIT;
