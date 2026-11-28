-- Undo migration 030: takes away everything it added (the new tables, columns, checks, triggers and functions) and puts back 028's
-- status check of cw_contributions (without 'approved').
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --file db/rollback/030_down.sql --apply
-- REFUSES, and changes nothing, while something entered after 030 would be lost or would no longer be valid:
--   * an idea in the Approved step (028's check does not allow it): send its publishing request, or move it back to the draft, first;
--   * an audit row written by the application (only the rows 030's own backfill made may go);
--   * a registered plugin; a moderator limited to some sectors (they would quietly review every sector again);
--   * a suggested field an Admin edited or decided after 030;
--   * a field with a description, an icon, the source 'plugin' or the status 'archived' (an archived field would only be switched off);
--   * a sector with an icon or a colour, or an archived sector (it would come back for members).
-- What goes without a word, because the same facts stay where they were recorded first: the backfilled suggestions (the Suggestion
-- ideas stay) and audit rows, the new columns of cw_contributions (versions, history and feedback stay), a field's source 'member'
-- and created_by (updated_by stays).
-- NOT run automatically and not in db/migrations, so the runner can never apply it by accident.
BEGIN;

DO $$
DECLARE
  expected text := nullif(current_setting('rv.expected_db', true), '');
  n bigint;
  has_col boolean;
BEGIN
  IF expected IS NULL THEN
    RAISE EXCEPTION 'rv.expected_db is not set. Run this through the migration runner with --expect-db <database name>. Nothing was changed.';
  END IF;
  IF current_database() <> expected THEN
    RAISE EXCEPTION 'Wrong database: connected to "%" but expected "%". Nothing was changed.', current_database(), expected;
  END IF;
  IF to_regclass('cw_contributions') IS NULL OR to_regclass('sector_robot_types') IS NULL THEN
    RAISE EXCEPTION 'The tables 030 changed are not there (027 or 024 is missing): nothing to undo here. Nothing was changed.';
  END IF;
  -- dynamic statements below: each one is safe when 030 was only partly applied
  EXECUTE 'SELECT count(*) FROM cw_contributions WHERE status = ''approved''' INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION '% idea(s) are in the Approved step. 028''s check would not allow them: send their publishing requests (or move them back to the draft) first. Nothing was changed.', n;
  END IF;
  IF to_regclass('audit_log') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM audit_log WHERE meta->>''backfill'' IS DISTINCT FROM ''030''' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION '% audit row(s) were written after 030. The Audit Log would be lost. Nothing was changed.', n;
    END IF;
  END IF;
  IF to_regclass('plugins') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM plugins' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION '% plugin(s) are registered. Their registry would be lost. Nothing was changed.', n;
    END IF;
  END IF;
  IF to_regclass('moderator_sectors') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM moderator_sectors' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION '% moderator sector assignment(s) exist. Those moderators would review every sector again. Nothing was changed.', n;
    END IF;
  END IF;
  IF to_regclass('field_suggestions') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM field_suggestions WHERE edited_by IS NOT NULL OR decided_by IS NOT NULL' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION '% suggested field(s) were edited or decided by an Admin after 030. Those decisions would be lost. Nothing was changed.', n;
    END IF;
  END IF;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'sector_robot_types' AND column_name = 'status') INTO has_col;
  IF has_col THEN
    EXECUTE 'SELECT count(*) FROM sector_robot_types WHERE description IS NOT NULL OR icon IS NOT NULL OR source = ''plugin'' OR status = ''archived''' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION '% field(s) have a description, an icon, a plugin or the Archived status. That would be lost. Nothing was changed.', n;
    END IF;
  END IF;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'sectors' AND column_name = 'archived_at') INTO has_col;
  IF has_col THEN
    EXECUTE 'SELECT count(*) FROM sectors WHERE icon IS NOT NULL OR color IS NOT NULL OR archived_at IS NOT NULL' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION '% sector(s) have an icon, a colour or are archived. That would be lost (an archived sector would come back for members). Nothing was changed.', n;
    END IF;
  END IF;
END $$;

-- the new tables (their indexes and triggers go with them)
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS moderator_sectors;
DROP TABLE IF EXISTS field_suggestions;

-- Share Your Idea ideas: the field trigger, the new columns, and 028's status check again
DROP TRIGGER IF EXISTS cw_contributions_field ON cw_contributions;
DROP FUNCTION IF EXISTS cw_field_of();
ALTER TABLE cw_contributions DROP CONSTRAINT IF EXISTS cw_contributions_approved_ck;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'cw_contributions'::regclass AND conname = 'cw_contributions_status_ck'
             AND pg_get_constraintdef(oid) LIKE '%''approved''%') THEN
    ALTER TABLE cw_contributions DROP CONSTRAINT cw_contributions_status_ck;
    ALTER TABLE cw_contributions ADD CONSTRAINT cw_contributions_status_ck CHECK (status IN ('submitted', 'under_review', 'draft', 'pending',
      'changes_requested', 'resubmitted', 'publishing', 'published', 'failed', 'rejected', 'unpublished'));
  END IF;
