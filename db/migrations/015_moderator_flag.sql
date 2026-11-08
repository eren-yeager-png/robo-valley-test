-- RoboValley migration 015: the moderator flag (users.is_moderator) and its audit trail (moderator_audit)
-- Part B, PR 4. Additive only: ONE new column with a default, ONE new table, ONE function and two triggers. Nothing is dropped,
-- renamed or rewritten, and no existing row changes except that it gets the default (not a moderator). Safe to run more than once.
-- Run AFTER 001-014 (needs users). NOT applied automatically. Review, take a fresh backup, then run it yourself, e.g.:
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 015          (dry run)
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 015 --apply
-- Undo: db/rollback/015_down.sql (removes ALL moderator flags and the audit trail; it affects no existing role).
--
-- WHAT IT IS. A moderator is a FLAG on a user, not a new role: users.role is untouched and everyone keeps their role.
-- A moderator may read a contributor's private contact details ONLY when the contributor ticked "share with moderators"
-- (see migration 014 and src/lib/contributionContacts.ts). Being a moderator gives nothing else.
--
-- WHO CAN SET IT. Nobody can set it for themselves.
--   * The only application route that sets it is the admin-only API (POST /api/admin/moderators); it checks the caller is an admin.
--   * The profile and every other self-service route never mention the column (a test scans the source for that).
--   * A manual database step also works (and is audited too, with no admin id).
--   * The database refuses a change made on behalf of the same user: the trigger below raises an error when the admin id the
--     application recorded for the change equals the user being changed.
-- THE AUDIT. Every change of the flag (a grant or a removal, by the admin route or by hand) writes one moderator_audit row:
-- who changed it (admin id, NULL for a manual step), whose flag (user id), granted or removed, and when. Ids only: no names,
-- emails or other personal data are stored or logged.

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

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_moderator boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS moderator_audit (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id       bigint      REFERENCES users(id) ON DELETE SET NULL,   -- NULL = a manual database step (or the admin was later removed)
  target_user_id bigint      REFERENCES users(id) ON DELETE SET NULL,
  granted        boolean     NOT NULL,                                  -- true = made a moderator, false = flag removed
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moderator_audit_not_self_ck CHECK (admin_id IS NULL OR target_user_id IS NULL OR admin_id <> target_user_id)
);
CREATE INDEX IF NOT EXISTS moderator_audit_target_idx ON moderator_audit (target_user_id, created_at DESC);

-- Writes the audit row for a change of the flag, and refuses a change made on behalf of the same user.
-- The application sets rv.admin_id for the transaction (set_config(..., true)); a manual step leaves it unset.
CREATE OR REPLACE FUNCTION rv_moderator_audit() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  who bigint := nullif(current_setting('rv.admin_id', true), '')::bigint;
BEGIN
  IF who IS NOT NULL AND who = NEW.id THEN
    RAISE EXCEPTION 'Nobody can change their own moderator flag.' USING ERRCODE = '23514';
  END IF;
  INSERT INTO moderator_audit (admin_id, target_user_id, granted) VALUES (who, NEW.id, NEW.is_moderator);
  RETURN NEW;
END $fn$;

-- CREATE TRIGGER has no IF NOT EXISTS (and CREATE OR REPLACE TRIGGER needs PostgreSQL 14), so check the catalog first.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'users_moderator_audit_upd' AND tgrelid = 'users'::regclass) THEN
    CREATE TRIGGER users_moderator_audit_upd AFTER UPDATE OF is_moderator ON users
      FOR EACH ROW WHEN (OLD.is_moderator IS DISTINCT FROM NEW.is_moderator)
      EXECUTE FUNCTION rv_moderator_audit();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'users_moderator_audit_ins' AND tgrelid = 'users'::regclass) THEN
    CREATE TRIGGER users_moderator_audit_ins AFTER INSERT ON users
      FOR EACH ROW WHEN (NEW.is_moderator)
      EXECUTE FUNCTION rv_moderator_audit();
  END IF;
END $$;

COMMIT;
