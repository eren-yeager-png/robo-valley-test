-- RoboValley migration 006: pin code centres for the Find a Service map and radius search
-- Additive only: ONE new table and ONE index, nothing existing is touched. Safe to run more than once.
-- Run AFTER 001-005. NOT applied automatically. Review, then run it yourself, e.g.:
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 006          (dry run)
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 006 --apply
-- Undo: db/rollback/006_down.sql (removes only the table created here).
--
-- The uploaded school files have a pin code but no coordinates, so each school is placed at the centre of its pin code.
-- This table holds that centre per pin code. It is filled by scripts/fill-pincode-locations.mjs (GeoNames postal-code
-- data, CC BY 4.0, plus a Nominatim lookup for the few pin codes GeoNames does not know). A pin code that could not be
-- resolved is kept with lat/lng NULL and source 'missing': its schools are still listed when that exact pin code is
-- searched, but never in a radius search from another pin code. Coordinates are never guessed.

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

CREATE TABLE IF NOT EXISTS pincode_locations (
  pincode     varchar(6) PRIMARY KEY CHECK (pincode ~ '^[1-9][0-9]{5}$'),   -- the primary key is the index on pincode
  lat         double precision CHECK (lat BETWEEN 6 AND 38),
  lng         double precision CHECK (lng BETWEEN 67 AND 98),
  place       text,
  source      varchar(12) NOT NULL CHECK (source IN ('geonames', 'nominatim', 'missing')),
  resolved_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pincode_locations_coords_ck CHECK (
    (source = 'missing' AND lat IS NULL AND lng IS NULL) OR (source <> 'missing' AND lat IS NOT NULL AND lng IS NOT NULL)
  )
);

-- Bounding-box pre-filter for radius searches (only rows that have coordinates).
CREATE INDEX IF NOT EXISTS pincode_locations_latlng_idx ON pincode_locations (lat, lng) WHERE lat IS NOT NULL;

COMMIT;
