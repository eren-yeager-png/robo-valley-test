-- RoboValley migration 030: the Contribution Portal's data (Phase B of the Contribution Portal).
-- ADDITIVE ONLY: new columns (NULL, or with a default), new tables, two new triggers, one widened check (same name) and a backfill that
-- fills ONLY the new columns and the new tables. Nothing is dropped or renamed, and no value an earlier migration stores is changed,
-- with one deliberate exception that keeps old and new code working side by side:
--   * sector_robot_types.status (new) starts as is_active says (on = active, off = hidden), and a trigger keeps the two in step from
--     then on, so code that only knows is_active (the application before this migration's code is deployed, and the WordPress
--     plugin's form) keeps working, and an archived field is switched off for that code too.
-- The fields of a sector ARE its robot types (sector_robot_types, migration 024); "field" below means a robot type.
--
-- What it adds:
--   sectors            + icon (a short symbol, e.g. an emoji), color (#RRGGBB), archived_at (an archived sector is also switched off:
--                        is_active = false, so every list members see already leaves it out). slug and sort_order exist since 012.
--   sector_robot_types + description, icon, source ('admin' | 'member' | 'plugin'), plugin_key (the plugin that manages it), status
--                        ('active' | 'hidden' | 'archived'), created_by. UNIQUE (sector_id, slug) and sort_order exist since 024.
--                        The database refuses to delete a field a plugin manages (a trigger) or one a contribution uses (the
--                        current form's link since 025, and the new cw_contributions.field_id link): those can only be archived.
--   field_suggestions  a member's "suggest a field" as its own record: pending, approved (with the field it became) or rejected (with
--                        the reason); who sent it, who edited it, who decided, and when.
--   cw_contributions   + field_id, reject_reason, edited_by, approved_by, approved_at, publish_requested_at, published_by
--                        (published_at exists since 027), and the status 'approved': a Moderator approved the idea (as it was, or
--                        edited); sending the publishing request to an Admin is its own step. field_id is kept by a trigger from the
--                        idea's current version (its sector and robot type); "not sure" = NULL, shown as "General".
--   plugins, plugin_fields   the registry of fields that WordPress plugins add (UNIQUE (plugin_key, sector_id, field_slug)). Filled
--                        from the plugin's release on (Phase C); a plugin can never publish, approve, reject or edit a contribution.
--   moderator_sectors  the sectors a moderator reviews. No row for a moderator = every sector, exactly as before this migration.
--   audit_log          who did what, to what and when (append only), indexed on (target_type, target_id) and on (at).
--
-- The contributions sent with the CURRENT form (table contributions, 012-026) get no new columns: what the portal needs is recorded
-- there already and is read from where it lives: the field per chosen sector (contribution_scopes.robot_type_id, 025), and who
-- verified (approved), when the item went to an Admin, who published it and the rejection reason (contribution_reviews, 017-019,
-- append only). Their statuses keep their meaning; the portal shows them with its own labels (public/cw/js/portal-status.js).
--
-- Backfill (only what the data already says; existing ids are kept; sort_order is already the order shown, so nothing is renumbered):
--   * every field's status from is_active;
--   * every Share Your Idea "Suggestion" about the page "Robots by Sector › <Sector>" becomes a suggestion of that sector: approved
--     (linked to the field) when the sector has a field of that name and the idea was not rejected, rejected (with the reason) when
--     the idea was, otherwise pending. Its slug is made from the name. A field made from an approved suggestion gets source 'member';
--     every other field stays 'admin' (no field is a plugin's yet);
--   * the new idea columns from the versions, the history and the decisions already recorded (approved_by / approved_at /
--     publish_requested_at = the latest Moderator version: before this migration approving and sending the request were one step);
--   * one audit row per past approval and publication (both kinds of contributions; demo records left out), or one
--     "Migrated from legacy data" row when there is none. This runs once (its rows are marked "backfill": "030").
--
-- Safe to run twice: IF NOT EXISTS everywhere, constraints and triggers only when missing, ON CONFLICT DO NOTHING, and the backfill
-- runs only the FIRST time 030 is applied (decided at the start: audit_log does not exist yet), so a second run changes no row at all.
-- After the rollback a new run is a first run again. One transaction: all or nothing. Run AFTER 029.
-- NOT applied automatically (the project's guarded runner; take a fresh backup first). Review it, then run it yourself, e.g.:
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 030          (dry run)
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 030 --apply
-- Deploy the code soon after applying 030: the new code records each "suggest a field" when it is sent (one sent in between stays
-- in Moderation as an idea).
-- Undo: db/rollback/030_down.sql (takes everything this file added away again; refuses while something entered after it would be lost).
-- Before this migration the application keeps working (Phase A): the screens show what they can, and the new actions answer
-- "not set up yet" without changing anything.

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
  IF to_regclass('sector_robot_types') IS NULL OR to_regclass('contribution_reviews') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'contribution_scopes' AND column_name = 'robot_type_id') THEN
    RAISE EXCEPTION 'Earlier migrations are missing (017, 024, 025): apply 001 to 029 first. Nothing was changed.';
  END IF;
  IF to_regclass('cw_contributions') IS NULL OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'cw_contributions' AND column_name = 'is_demo') THEN
    RAISE EXCEPTION 'Migrations 027 to 029 are missing (cw_contributions.is_demo): apply them first. Nothing was changed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'cw_contributions'::regclass AND conname = 'cw_contributions_status_ck'
                 AND pg_get_constraintdef(oid) LIKE '%''unpublished''%') THEN
    RAISE EXCEPTION 'Migration 028 is missing (the Unpublished status): apply it first. Nothing was changed.';
  END IF;
