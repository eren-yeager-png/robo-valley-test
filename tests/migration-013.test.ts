// Migration 013 (contribution_photos, contribution_photo_blobs), its rollback and the photo helpers, on in-process PostgreSQL (PGlite).
// Throwaway in-memory databases only; no real or shared database is involved.
import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyFile, pickFiles } from "../scripts/migrate.mjs";
import { PHOTO_META_SQL, addPhoto, getPhotoBytes, listPhotoMeta, validatePhoto } from "../src/lib/contributionPhotos";
import { CONTRIBUTION_LIMITS } from "../src/lib/contributions";

const read = (p: string) => readFileSync(resolve(p), "utf8");
const runner = (pg: PGlite) => ({
  setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]),
  exec: (sql: string) => pg.exec(sql),
});
const tables = async (pg: PGlite) =>
  (await pg.query("select table_name t from information_schema.tables where table_schema='public' order by 1")).rows.map((r: any) => r.t);
const count = async (pg: PGlite, sql: string) => Number(((await pg.query(sql)).rows[0] as any).n);
const UP = "db/migrations/013_contribution_photos.sql";
const DOWN = "db/rollback/013_down.sql";
const NEW = ["contribution_photo_blobs", "contribution_photos"];

const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("JFIF fake body for tests")]);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function build() {
  const pg = new PGlite();
  await pg.exec(read("tests/helpers/baseSchema.sql"));
  const name = String(((await pg.query("select current_database() d")).rows[0] as any).d);
  for (const f of pickFiles()) await applyFile(runner(pg), name, read(f));
  await pg.exec("insert into users (full_name,email,role,password_hash) values ('Asha','a@example.com','TC','x'),('Ravi','r@example.com','TC','x')");
  await pg.exec("insert into sectors (slug,name) values ('education','Education')");
  return { pg, name };
}
const newContribution = async (pg: PGlite, user = 1) =>
  Number(((await pg.query(`insert into contributions (user_id,type,title,body) values (${user},'problem','Shed cleaning by hand','Two workers clean the shed by hand.') returning id`)).rows[0] as any).id);
const meta = (cid: number, pos: number, over: Record<string, string | number> = {}, b: Buffer = PNG_1x1) => {
  const v = { mime: "image/png", size: b.length, alt: "A small test picture", sha: sha(b), ...over };
  return `insert into contribution_photos (contribution_id,position,mime,byte_size,alt_text,file_sha256) values (${cid},${pos},'${v.mime}',${v.size},'${v.alt}','${v.sha}') returning id`;
};
const bad = (pg: PGlite, sql: string, re?: RegExp) => expect(pg.exec(sql)).rejects.toThrow(re);
const db = (pg: PGlite) => ({ query: async (sql: string, p?: unknown[]) => ({ rows: (await pg.query(sql, p as any[])).rows as any[] }) });
const pool = (pg: PGlite) => ({ ...db(pg), connect: async () => ({ ...db(pg), release: () => undefined }) });

