-- Undo migration 015. Removes the two triggers, the audit function, the moderator_audit table and the users.is_moderator column.
--   npm run db:migrate -- --expect-db <database name> --file db/rollback/015_down.sql --apply
-- It REFUSES (and changes nothing) while anyone is a moderator (users.is_moderator = true) or the moderator audit trail has any row:
-- who was made a moderator, by whom and when is never deleted by an undo. Everyone's default (false = not a moderator) does not count.
-- To undo anyway, export the audit rows first, remove the flags and the audit rows on purpose, then run this file again.
-- It affects no existing role: users.role, passwords and every other column of users are NOT touched, and neither are contributions,
-- photos or contact details.
-- NOT run automatically and not in db/migrations, so the runner can never apply it by accident.
-- NOTE: migration 014's contact read query refers to users.is_moderator, so roll this back only together with the code that uses it
-- (or expect "column is_moderator does not exist" when a contact is read).
BEGIN;

DO $$
DECLARE
  expected text := nullif(current_setting('rv.expected_db', true), '');
  n bigint;
BEGIN
  IF expected IS NULL THEN
    RAISE EXCEPTION 'rv.expected_db is not set. Run this through "npm run db:migrate -- --expect-db <database name>". Nothing was changed.';
  END IF;
  IF current_database() <> expected THEN
    RAISE EXCEPTION 'Wrong database: connected to "%" but expected "%". Nothing was changed.', current_database(), expected;
  END IF;
  -- dynamic SQL: safe when the column or the table is already gone (a partly applied or partly rolled back database)
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('users') AND attname = 'is_moderator' AND attnum > 0 AND NOT attisdropped) THEN
    EXECUTE 'SELECT count(*) FROM users WHERE is_moderator' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION '% user(s) are moderators (users.is_moderator = true). Dropping the column would remove their moderator access without a record. Export the list first, remove the flags on purpose, then run this again. Nothing was changed.', n;
    END IF;
  END IF;
  IF to_regclass('moderator_audit') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM moderator_audit' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'moderator_audit holds % row(s) (who was made a moderator or had the flag removed, by whom and when). Dropping the table would delete that history. Export it first, delete it on purpose, then run this again. Nothing was changed.', n;
    END IF;
  END IF;
END $$;

DROP TRIGGER IF EXISTS users_moderator_audit_upd ON users;
DROP TRIGGER IF EXISTS users_moderator_audit_ins ON users;
DROP FUNCTION IF EXISTS rv_moderator_audit();
DROP TABLE IF EXISTS moderator_audit;
ALTER TABLE users DROP COLUMN IF EXISTS is_moderator;
COMMIT;