END $$;

-- The backfill runs only on 030's first application: before anything below is created, audit_log does not exist yet. A second run
-- (or a forced rerun) sees audit_log and changes no row; after the rollback (which drops audit_log) a new run is a first run again.
SELECT set_config('rv.backfill_030', CASE WHEN to_regclass('audit_log') IS NULL THEN 'on' ELSE 'off' END, true);

-- ---------------------------------------------------------------------------------------------------------------- the plugin registry
-- First, because a field managed by a plugin points at its plugin.
CREATE TABLE IF NOT EXISTS plugins (
  id             integer      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plugin_key     varchar(60)  NOT NULL,
  name           varchar(100) NOT NULL,
  version        varchar(30)  NOT NULL DEFAULT '',
  description    varchar(500) NOT NULL DEFAULT '',
  enabled        boolean      NOT NULL DEFAULT true,
  installed_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  uninstalled_at timestamptz,
  CONSTRAINT plugins_key_uq UNIQUE (plugin_key),
  CONSTRAINT plugins_key_ck CHECK (plugin_key ~ '^[a-z0-9]+([_-][a-z0-9]+)*$'),
  CONSTRAINT plugins_name_ck CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  CONSTRAINT plugins_state_ck CHECK (uninstalled_at IS NULL OR NOT enabled)
);

CREATE TABLE IF NOT EXISTS plugin_fields (
  id            integer      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plugin_key    varchar(60)  NOT NULL REFERENCES plugins (plugin_key) ON DELETE RESTRICT,
  sector_id     integer      NOT NULL REFERENCES sectors (id) ON DELETE RESTRICT,
  field_slug    varchar(60)  NOT NULL,
  field_name    varchar(80)  NOT NULL,
  description   varchar(500) NOT NULL DEFAULT '',
  field_id      integer      REFERENCES sector_robot_types (id) ON DELETE SET NULL,  -- the field it made; NULL while skipped
  state         varchar(10)  NOT NULL DEFAULT 'created',                          -- created, or skipped (an admin field has that slug)
  note          varchar(300),
  registered_at timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT plugin_fields_uq UNIQUE (plugin_key, sector_id, field_slug),
  CONSTRAINT plugin_fields_slug_ck CHECK (field_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT plugin_fields_name_ck CHECK (char_length(btrim(field_name)) BETWEEN 2 AND 80),
  CONSTRAINT plugin_fields_state_ck CHECK (state IN ('created', 'skipped'))
);
CREATE INDEX IF NOT EXISTS plugin_fields_field_idx ON plugin_fields (field_id) WHERE field_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------- sectors
ALTER TABLE sectors ADD COLUMN IF NOT EXISTS icon varchar(16);
ALTER TABLE sectors ADD COLUMN IF NOT EXISTS color varchar(7);
ALTER TABLE sectors ADD COLUMN IF NOT EXISTS archived_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'sectors'::regclass AND conname = 'sectors_style_ck') THEN
    ALTER TABLE sectors ADD CONSTRAINT sectors_style_ck CHECK ((color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$')
      AND (icon IS NULL OR (char_length(icon) BETWEEN 1 AND 8 AND icon !~ '[<>&"[:space:]]')));
  END IF;
  -- an archived sector is switched off, so the member lists (which read is_active) leave it out with no change to their code
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'sectors'::regclass AND conname = 'sectors_archived_ck') THEN
    ALTER TABLE sectors ADD CONSTRAINT sectors_archived_ck CHECK (archived_at IS NULL OR NOT is_active);
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------- fields (robot types)
ALTER TABLE sector_robot_types ADD COLUMN IF NOT EXISTS description varchar(500);
ALTER TABLE sector_robot_types ADD COLUMN IF NOT EXISTS icon varchar(16);
ALTER TABLE sector_robot_types ADD COLUMN IF NOT EXISTS source varchar(10) NOT NULL DEFAULT 'admin';
ALTER TABLE sector_robot_types ADD COLUMN IF NOT EXISTS plugin_key varchar(60);
ALTER TABLE sector_robot_types ADD COLUMN IF NOT EXISTS status varchar(10) NOT NULL DEFAULT 'active';
ALTER TABLE sector_robot_types ADD COLUMN IF NOT EXISTS created_by bigint REFERENCES users (id) ON DELETE SET NULL;