describe("migration 013", () => {
  it("adds only the two photo tables, one trigger, seeds nothing, and is safe to run twice", async () => {
    const { pg, name } = await build();
    for (const n of NEW) expect(await tables(pg)).toContain(n);
    await applyFile(runner(pg), name, read(UP));
    expect((await tables(pg)).filter((t) => NEW.includes(t))).toHaveLength(2);
    expect(await count(pg, "select count(*) n from pg_trigger where tgname='contribution_photo_blobs_match'")).toBe(1);
    expect(await count(pg, "select count(*) n from contribution_photos")).toBe(0);
    await pg.close();
  });

  it("refuses to run without a confirmed database name, or with the wrong one", async () => {
    const other = new PGlite();
    await other.exec(read("tests/helpers/baseSchema.sql"));
    await expect(other.exec(read(UP))).rejects.toThrow(/not set/);
    await other.exec("ROLLBACK");
    await other.query("select set_config('rv.expected_db', 'some_other_db', false)");
    await expect(other.exec(read(UP))).rejects.toThrow(/Wrong database/);
    await other.exec("ROLLBACK");
    expect(await tables(other)).not.toContain("contribution_photos");
    await other.close();
  });

  it("accepts a JPG and a PNG with their bytes, in positions 1 to 3", async () => {
    const { pg } = await build();
    const c = await newContribution(pg);
    const a = Number(((await pg.query(meta(c, 1))).rows[0] as any).id);
    await pg.query("insert into contribution_photo_blobs (photo_id,data) values ($1,$2)", [a, PNG_1x1]);
    const b = Number(((await pg.query(meta(c, 2, { mime: "image/jpeg" }, JPG), [])).rows[0] as any).id);
    await pg.query("insert into contribution_photo_blobs (photo_id,data) values ($1,$2)", [b, JPG]);
    await pg.exec(meta(c, 3));
    expect(await count(pg, `select count(*) n from contribution_photos where contribution_id=${c}`)).toBe(3);
    await pg.close();
  });

  it("allows at most 3 photos and one per position", async () => {
    const { pg } = await build();
    const c = await newContribution(pg);
    for (const p of [1, 2, 3]) await pg.exec(meta(c, p));
    await bad(pg, meta(c, 4), /position_ck/);
    await bad(pg, meta(c, 0), /position_ck/);
    await bad(pg, meta(c, 2), /position_uq|duplicate key/);
    await pg.close();
  });

  it("accepts only JPG and PNG, 1 byte to 4 MB, and the 4 MB boundary exactly", async () => {
    const { pg } = await build();
    const c = await newContribution(pg);
    await bad(pg, meta(c, 1, { mime: "image/gif" }), /mime_ck/);
    await bad(pg, meta(c, 1, { mime: "image/webp" }), /mime_ck/);
    await bad(pg, meta(c, 1, { size: 0 }), /size_ck/);
    await bad(pg, meta(c, 1, { size: 4194305 }), /size_ck/);
    await pg.exec(meta(c, 1, { size: 4194304 }));
    await pg.close();
  });

  it("requires alt text of 1 to 200 characters", async () => {
    const { pg } = await build();
    const c = await newContribution(pg);
    await bad(pg, meta(c, 1, { alt: "" }), /alt_ck/);
    await bad(pg, meta(c, 1, { alt: "     " }), /alt_ck/);
    await bad(pg, meta(c, 1, { alt: "x".repeat(201) }), /alt_ck|too long|value too long/);
    await pg.exec(meta(c, 1, { alt: "x".repeat(200) }));
    await pg.close();
  });

  it("checks the SHA-256 format and that the bytes match the metadata (size, hash, signature)", async () => {
    const { pg } = await build();
    const c = await newContribution(pg);
    await bad(pg, meta(c, 1, { sha: "XYZ" }), /sha_ck|value too long/);
    await bad(pg, meta(c, 1, { sha: "A".repeat(64) }), /sha_ck/); // upper case is not the stored form
    const ins = async (pos: number, over: Record<string, string | number>, bytes: Buffer, stored: Buffer = bytes) => {
      const id = Number(((await pg.query(meta(c, pos, over, bytes))).rows[0] as any).id);
      return pg.query("insert into contribution_photo_blobs (photo_id,data) values ($1,$2)", [id, stored]);
    };
    await expect(ins(1, {}, PNG_1x1, Buffer.concat([PNG_1x1, Buffer.from([0])]))).rejects.toThrow(/recorded size/); // size differs
    await pg.exec("delete from contribution_photos");
    const other = Buffer.from(PNG_1x1); other[20] = other[20]! ^ 0xff; // same size, different bytes
    await expect(ins(1, {}, PNG_1x1, other)).rejects.toThrow(/SHA-256/);
    await pg.exec("delete from contribution_photos");
    await expect(ins(1, { mime: "image/jpeg" }, PNG_1x1)).rejects.toThrow(/not a image\/jpeg/); // PNG bytes labelled JPEG
    await pg.exec("delete from contribution_photos");
    await expect(ins(1, { mime: "image/png" }, JPG)).rejects.toThrow(/not a image\/png/);
    await pg.exec("delete from contribution_photos");
    const notImage = Buffer.from("<?php echo 1; ?> not an image at all");
    await expect(ins(1, {}, notImage)).rejects.toThrow(/not a image\/png/);
    await pg.exec("delete from contribution_photos");
    await ins(1, {}, PNG_1x1); // the honest one
    expect(await count(pg, "select count(*) n from contribution_photo_blobs")).toBe(1);
    await pg.close();
  });

  it("stores exactly 4 MB of bytes and nothing larger", async () => {
    const { pg } = await build();
    const c = await newContribution(pg);
    const big = Buffer.concat([JPG, Buffer.alloc(4194304 - JPG.length, 7)]);
    const id = Number(((await pg.query(meta(c, 1, { mime: "image/jpeg" }, big))).rows[0] as any).id);
    await pg.query("insert into contribution_photo_blobs (photo_id,data) values ($1,$2)", [id, big]);
    expect(await count(pg, "select octet_length(data) n from contribution_photo_blobs")).toBe(4194304);
    await expect(pg.query(meta(c, 2, { mime: "image/jpeg", size: 4194305 }, big))).rejects.toThrow(/size_ck/);
    await pg.close();
  });

  it("deletes photos and bytes with the contribution, and with the user", async () => {
    const { pg } = await build();
    for (const user of [1, 2]) {
      const c = await newContribution(pg, user);
      const id = Number(((await pg.query(meta(c, 1))).rows[0] as any).id);
      await pg.query("insert into contribution_photo_blobs (photo_id,data) values ($1,$2)", [id, PNG_1x1]);
    }
    await pg.exec("delete from contributions where user_id=1");
    expect(await count(pg, "select count(*) n from contribution_photos")).toBe(1);
    expect(await count(pg, "select count(*) n from contribution_photo_blobs")).toBe(1);
    await pg.exec("delete from users where id=2");
    expect(await count(pg, "select count(*) n from contribution_photos")).toBe(0);
    expect(await count(pg, "select count(*) n from contribution_photo_blobs")).toBe(0);
    await pg.close();
  });
});

