-- Undo migration 012. Removes the contribution tables (and with them their triggers), then the two trigger functions.
--   npm run db:migrate -- --expect-db <database name> --file db/rollback/012_down.sql --apply
-- It REFUSES (and changes nothing) while any contribution, any sector choice of a contribution (contribution_scopes) or any sector
-- other than migration 016's untouched seed exists: members' work and the sectors the owner added are never deleted by an undo.
-- Only 016's own seed row does not count (it is removed with the table), and a matching slug is no proof that 016 made it. The row
-- counts as 016's seed only when it passes the same test rollback 016 uses: it still has exactly the values 016 inserts (slug, name,
-- sort_order, is_active, is_demo) AND it was written in the same transaction that created 016's index sectors_name_lower_uq (equal
-- xmin on the row and on the index's pg_class entry). Once that index is gone (rollback 016 always drops it, and keeps any
-- 'agriculture-dairy' row it could not prove was 016's), no remaining row can be proven to be the seed, so every row counts.
-- To undo anyway, export the rows first (a backup, or COPY <table> TO a file in psql), delete them on purpose, then run this again.
-- Roll back 026 down to 013 first (newest first): their tables point at these ones, so this file fails while they exist.
-- Nothing that existed before 012 is touched.
BEGIN;

DO $$
DECLARE
  expected text := nullif(current_setting('rv.expected_db', true), '');
  n bigint;
  blocking text;     -- the slugs of the sectors that stop the undo
  seed_kept boolean; -- one of them is an 'agriculture-dairy' row that cannot be proven to be 016's seed
BEGIN
  IF expected IS NULL THEN
    RAISE EXCEPTION 'rv.expected_db is not set. Run this through "npm run db:migrate -- --expect-db <database name>". Nothing was changed.';
  END IF;
  IF current_database() <> expected THEN
    RAISE EXCEPTION 'Wrong database: connected to "%" but expected "%". Nothing was changed.', current_database(), expected;
  END IF;
  -- dynamic SQL throughout: safe when a table is already gone (a partly applied or partly rolled back database)
  IF to_regclass('contributions') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM contributions' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'contributions holds % row(s) (members'' submissions, drafts included). Dropping the table would delete them. Export them first, delete them on purpose, then run this again. Nothing was changed.', n;
    END IF;
  END IF;
  IF to_regclass('contribution_scopes') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM contribution_scopes' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'contribution_scopes holds % row(s) (the sectors each contribution is in). Dropping the table would delete them. Export them first, delete them on purpose, then run this again. Nothing was changed.', n;
    END IF;
  END IF;
  IF to_regclass('sectors') IS NOT NULL THEN
    -- Every sector counts except a row that passes rollback 016's ownership test (016_down.sql): exactly 016's five values AND the
    -- same xmin as 016's index. NOT EXISTS is false only for that row; with the index gone, to_regclass is NULL and nothing passes.
    EXECUTE $q$
      SELECT count(*), string_agg(s.slug, ', ' ORDER BY s.id), coalesce(bool_or(s.slug = 'agriculture-dairy'), false)
        FROM sectors s
       WHERE NOT EXISTS (
         SELECT 1 FROM pg_class i
          WHERE i.oid = to_regclass('sectors_name_lower_uq') AND i.xmin = s.xmin
            AND s.slug = 'agriculture-dairy' AND s.name = 'Agriculture & Dairy' AND s.sort_order = 10 AND s.is_active AND NOT s.is_demo)
    $q$ INTO n, blocking, seed_kept;
    IF n > 0 AND seed_kept THEN
      RAISE EXCEPTION 'sectors holds % sector(s) that are not migration 016''s untouched seed: %. The agriculture-dairy row cannot be proven to be the one 016 inserted (it existed before 016 ran, it was changed after 016, or 016''s index sectors_name_lower_uq is gone; rollback 016 keeps such a row). Dropping the table would delete them. Export them first, delete them on purpose, then run this again. Nothing was changed.', n, blocking;
    ELSIF n > 0 THEN
      RAISE EXCEPTION 'sectors holds % sector(s) besides the seeded Agriculture & Dairy: %. Dropping the table would delete them. Export them first, delete them on purpose, then run this again. Nothing was changed.', n, blocking;
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS contribution_scopes;
DROP TABLE IF EXISTS contributions;
DROP TABLE IF EXISTS sectors;
DROP FUNCTION IF EXISTS rv_contribution_needs_scope();
DROP FUNCTION IF EXISTS rv_scope_keep_last();
COMMIT;