-- the status from is_active (only rows that still disagree: on a second run there are none)
UPDATE sector_robot_types SET status = 'hidden' WHERE NOT is_active AND status = 'active' AND current_setting('rv.backfill_030') = 'on';

-- status and is_active stay in step whichever of the two a piece of code writes:
--   status written           -> is_active = (status = 'active')
--   only is_active written   -> on = active; off = hidden, or archived when it was archived
CREATE OR REPLACE FUNCTION rv_field_status_sync() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'active' THEN
      NEW.is_active := false;
    ELSIF NOT NEW.is_active THEN
      NEW.status := 'hidden';
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.is_active := (NEW.status = 'active');
  ELSIF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    NEW.status := CASE WHEN NEW.is_active THEN 'active' WHEN OLD.status = 'archived' THEN 'archived' ELSE 'hidden' END;
  END IF;
  RETURN NEW;
END
$fn$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'sector_robot_types'::regclass AND tgname = 'sector_robot_types_status_sync') THEN
    CREATE TRIGGER sector_robot_types_status_sync BEFORE INSERT OR UPDATE OF is_active, status ON sector_robot_types
      FOR EACH ROW EXECUTE FUNCTION rv_field_status_sync();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'sector_robot_types'::regclass AND conname = 'sector_robot_types_status_ck') THEN
    ALTER TABLE sector_robot_types ADD CONSTRAINT sector_robot_types_status_ck CHECK (status IN ('active', 'hidden', 'archived') AND is_active = (status = 'active'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'sector_robot_types'::regclass AND conname = 'sector_robot_types_source_ck') THEN
    ALTER TABLE sector_robot_types ADD CONSTRAINT sector_robot_types_source_ck CHECK (source IN ('admin', 'member', 'plugin') AND (plugin_key IS NULL) = (source <> 'plugin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'sector_robot_types'::regclass AND conname = 'sector_robot_types_icon_ck') THEN
    ALTER TABLE sector_robot_types ADD CONSTRAINT sector_robot_types_icon_ck CHECK (icon IS NULL OR (char_length(icon) BETWEEN 1 AND 8 AND icon !~ '[<>&"[:space:]]'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'sector_robot_types'::regclass AND conname = 'sector_robot_types_plugin_fk') THEN
    ALTER TABLE sector_robot_types ADD CONSTRAINT sector_robot_types_plugin_fk FOREIGN KEY (plugin_key) REFERENCES plugins (plugin_key) ON DELETE RESTRICT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS sector_robot_types_plugin_idx ON sector_robot_types (plugin_key) WHERE plugin_key IS NOT NULL;

-- A field a plugin manages is never deleted, by anyone: it can only be hidden or archived (uninstalling the plugin archives it).
CREATE OR REPLACE FUNCTION rv_field_keep_plugin() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.source = 'plugin' THEN
    RAISE EXCEPTION 'rv_field_keep_plugin: field % is managed by the plugin "%" and is never deleted (hide or archive it instead)', OLD.id, OLD.plugin_key
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END
$fn$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'sector_robot_types'::regclass AND tgname = 'sector_robot_types_keep_plugin') THEN
    CREATE TRIGGER sector_robot_types_keep_plugin BEFORE DELETE ON sector_robot_types FOR EACH ROW EXECUTE FUNCTION rv_field_keep_plugin();
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------- suggested fields
CREATE TABLE IF NOT EXISTS field_suggestions (
  id                bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sector_id         integer       NOT NULL REFERENCES sectors (id) ON DELETE RESTRICT,
  name              varchar(80)   NOT NULL,
  slug              varchar(60)   NOT NULL,
  description       varchar(2000) NOT NULL DEFAULT '',                         -- the member's reason
  suggested_by      bigint        REFERENCES users (id) ON DELETE SET NULL,
  suggested_by_name varchar(150)  NOT NULL DEFAULT '',                         -- the name when it was sent (an account can go)
  contribution_id   bigint        REFERENCES cw_contributions (id) ON DELETE SET NULL,  -- the Share Your Idea "Suggestion" it came from
  status            varchar(10)   NOT NULL DEFAULT 'pending',
  reject_reason     varchar(2000),
  edited_by         bigint        REFERENCES users (id) ON DELETE SET NULL,
  decided_by        bigint        REFERENCES users (id) ON DELETE SET NULL,
  field_id          integer       REFERENCES sector_robot_types (id) ON DELETE SET NULL,  -- the field an approved suggestion became
  sent_at           timestamptz   NOT NULL DEFAULT now(),
  decided_at        timestamptz,
  CONSTRAINT field_suggestions_status_ck CHECK (status IN ('pending', 'approved', 'rejected') AND (status = 'pending') = (decided_at IS NULL)),
  CONSTRAINT field_suggestions_reason_ck CHECK (status <> 'rejected' OR char_length(btrim(coalesce(reject_reason, ''))) >= 1),
  CONSTRAINT field_suggestions_slug_ck CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT field_suggestions_name_ck CHECK (char_length(btrim(name)) BETWEEN 2 AND 80)
);
CREATE UNIQUE INDEX IF NOT EXISTS field_suggestions_contribution_uq ON field_suggestions (contribution_id) WHERE contribution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS field_suggestions_sector_idx ON field_suggestions (sector_id, status, sent_at DESC);

-- ---------------------------------------------------------------------------------------------------------------- Share Your Idea ideas
-- RESTRICT: a field an idea uses cannot be deleted (the portal offers Archive instead); the database refuses too
ALTER TABLE cw_contributions ADD COLUMN IF NOT EXISTS field_id integer REFERENCES sector_robot_types (id) ON DELETE RESTRICT;
ALTER TABLE cw_contributions ADD COLUMN IF NOT EXISTS reject_reason varchar(2000);
ALTER TABLE cw_contributions ADD COLUMN IF NOT EXISTS edited_by bigint REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE cw_contributions ADD COLUMN IF NOT EXISTS approved_by bigint REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE cw_contributions ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE cw_contributions ADD COLUMN IF NOT EXISTS publish_requested_at timestamptz;
ALTER TABLE cw_contributions ADD COLUMN IF NOT EXISTS published_by bigint REFERENCES users (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS cw_contributions_field_idx ON cw_contributions (field_id) WHERE field_id IS NOT NULL;

DO $$
BEGIN
  -- 028's list plus 'approved' (same name; re-created only while it does not allow 'approved' yet)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'cw_contributions'::regclass AND conname = 'cw_contributions_status_ck'
                 AND pg_get_constraintdef(oid) LIKE '%''approved''%') THEN
    ALTER TABLE cw_contributions DROP CONSTRAINT IF EXISTS cw_contributions_status_ck;
    ALTER TABLE cw_contributions ADD CONSTRAINT cw_contributions_status_ck CHECK (status IN ('submitted', 'under_review', 'draft', 'approved', 'pending',
      'changes_requested', 'resubmitted', 'publishing', 'published', 'failed', 'rejected', 'unpublished'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'cw_contributions'::regclass AND conname = 'cw_contributions_approved_ck') THEN
    ALTER TABLE cw_contributions ADD CONSTRAINT cw_contributions_approved_ck CHECK (status <> 'approved' OR approved_at IS NOT NULL);
  END IF;
END $$;

-- field_id follows the idea's current version (its sector and robot type); "not sure" or an unknown robot = NULL ("General")
CREATE OR REPLACE FUNCTION cw_field_of() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.field_id := (SELECT r.id FROM sector_robot_types r JOIN sectors s ON s.id = r.sector_id
                    WHERE s.slug = NEW.proposed->>'sector' AND r.slug = NEW.proposed->>'robotType' LIMIT 1);
  RETURN NEW;
END
$fn$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'cw_contributions'::regclass AND tgname = 'cw_contributions_field') THEN
    CREATE TRIGGER cw_contributions_field BEFORE INSERT OR UPDATE OF proposed ON cw_contributions FOR EACH ROW EXECUTE FUNCTION cw_field_of();
  END IF;
END $$;

-- the backfill of the new idea columns (each only where still empty; the original submission is not touched, so 027's trigger allows it)
UPDATE cw_contributions c SET field_id = r.id
  FROM sector_robot_types r JOIN sectors s ON s.id = r.sector_id
 WHERE c.field_id IS NULL AND s.slug = c.proposed->>'sector' AND r.slug = c.proposed->>'robotType' AND current_setting('rv.backfill_030') = 'on';

UPDATE cw_contributions c SET reject_reason = f.text
  FROM (SELECT DISTINCT ON (contribution_id) contribution_id, text FROM cw_contribution_feedback
         WHERE type IN ('decline', 'reject') ORDER BY contribution_id, id DESC) f
 WHERE c.reject_reason IS NULL AND c.status = 'rejected' AND f.contribution_id = c.id AND current_setting('rv.backfill_030') = 'on';

UPDATE cw_contributions c SET approved_by = coalesce(c.approved_by, v.user_id), approved_at = coalesce(c.approved_at, v.created_at),
       publish_requested_at = coalesce(c.publish_requested_at, v.created_at)
  FROM (SELECT DISTINCT ON (x.contribution_id) x.contribution_id, u.id AS user_id, x.created_at
          FROM cw_contribution_versions x LEFT JOIN users u ON u.id = x.by_user_id
         WHERE x.role = 'Moderator' ORDER BY x.contribution_id, x.v DESC) v
 WHERE v.contribution_id = c.id AND c.status <> 'approved' AND (c.approved_at IS NULL OR c.publish_requested_at IS NULL) AND current_setting('rv.backfill_030') = 'on';

UPDATE cw_contributions c SET edited_by = e.user_id
  FROM (SELECT DISTINCT ON (x.contribution_id) x.contribution_id, u.id AS user_id
          FROM cw_contribution_versions x JOIN cw_contributions o ON o.id = x.contribution_id JOIN users u ON u.id = x.by_user_id
         WHERE x.data IS DISTINCT FROM o.original ORDER BY x.contribution_id, x.v DESC) e
 WHERE c.edited_by IS NULL AND e.contribution_id = c.id AND current_setting('rv.backfill_030') = 'on';

-- who published: the "Published v<n> ..." line is written by "System"; the Admin is the one whose "Clicked Publish" came just before it
UPDATE cw_contributions c SET published_by = h.user_id
  FROM (SELECT DISTINCT ON (x.contribution_id) x.contribution_id, u.id AS user_id
          FROM cw_contribution_history x
          JOIN LATERAL (SELECT k.actor_user_id FROM cw_contribution_history k WHERE k.contribution_id = x.contribution_id AND k.id < x.id
                         AND k.text LIKE 'Clicked Publish%' ORDER BY k.id DESC LIMIT 1) k ON true
          JOIN users u ON u.id = k.actor_user_id
         WHERE x.text LIKE 'Published v%' ORDER BY x.contribution_id, x.id DESC) h
 WHERE c.published_by IS NULL AND c.published_at IS NOT NULL AND h.contribution_id = c.id AND current_setting('rv.backfill_030') = 'on';

-- the suggested fields sent so far (a "Suggestion" about "Robots by Sector › <Sector>"), each once (by the idea's id)
INSERT INTO field_suggestions (sector_id, name, slug, description, suggested_by, suggested_by_name, contribution_id, status, reject_reason, field_id, sent_at, decided_at)
SELECT s.id, x.name,
       coalesce(nullif(rtrim(left(btrim(regexp_replace(lower(x.name), '[^a-z0-9]+', '-', 'g'), '-'), 60), '-'), ''), 'robot'),
       x.description, u.id, x.contributor_name, x.id,
       CASE WHEN x.status = 'rejected' THEN 'rejected' WHEN f.id IS NOT NULL THEN 'approved' ELSE 'pending' END,
       CASE WHEN x.status = 'rejected' THEN coalesce(fb.text, 'Rejected before the data update.') END,
       CASE WHEN x.status <> 'rejected' THEN f.id END,
       x.submitted_at,
       CASE WHEN x.status = 'rejected' THEN coalesce(fb.created_at, x.updated_at) WHEN f.id IS NOT NULL THEN greatest(f.created_at, x.submitted_at) END
  FROM (SELECT c.id, c.user_id, c.contributor_name, c.status, c.submitted_at, c.updated_at,
               left(btrim(regexp_replace(coalesce(c.original->>'title', ''), '\s+', ' ', 'g')), 80) AS name,
               left(coalesce(c.original->>'description', ''), 2000) AS description,
               btrim(substr(c.resource->>'path', char_length('Robots by Sector › ') + 1)) AS sector_name
          FROM cw_contributions c
         WHERE c.kind = 'Suggestion' AND left(c.resource->>'path', char_length('Robots by Sector › ')) = 'Robots by Sector › ') x
  JOIN sectors s ON lower(s.name) = lower(x.sector_name) AND NOT s.is_demo
  LEFT JOIN users u ON u.id = x.user_id
  LEFT JOIN LATERAL (SELECT r.id, r.created_at FROM sector_robot_types r
                      WHERE r.sector_id = s.id AND lower(regexp_replace(r.name, '\s+', ' ', 'g')) = lower(x.name) ORDER BY r.id LIMIT 1) f ON true
  LEFT JOIN LATERAL (SELECT fd.text, fd.created_at FROM cw_contribution_feedback fd
                      WHERE fd.contribution_id = x.id AND fd.type IN ('decline', 'reject') ORDER BY fd.id DESC LIMIT 1) fb ON true
 WHERE char_length(x.name) >= 2 AND current_setting('rv.backfill_030') = 'on'
 ORDER BY x.submitted_at, x.id  -- a fixed order: the same ids every time (also after the rollback and a re-run)
ON CONFLICT (contribution_id) WHERE contribution_id IS NOT NULL DO NOTHING;

-- a field made from an approved suggestion was suggested by a member
UPDATE sector_robot_types r SET source = 'member'
 WHERE r.source = 'admin' AND EXISTS (SELECT 1 FROM field_suggestions fs WHERE fs.field_id = r.id AND fs.status = 'approved') AND current_setting('rv.backfill_030') = 'on';

-- ---------------------------------------------------------------------------------------------------------------- moderators per sector
CREATE TABLE IF NOT EXISTS moderator_sectors (
  user_id    bigint      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  sector_id  integer     NOT NULL REFERENCES sectors (id) ON DELETE CASCADE,
  created_by bigint      REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moderator_sectors_pkey PRIMARY KEY (user_id, sector_id)
);
CREATE INDEX IF NOT EXISTS moderator_sectors_sector_idx ON moderator_sectors (sector_id);

-- ---------------------------------------------------------------------------------------------------------------- the audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id          bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id    bigint,                                                -- no link: the log outlives accounts
  actor_name  varchar(150) NOT NULL DEFAULT '',
  actor_role  varchar(20)  NOT NULL,
  action      varchar(40)  NOT NULL,
  target_type varchar(30)  NOT NULL,
  target_id   bigint,
  meta        jsonb        NOT NULL DEFAULT '{}'::jsonb,
  at          timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT audit_log_role_ck CHECK (actor_role IN ('admin', 'moderator', 'contributor', 'plugin', 'system')),
  CONSTRAINT audit_log_action_ck CHECK (action ~ '^[a-z][a-z_]{1,39}$'),
  CONSTRAINT audit_log_target_ck CHECK (target_type ~ '^[a-z][a-z_]{1,29}$'),
  CONSTRAINT audit_log_meta_ck CHECK (jsonb_typeof(meta) = 'object')
);
CREATE INDEX IF NOT EXISTS audit_log_target_idx ON audit_log (target_type, target_id);
CREATE INDEX IF NOT EXISTS audit_log_at_idx ON audit_log (at);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'audit_log'::regclass AND tgname = 'audit_log_append_only') THEN
    CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION cw_append_only();
  END IF;
END $$;

-- one row per past approval and publication (first run only; demo records left out); none at all = one "Migrated from legacy data" row
DO $$
DECLARE
  n bigint;
  total bigint := 0;
BEGIN
  IF current_setting('rv.backfill_030') <> 'on' OR EXISTS (SELECT 1 FROM audit_log WHERE meta->>'backfill' = '030') THEN
    RETURN;
  END IF;
  -- Share Your Idea: each Moderator version = approved and sent for publishing (one step before this migration)
  INSERT INTO audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, meta, at)
  SELECT v.by_user_id, v.by_name, CASE WHEN u.role = 'admin' THEN 'admin' ELSE 'moderator' END, 'approve', 'idea', v.contribution_id,
         jsonb_build_object('backfill', '030', 'from', 'cw_contribution_versions', 'version', v.v), v.created_at
    FROM cw_contribution_versions v JOIN cw_contributions c ON c.id = v.contribution_id LEFT JOIN users u ON u.id = v.by_user_id
   WHERE v.role = 'Moderator' AND NOT c.is_demo
   ORDER BY v.created_at, v.contribution_id, v.v; -- a fixed order: the same ids every time
  GET DIAGNOSTICS n = ROW_COUNT;
  total := total + n;
  -- Share Your Idea: each publication ("Published v<n>" is written by "System"; the Admin clicked Publish just before it)
  INSERT INTO audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, meta, at)
  SELECT k.actor_user_id, coalesce(regexp_replace(k.actor, '\s*\([^)]*\)\s*$', ''), ''), 'admin', 'publish', 'idea', h.contribution_id,
         jsonb_build_object('backfill', '030', 'from', 'cw_contribution_history'), h.created_at
    FROM cw_contribution_history h JOIN cw_contributions c ON c.id = h.contribution_id
    LEFT JOIN LATERAL (SELECT x.actor_user_id, x.actor FROM cw_contribution_history x WHERE x.contribution_id = h.contribution_id AND x.id < h.id
                        AND x.text LIKE 'Clicked Publish%' ORDER BY x.id DESC LIMIT 1) k ON true
   WHERE h.text LIKE 'Published v%' AND NOT c.is_demo
   ORDER BY h.created_at, h.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  total := total + n;
  -- the current form: verified (approved for an Admin) and approved or published again (published)
  INSERT INTO audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, meta, at)
  SELECT r.reviewer_id, coalesce(u.full_name, ''), CASE WHEN u.role = 'admin' THEN 'admin' ELSE 'moderator' END,
         CASE WHEN r.action = 'verify' THEN 'approve' ELSE 'publish' END, 'contribution', r.contribution_id,
         jsonb_build_object('backfill', '030', 'from', 'contribution_reviews', 'decision', r.action), r.created_at
    FROM contribution_reviews r JOIN contributions c ON c.id = r.contribution_id LEFT JOIN users u ON u.id = r.reviewer_id
   WHERE r.action IN ('verify', 'approve', 'republish') AND NOT c.is_demo
   ORDER BY r.created_at, r.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  total := total + n;
  IF total = 0 THEN
    INSERT INTO audit_log (actor_role, action, target_type, meta)
    VALUES ('system', 'migrated', 'system', jsonb_build_object('backfill', '030', 'note', 'Migrated from legacy data'));
  END IF;
END $$;

COMMENT ON TABLE field_suggestions IS 'Contribution Portal: a member''s suggested field for a sector: pending, approved (field_id = the field it became) or rejected (with the reason).';
COMMENT ON TABLE plugins IS 'Contribution Portal: the WordPress plugins that add fields. Never deleted: uninstalling archives their fields and keeps every contribution.';
COMMENT ON TABLE plugin_fields IS 'Contribution Portal: each field a plugin registered for a sector; skipped (field_id NULL) when an admin field already has that slug.';
COMMENT ON TABLE moderator_sectors IS 'Contribution Portal: the sectors a moderator reviews. No row for a moderator = every sector.';
COMMENT ON TABLE audit_log IS 'Contribution Portal: who did what, to what and when. Append only.';
COMMENT ON COLUMN sector_robot_types.status IS 'active, hidden (switched off) or archived (kept for its contributions). Kept in step with is_active by a trigger.';
COMMENT ON COLUMN cw_contributions.field_id IS 'The field (robot type) of the current version, kept by a trigger. NULL = not sure ("General").';

COMMIT;