describe("photo helpers", () => {
  it("validatePhoto: accepts JPG and PNG, decides the type from the bytes, and hashes them", () => {
    const r: any = validatePhoto({ bytes: PNG_1x1, mime: "image/png", alt: "  A   small picture " });
    expect(r.ok).toBe(true);
    expect(r.value).toMatchObject({ mime: "image/png", alt: "A small picture", sha256: sha(PNG_1x1) });
    expect((validatePhoto({ bytes: JPG, alt: "x" }) as any).value.mime).toBe("image/jpeg"); // no claimed type: use the bytes
  });
  it("validatePhoto: rejects wrong type, wrong claim, empty, oversize, fourth photo and bad alt text", () => {
    const e = (r: any) => (r.ok ? {} : r.errors);
    expect(e(validatePhoto({ bytes: Buffer.from("GIF89a....."), alt: "x" })).photo).toMatch(/JPG or PNG/);
    expect(e(validatePhoto({ bytes: PNG_1x1, mime: "image/jpeg", alt: "x" })).photo).toMatch(/does not match/);
    expect(e(validatePhoto({ bytes: Buffer.alloc(0), alt: "x" })).photo).toBeTruthy();
    expect(e(validatePhoto({ alt: "x" })).photo).toBeTruthy();
    expect(e(validatePhoto({ bytes: Buffer.concat([JPG, Buffer.alloc(CONTRIBUTION_LIMITS.photoBytesMax)]), alt: "x" })).photo).toMatch(/4 MB/);
    expect(validatePhoto({ bytes: Buffer.concat([JPG, Buffer.alloc(CONTRIBUTION_LIMITS.photoBytesMax - JPG.length)]), alt: "x" }).ok).toBe(true);
    expect(e(validatePhoto({ bytes: PNG_1x1, alt: "x" }, 3)).photo).toMatch(/up to 3/);
    expect(validatePhoto({ bytes: PNG_1x1, alt: "x" }, 2).ok).toBe(true);
    expect(e(validatePhoto({ bytes: PNG_1x1, alt: "" })).alt).toBeTruthy();
    expect(e(validatePhoto({ bytes: PNG_1x1, alt: "   " })).alt).toBeTruthy();
    expect(e(validatePhoto({ bytes: PNG_1x1, alt: "x".repeat(201) })).alt).toBeTruthy();
    expect(e(validatePhoto({ bytes: PNG_1x1, alt: "bad\u0000alt" })).alt).toBeTruthy();
    expect(validatePhoto({ bytes: PNG_1x1, alt: "x".repeat(200) }).ok).toBe(true);
  });

  it("addPhoto fills positions 1 to 3, reuses a freed one, refuses a fourth, and leaves nothing behind on failure", async () => {
    const { pg } = await build();
    const c = await newContribution(pg);
    const photo = (b: Buffer) => (validatePhoto({ bytes: b, alt: "A test picture" }) as any).value;
    const ids = [await addPhoto(pool(pg), c, photo(PNG_1x1)), await addPhoto(pool(pg), c, photo(JPG)), await addPhoto(pool(pg), c, photo(PNG_1x1))];
    expect((await pg.query(`select position from contribution_photos where contribution_id=${c} order by id`)).rows.map((r: any) => r.position)).toEqual([1, 2, 3]);
    await expect(addPhoto(pool(pg), c, photo(PNG_1x1))).rejects.toMatchObject({ code: "23514" });
    await pg.exec(`delete from contribution_photos where id=${ids[1]}`);
    const again = await addPhoto(pool(pg), c, photo(JPG));
    expect(Number(((await pg.query(`select position from contribution_photos where id=${again}`)).rows[0] as any).position)).toBe(2);
    // a lie about the hash is refused by the database and the metadata row is rolled back with it
    const lying = { ...photo(PNG_1x1), sha256: "0".repeat(64) };
    await pg.exec(`delete from contribution_photos where contribution_id=${c} and position=3`);
    await expect(addPhoto(pool(pg), c, lying)).rejects.toThrow(/SHA-256/);
    expect(await count(pg, `select count(*) n from contribution_photos where contribution_id=${c}`)).toBe(2);
    await pg.close();
  });

  it("listings return metadata only, never bytes; the bytes come from getPhotoBytes for one photo", async () => {
    const { pg } = await build();
    const c = await newContribution(pg);
    const v = (validatePhoto({ bytes: PNG_1x1, alt: "A test picture" }) as any).value;
    const id = await addPhoto(pool(pg), c, v);
    expect(PHOTO_META_SQL).not.toMatch(/blob|\bdata\b|\*/i); // the SQL cannot select bytes
    const list = await listPhotoMeta(db(pg), [c]);
    expect(list).toEqual([{ id, contributionId: c, position: 1, mime: "image/png", byteSize: PNG_1x1.length, alt: "A test picture" }]);
    expect(JSON.stringify(list)).not.toMatch(/data|bytes|iVBOR/);
    expect(Object.values(list[0]!).some((x: unknown) => Buffer.isBuffer(x) || (x as unknown) instanceof Uint8Array)).toBe(false);
    expect(await listPhotoMeta(db(pg), [])).toEqual([]);
    const one = await getPhotoBytes(db(pg), id);
    expect(one!.mime).toBe("image/png");
    expect(one!.bytes.equals(PNG_1x1)).toBe(true);
    expect(await getPhotoBytes(db(pg), 99999)).toBeNull();
    await pg.close();
  });

  it("the listing function and its SQL never mention the blob table", () => {
    const lib = read("src/lib/contributionPhotos.ts");
    const listing = lib.slice(lib.indexOf("export const PHOTO_META_SQL"), lib.indexOf("/** The bytes of ONE photo"));
    expect(listing.length).toBeGreaterThan(100);
    expect(listing).not.toMatch(/blob/i);
  });
});

