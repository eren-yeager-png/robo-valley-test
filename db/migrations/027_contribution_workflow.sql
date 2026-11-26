-- RoboValley migration 027: the Contribution Publishing Workflow (Share Your Idea form, Moderator Workspace, Admin Approval
-- Dashboard with Publish Preview, and the public Community Ideas page).
-- Additive only: SIX new tables (all named cw_...), their indexes, two functions and their triggers. Nothing is dropped, renamed
-- or rewritten, no existing row changes, and the existing contribution tables (012-026) are not touched: older contributions keep
-- living there and stay in the existing Moderation page. Safe to run more than once (every object is created only when missing).
-- Run AFTER 001-026 (it needs users; sectors and robot types are read by the app at run time, there is no link to them).
-- NOT applied automatically. Review, take a fresh backup, then run it yourself, e.g.:
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 027          (dry run)
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 027 --apply
-- Undo: db/rollback/027_down.sql (refuses while any contribution exists in the new tables).
--
-- WHAT IT IS
--   cw_contributions             one row per idea: RV-1025 and up (the identity starts at 1025). original, resource, reference_links,
--                                kind and the contributor are written ONCE (a trigger refuses any change); proposed is the version
--                                the Moderator works on. status follows the spec's status machine (kept by the app).
--   cw_contribution_versions     every version sent for publishing (Moderator) or edited (Admin). Append-only.
--   cw_contribution_feedback     Admin "request changes" and every rejection reason. Append-only.
--   cw_contribution_history      the activity history: who, when, what. Append-only.
--   cw_contribution_attachments  the optional photo or PDF (4 MB at most), private to Moderators and Admins. Written once.
--   cw_public_contributions      what the public website shows, one row per published contribution (upserted by id, so a retry or
--                                a double click never makes a second card). The public page reads ONLY this table.
-- The application works BEFORE this migration too: the new pages say the workflow is not set up yet; nothing else reads these tables.

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
  IF to_regclass('users') IS NULL THEN
    RAISE EXCEPTION 'The users table is missing: apply the earlier migrations first. Nothing was changed.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS cw_contributions (
  id                bigint GENERATED ALWAYS AS IDENTITY (START WITH 1025) PRIMARY KEY,
  user_id           bigint        REFERENCES users (id) ON DELETE SET NULL,  -- the member who submitted (kept even if the account goes)
  contributor_name  varchar(150)  NOT NULL,                                  -- from the profile at submission time
  contributor_type  varchar(10)   NOT NULL,                                  -- the stakeholder role code at submission time (ST, PA, ...)
  contributor_minor boolean       NOT NULL DEFAULT false,                    -- users.age_category = 'minor' at submission time
  kind              varchar(40)   NOT NULL,
  resource          jsonb,                                                   -- {feature, type, path, url, id, change} or NULL
  reference_links   jsonb         NOT NULL DEFAULT '[]'::jsonb,              -- [{url, remarks}]
  original          jsonb         NOT NULL,                                  -- {title, description, sector, robotType, categories, suitableFor, learningPath}
  proposed          jsonb         NOT NULL,                                  -- same shape, starts as a copy of original
  notes             varchar(2000) NOT NULL DEFAULT '',                       -- internal Moderator notes, never public
  status            varchar(20)   NOT NULL DEFAULT 'submitted',
  moderator_id      bigint        REFERENCES users (id) ON DELETE SET NULL,
  moderator_name    varchar(150),
  previewed_version integer,
  published_version integer,
  published_at      timestamptz,
  publish_error     varchar(500),
  publish_attempts  integer       NOT NULL DEFAULT 0,
  row_version       integer       NOT NULL DEFAULT 1,                        -- optimistic locking: every change adds 1
  submitted_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT cw_contributions_kind_ck CHECK (kind IN ('New idea', 'Modification', 'Suggestion', 'Enhancement of existing feature')),
  CONSTRAINT cw_contributions_status_ck CHECK (status IN ('submitted', 'under_review', 'draft', 'pending', 'changes_requested', 'resubmitted', 'publishing', 'published', 'failed', 'rejected')),
  CONSTRAINT cw_contributions_name_ck CHECK (char_length(btrim(contributor_name)) BETWEEN 1 AND 150),
  CONSTRAINT cw_contributions_shape_ck CHECK (jsonb_typeof(original) = 'object' AND jsonb_typeof(proposed) = 'object'
    AND jsonb_typeof(reference_links) = 'array' AND (resource IS NULL OR jsonb_typeof(resource) = 'object')),
  CONSTRAINT cw_contributions_counts_ck CHECK (publish_attempts >= 0 AND row_version >= 1
    AND (previewed_version IS NULL OR previewed_version >= 1) AND (published_version IS NULL OR published_version >= 1)),
  CONSTRAINT cw_contributions_published_ck CHECK (status <> 'published' OR published_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS cw_contributions_status_idx ON cw_contributions (status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS cw_contributions_user_idx ON cw_contributions (user_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS cw_contribution_versions (
  contribution_id bigint        NOT NULL REFERENCES cw_contributions (id) ON DELETE RESTRICT,
  v               integer       NOT NULL,
  by_user_id      bigint,                                                    -- no link: the history must outlive accounts
  by_name         varchar(150)  NOT NULL,
  role            varchar(10)   NOT NULL,
  data            jsonb         NOT NULL,
  notes           varchar(2000) NOT NULL DEFAULT '',
  created_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT cw_contribution_versions_pkey PRIMARY KEY (contribution_id, v),
  CONSTRAINT cw_contribution_versions_ck CHECK (v >= 1 AND role IN ('Moderator', 'Admin') AND jsonb_typeof(data) = 'object')
);

CREATE TABLE IF NOT EXISTS cw_contribution_feedback (
  id              bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contribution_id bigint        NOT NULL REFERENCES cw_contributions (id) ON DELETE RESTRICT,
  type            varchar(10)   NOT NULL,
  text            varchar(2000) NOT NULL,
  by_user_id      bigint,
  by_name         varchar(150)  NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT cw_contribution_feedback_ck CHECK (type IN ('changes', 'reject') AND char_length(btrim(text)) BETWEEN 1 AND 2000)
);
CREATE INDEX IF NOT EXISTS cw_contribution_feedback_item_idx ON cw_contribution_feedback (contribution_id, id);

CREATE TABLE IF NOT EXISTS cw_contribution_history (
  id              bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contribution_id bigint        NOT NULL REFERENCES cw_contributions (id) ON DELETE RESTRICT,
  actor           varchar(200)  NOT NULL,
  actor_user_id   bigint,
  text            varchar(4000) NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT cw_contribution_history_ck CHECK (char_length(btrim(actor)) >= 1 AND char_length(btrim(text)) >= 1)
);
CREATE INDEX IF NOT EXISTS cw_contribution_history_item_idx ON cw_contribution_history (contribution_id, id);

CREATE TABLE IF NOT EXISTS cw_contribution_attachments (
  contribution_id bigint       PRIMARY KEY REFERENCES cw_contributions (id) ON DELETE RESTRICT,
  file_name       varchar(200) NOT NULL,
  mime            varchar(40)  NOT NULL,
  byte_size       integer      NOT NULL,
  file_sha256     char(64)     NOT NULL,
  data            bytea        NOT NULL,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT cw_contribution_attachments_ck CHECK (mime IN ('image/jpeg', 'image/png', 'application/pdf')
    AND byte_size BETWEEN 1 AND 4194304 AND octet_length(data) = byte_size AND file_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS cw_public_contributions (
  contribution_id        bigint       PRIMARY KEY REFERENCES cw_contributions (id) ON DELETE RESTRICT,
  version                integer      NOT NULL,
  title                  varchar(150) NOT NULL,
  description            text         NOT NULL,
  sector_slug            varchar(60)  NOT NULL,
  sector_name            varchar(100) NOT NULL,
  robot_type_name        varchar(100) NOT NULL,
  categories             jsonb        NOT NULL DEFAULT '[]'::jsonb,
  suitable_for           jsonb        NOT NULL DEFAULT '[]'::jsonb,
  learning_path          varchar(40)  NOT NULL DEFAULT '',
  kind                   varchar(40)  NOT NULL,
  resource               jsonb,
  reference_links        jsonb        NOT NULL DEFAULT '[]'::jsonb,
  contributor_first_name varchar(150) NOT NULL,                              -- never the full name
  contributor_type       varchar(100) NOT NULL DEFAULT '',                   -- the role's label; shown or not by the app's setting
  contributor_minor      boolean      NOT NULL DEFAULT false,
  published_at           timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT cw_public_contributions_ck CHECK (version >= 1 AND jsonb_typeof(categories) = 'array' AND jsonb_typeof(suitable_for) = 'array'
    AND jsonb_typeof(reference_links) = 'array')
);
CREATE INDEX IF NOT EXISTS cw_public_contributions_sector_idx ON cw_public_contributions (sector_slug, published_at DESC);

-- The original submission is written once: no code path may change it, and the database refuses too (the account link may only be
-- cleared, by ON DELETE SET NULL when the account itself is deleted).
CREATE OR REPLACE FUNCTION cw_write_once() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.original IS DISTINCT FROM OLD.original OR NEW.resource IS DISTINCT FROM OLD.resource
     OR NEW.reference_links IS DISTINCT FROM OLD.reference_links OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.contributor_name IS DISTINCT FROM OLD.contributor_name OR NEW.contributor_type IS DISTINCT FROM OLD.contributor_type
     OR NEW.contributor_minor IS DISTINCT FROM OLD.contributor_minor OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
     OR (NEW.user_id IS DISTINCT FROM OLD.user_id AND NEW.user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'cw_write_once: the original submission of contribution % cannot be changed', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

-- History, versions, feedback and attachments are append-only.
CREATE OR REPLACE FUNCTION cw_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'cw_append_only: % rows are never changed or deleted', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END
$fn$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'cw_contributions'::regclass AND tgname = 'cw_contributions_write_once') THEN
    CREATE TRIGGER cw_contributions_write_once BEFORE UPDATE ON cw_contributions FOR EACH ROW EXECUTE FUNCTION cw_write_once();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'cw_contribution_versions'::regclass AND tgname = 'cw_contribution_versions_append_only') THEN
    CREATE TRIGGER cw_contribution_versions_append_only BEFORE UPDATE OR DELETE ON cw_contribution_versions FOR EACH ROW EXECUTE FUNCTION cw_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'cw_contribution_feedback'::regclass AND tgname = 'cw_contribution_feedback_append_only') THEN
    CREATE TRIGGER cw_contribution_feedback_append_only BEFORE UPDATE OR DELETE ON cw_contribution_feedback FOR EACH ROW EXECUTE FUNCTION cw_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'cw_contribution_history'::regclass AND tgname = 'cw_contribution_history_append_only') THEN
    CREATE TRIGGER cw_contribution_history_append_only BEFORE UPDATE OR DELETE ON cw_contribution_history FOR EACH ROW EXECUTE FUNCTION cw_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'cw_contribution_attachments'::regclass AND tgname = 'cw_contribution_attachments_append_only') THEN
    CREATE TRIGGER cw_contribution_attachments_append_only BEFORE UPDATE OR DELETE ON cw_contribution_attachments FOR EACH ROW EXECUTE FUNCTION cw_append_only();
  END IF;
END $$;

COMMIT;
