-- Rollback for migration 005. Removes ONLY the three tables it created (the uploaded school directory versions, their
-- rows and the upload audit log). No accounts or other data are touched. The pg_trgm extension is left in place.
-- NOT run automatically and not in db/migrations, so the runner can never apply it by accident.
--
--   npm run db:migrate -- --expect-db <database name> --file db/rollback/005_down.sql --apply
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

DROP TABLE IF EXISTS upload_audit_log;
DROP TABLE IF EXISTS service_dataset_rows;
DROP TABLE IF EXISTS service_datasets;

COMMIT;
