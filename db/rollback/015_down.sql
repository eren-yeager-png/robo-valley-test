-- Undo migration 015. Removes the two triggers, the audit function, the moderator_audit table and the users.is_moderator column.
--   npm run db:migrate -- --expect-db <database name> --file db/rollback/015_down.sql --apply
-- WARNING: this REMOVES ALL MODERATOR FLAGS (every moderator stops being one, and a moderator can no longer read contact details
-- that contributors chose to share) and DELETES the moderator audit trail. It affects no existing role: users.role, passwords and
-- every other column of users are NOT touched, and neither are contributions, photos or contact details.
-- NOT run automatically and not in db/migrations, so the runner can never apply it by accident.
-- NOTE: migration 014's contact read query refers to users.is_moderator, so roll this back only together with the code that uses it
-- (or expect "column is_moderator does not exist" when a contact is read).
BEGIN;

DO $$
DECLARE
  expected text := nullif(current_setting('rv.expected_db', true), '');
BEGIN
  IF expected IS NULL THEN
    RAISE EXCEPTION 'rv.expected_db is not set. Run this through "npm run db:migrate -- --expect-db <database name>". Nothing was changed.';
  END IF;
  IF current_database() <> expected THEN
    RAISE EXCEPTION 'Wrong database: connected to "%" but expected "%". Nothing was changed.', current_database(), expected;
  END IF;
END $$;

DROP TRIGGER IF EXISTS users_moderator_audit_upd ON users;
DROP TRIGGER IF EXISTS users_moderator_audit_ins ON users;
DROP FUNCTION IF EXISTS rv_moderator_audit();
DROP TABLE IF EXISTS moderator_audit;
ALTER TABLE users DROP COLUMN IF EXISTS is_moderator;
COMMIT;