END $$;
DROP INDEX IF EXISTS cw_contributions_field_idx;
ALTER TABLE cw_contributions DROP COLUMN IF EXISTS field_id;
ALTER TABLE cw_contributions DROP COLUMN IF EXISTS reject_reason;
ALTER TABLE cw_contributions DROP COLUMN IF EXISTS edited_by;
ALTER TABLE cw_contributions DROP COLUMN IF EXISTS approved_by;
ALTER TABLE cw_contributions DROP COLUMN IF EXISTS approved_at;
ALTER TABLE cw_contributions DROP COLUMN IF EXISTS publish_requested_at;
ALTER TABLE cw_contributions DROP COLUMN IF EXISTS published_by;

-- fields: the triggers, checks and new columns (is_active, which the triggers kept in step, stays as it is)
DROP TRIGGER IF EXISTS sector_robot_types_status_sync ON sector_robot_types;
DROP TRIGGER IF EXISTS sector_robot_types_keep_plugin ON sector_robot_types;
DROP FUNCTION IF EXISTS rv_field_status_sync();
DROP FUNCTION IF EXISTS rv_field_keep_plugin();
ALTER TABLE sector_robot_types DROP CONSTRAINT IF EXISTS sector_robot_types_status_ck;
ALTER TABLE sector_robot_types DROP CONSTRAINT IF EXISTS sector_robot_types_source_ck;
ALTER TABLE sector_robot_types DROP CONSTRAINT IF EXISTS sector_robot_types_icon_ck;
ALTER TABLE sector_robot_types DROP CONSTRAINT IF EXISTS sector_robot_types_plugin_fk;
DROP INDEX IF EXISTS sector_robot_types_plugin_idx;
ALTER TABLE sector_robot_types DROP COLUMN IF EXISTS description;
ALTER TABLE sector_robot_types DROP COLUMN IF EXISTS icon;
ALTER TABLE sector_robot_types DROP COLUMN IF EXISTS source;
ALTER TABLE sector_robot_types DROP COLUMN IF EXISTS plugin_key;
ALTER TABLE sector_robot_types DROP COLUMN IF EXISTS status;
ALTER TABLE sector_robot_types DROP COLUMN IF EXISTS created_by;

-- the plugin registry (nothing points at it any more)
DROP TABLE IF EXISTS plugin_fields;
DROP TABLE IF EXISTS plugins;

-- sectors
ALTER TABLE sectors DROP CONSTRAINT IF EXISTS sectors_style_ck;
ALTER TABLE sectors DROP CONSTRAINT IF EXISTS sectors_archived_ck;
ALTER TABLE sectors DROP COLUMN IF EXISTS icon;
ALTER TABLE sectors DROP COLUMN IF EXISTS color;
ALTER TABLE sectors DROP COLUMN IF EXISTS archived_at;

COMMIT;
