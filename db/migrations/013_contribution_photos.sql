-- RoboValley migration 013: contribution photos (contribution_photos, contribution_photo_blobs)
-- Part B, PR 2. Additive only: TWO new tables, their indexes and one guard trigger. It does not read, change or delete any existing
-- data and adds no row. Safe to run more than once. Run AFTER 001-012 (needs contributions). NOT applied automatically.
-- Review, take a fresh backup, then run it yourself, e.g.:
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 013          (dry run)
--   node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 013 --apply
-- Undo: db/rollback/013_down.sql (WARNING: it DELETES every contribution photo saved after this ran).
--
-- MODEL
--   contribution_photos       one row per photo, METADATA ONLY: position 1-3, JPG or PNG, up to 4 MB, required alt text (up to 200
--                             characters), SHA-256. Listings read only this table, so they can never return image bytes.
--   contribution_photo_blobs  the image bytes, one row per photo, in their own table (same pattern as upload_attachment_blobs, 009).
-- RULES IN THE DATABASE (the application checks the same things first and gives friendly messages)
--   * at most 3 photos per contribution (position 1, 2 or 3, each used once);
--   * the stored bytes must match the metadata: same size, same SHA-256, and a JPEG or PNG signature that agrees with the mime type;
--   * deleting a contribution (or its user) deletes its photos and their bytes.
-- The limits below are mirrored in CONTRIBUTION_LIMITS (src/lib/contributions.ts); a test fails if they differ.

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

CREATE TABLE IF NOT EXISTS contribution_photos (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contribution_id bigint       NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  position        smallint     NOT NULL,
  mime            varchar(10)  NOT NULL,
  byte_size       integer      NOT NULL,
  alt_text        varchar(200) NOT NULL,
  file_sha256     char(64)     NOT NULL,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT contribution_photos_position_uq UNIQUE (contribution_id, position),
  CONSTRAINT contribution_photos_position_ck CHECK (position BETWEEN 1 AND 3),
  CONSTRAINT contribution_photos_mime_ck CHECK (mime IN ('image/jpeg', 'image/png')),
  CONSTRAINT contribution_photos_size_ck CHECK (byte_size BETWEEN 1 AND 4194304),
  CONSTRAINT contribution_photos_alt_ck CHECK (char_length(btrim(alt_text)) BETWEEN 1 AND 200),
  CONSTRAINT contribution_photos_sha_ck CHECK (file_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS contribution_photo_blobs (
  photo_id bigint PRIMARY KEY REFERENCES contribution_photos(id) ON DELETE CASCADE,
  data     bytea NOT NULL,
  CONSTRAINT contribution_photo_blobs_size_ck CHECK (octet_length(data) BETWEEN 1 AND 4194304)
);

-- The bytes must be the file the metadata describes (size, SHA-256, and a JPEG/PNG signature that matches the mime type).
CREATE OR REPLACE FUNCTION rv_photo_blob_matches() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  p contribution_photos%ROWTYPE;
BEGIN
  SELECT * INTO p FROM contribution_photos WHERE id = NEW.photo_id;
  IF NOT FOUND THEN
    RETURN NEW; -- the foreign key reports a missing photo
  END IF;
  IF octet_length(NEW.data) <> p.byte_size THEN
    RAISE EXCEPTION 'The photo bytes do not match the recorded size.' USING ERRCODE = '23514';
  END IF;
  IF encode(sha256(NEW.data), 'hex') <> p.file_sha256 THEN
    RAISE EXCEPTION 'The photo bytes do not match the recorded SHA-256.' USING ERRCODE = '23514';
  END IF;
  IF NOT ((p.mime = 'image/jpeg' AND substring(NEW.data FROM 1 FOR 3) = '\xffd8ff'::bytea)
       OR (p.mime = 'image/png'  AND substring(NEW.data FROM 1 FOR 8) = '\x89504e470d0a1a0a'::bytea)) THEN
    RAISE EXCEPTION 'The photo bytes are not a %.', p.mime USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $fn$;

-- CREATE TRIGGER has no IF NOT EXISTS (and CREATE OR REPLACE TRIGGER needs PostgreSQL 14), so check the catalog first.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'contribution_photo_blobs_match' AND tgrelid = 'contribution_photo_blobs'::regclass) THEN
    CREATE TRIGGER contribution_photo_blobs_match BEFORE INSERT OR UPDATE OF data ON contribution_photo_blobs
      FOR EACH ROW EXECUTE FUNCTION rv_photo_blob_matches();
  END IF;
END $$;

COMMIT;