describe("code and database use the same photo limits", () => {
  const sql = read(UP);
  const L = CONTRIBUTION_LIMITS;
  it("count, size, alt text and mime types", () => {
    expect(sql).toContain(`CHECK (position BETWEEN 1 AND ${L.photosMax})`);
    expect(sql).toContain(`CHECK (byte_size BETWEEN 1 AND ${L.photoBytesMax})`);
    expect(sql).toContain(`CHECK (octet_length(data) BETWEEN 1 AND ${L.photoBytesMax})`);
    expect(sql).toContain(`alt_text        varchar(${L.altMax})`);
    expect(sql).toContain(`CHECK (char_length(btrim(alt_text)) BETWEEN ${L.altMin} AND ${L.altMax})`);
    expect(sql).toContain("CHECK (mime IN ('image/jpeg', 'image/png'))");
  });
});

describe("rollback 013", () => {
  it("removes exactly the photo tables and function, keeps contributions and their data, and the migration comes back", async () => {
    const { pg, name } = await build();
    const c = await newContribution(pg);
    const id = Number(((await pg.query(meta(c, 1))).rows[0] as any).id);
    await pg.query("insert into contribution_photo_blobs (photo_id,data) values ($1,$2)", [id, PNG_1x1]);
    const before = (await tables(pg)).filter((t) => !NEW.includes(t));
    await applyFile(runner(pg), name, read(DOWN));
    expect(await tables(pg)).toEqual(before);
    expect(await count(pg, "select count(*) n from pg_proc where proname='rv_photo_blob_matches'")).toBe(0);
    expect(await count(pg, "select count(*) n from contributions")).toBe(1); // the contribution survives; only the photos are gone
    expect(await count(pg, "select count(*) n from users")).toBe(2);
    await applyFile(runner(pg), name, read(DOWN)); // twice is fine
    await applyFile(runner(pg), name, read(UP)); // up, down, up
    for (const n of NEW) expect(await tables(pg)).toContain(n);
    expect(await count(pg, "select count(*) n from contribution_photos")).toBe(0); // the photos did not come back
    await pg.close();
  });

  it("refuses without a confirmed database name", async () => {
    const { pg } = await build();
    await pg.query("select set_config('rv.expected_db', '', false)");
    await expect(pg.exec(read(DOWN))).rejects.toThrow(/not set/);
    await pg.exec("ROLLBACK");
    expect(await tables(pg)).toContain("contribution_photos");
    await pg.close();
  });
});
