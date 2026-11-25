-- Undo migration 016. Removes the unique-name index, and removes the seeded sector 'agriculture-dairy' ONLY if no contribution uses it.
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --file db/rollback/016_down.sql --apply
-- If any contribution is already filed under the sector, this STOPS with a plain message and changes nothing (the sector is not removed
-- and neither is the index): contributions are never deleted or detached by this undo. Not in db/migrations, so the runner never applies it by accident.
-- It removes the sector row only when 016 itself made it. A matching slug proves nothing: the row may have existed before 016 ran (016's
-- INSERT ... ON CONFLICT DO NOTHING then left it alone). The row counts as 016's only when BOTH hold:
--   * it still has exactly the values 016 inserts (slug, name, sort_order, is_active, is_demo): a row edited since is the owner's now;
--   * it was written in the same transaction that created 016's index sectors_name_lower_uq (the row's xmin equals the index's xmin in
--     pg_class): 016 creates both in one transaction, so a row that existed before 016, or was written later, has another xmin.
-- Any other row is kept, with a NOTICE (the index is still removed). After a dump and restore, a VACUUM FULL or a REINDEX of sectors the
-- two xmins no longer match and the row is kept as well: keeping the seeded row is harmless, deleting someone's row is not.
BEGIN;

DO $$
DECLARE
  expected text := nullif(current_setting('rv.expected_db', true), '');
BEGIN
  IF expected IS NULL THEN
    RAISE EXCEPTION 'rv.expected_db is not set. Run this through the migration runner with --expect-db <database name>. Nothing was changed.';
  END IF;
  IF current_database() <> expected THEN
    RAISE EXCEPTION 'Wrong database: connected to "%" but expected "%". Nothing was changed.', current_database(), expected;
  END IF;
  IF EXISTS (SELECT 1 FROM contribution_scopes cs JOIN sectors s ON s.id = cs.sector_id WHERE s.slug = 'agriculture-dairy') THEN
    RAISE EXCEPTION 'Contributions are already filed under Agriculture & Dairy, so it was not removed. Nothing was changed.';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM sectors s JOIN pg_class i ON i.oid = to_regclass('sectors_name_lower_uq')
     WHERE s.slug = 'agriculture-dairy' AND s.name = 'Agriculture & Dairy' AND s.sort_order = 10 AND s.is_active AND NOT s.is_demo
       AND s.xmin = i.xmin) THEN
    DELETE FROM sectors WHERE slug = 'agriculture-dairy';
  ELSIF EXISTS (SELECT 1 FROM sectors WHERE slug = 'agriculture-dairy') THEN
    RAISE NOTICE 'The sector agriculture-dairy was kept: migration 016 did not make it (it existed before 016 ran, or it was changed since).';
  END IF;
END $$;
DROP INDEX IF EXISTS sectors_name_lower_uq;
COMMIT;
