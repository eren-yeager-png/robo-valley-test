// Migration 014 (contribution_contacts), its rollback and the contact helpers, on in-process PostgreSQL (PGlite).
// Throwaway in-memory databases only; no real or shared database is involved.
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyFile, pickFiles } from "../scripts/migrate.mjs";
import { READ_CONTACT_SQL, readContact, removeContact, saveContact, validateContact } from "../src/lib/contributionContacts";
import { CONTRIBUTION_LIMITS } from "../src/lib/contributions";

const read = (p: string) => readFileSync(resolve(p), "utf8");
const runner = (pg: PGlite) => ({
  setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]),
  exec: (sql: string) => pg.exec(sql),
});
const tables = async (pg: PGlite) =>
  (await pg.query("select table_name t from information_schema.tables where table_schema='public' order by 1")).rows.map((r: any) => r.t);
const count = async (pg: PGlite, sql: string) => Number(((await pg.query(sql)).rows[0] as any).n);
const UP = "db/migrations/014_contribution_contacts.sql";
const DOWN = "db/rollback/014_down.sql";
const db = (pg: PGlite) => ({ query: async (sql: string, p?: unknown[]) => { const r = await pg.query(sql, p as any[]); return { rows: r.rows as any[], rowCount: r.affectedRows ?? r.rows.length }; } });

// users: 1 = Asha (owner), 2 = Ravi (another contributor), 3 = Meera (a moderator, as far as the caller says)
async function build() {
  const pg = new PGlite();
  await pg.exec(read("tests/helpers/baseSchema.sql"));
  const name = String(((await pg.query("select current_database() d")).rows[0] as any).d);
  for (const f of pickFiles()) await applyFile(runner(pg), name, read(f));
  await pg.exec("insert into users (full_name,email,role,password_hash) values ('Asha','a@example.com','TC','x'),('Ravi','r@example.com','TC','x'),('Meera','m@example.com','TC','x')");
  await pg.exec("insert into sectors (slug,name) values ('education','Education')");
  return { pg, name };
}
const newContribution = async (pg: PGlite, user = 1) =>
  Number(((await pg.query(`insert into contributions (user_id,type,title,body) values (${user},'problem','Shed cleaning by hand','Two workers clean the shed by hand.') returning id`)).rows[0] as any).id);
const bad = (pg: PGlite, sql: string, re?: RegExp) => expect(pg.exec(sql)).rejects.toThrow(re);
const ins = (cid: number, cols = "", vals = "") => `insert into contribution_contacts (contribution_id,contact_name${cols}) values (${cid},'Asha Rao'${vals})`;
const CONTACT = { name: "Asha Rao", email: "asha@example.com", phone: "9876543210", shareWithModerators: false };
const OWNER = { userId: 1, isModerator: false };
const STRANGER = { userId: 2, isModerator: false };
const MODERATOR = { userId: 3, isModerator: true };

describe("migration 014", () => {
  it("adds only contribution_contacts and is safe to run twice", async () => {
    const { pg, name } = await build();
    expect(await tables(pg)).toContain("contribution_contacts");
    await applyFile(runner(pg), name, read(UP));
    expect((await tables(pg)).filter((t) => t === "contribution_contacts")).toHaveLength(1);
    expect(await count(pg, "select count(*) n from contribution_contacts")).toBe(0);
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
    expect(await tables(other)).not.toContain("contribution_contacts");
    await other.close();
  });

  it("sharing defaults to OFF, and there is one contact row per contribution", async () => {
    const { pg } = await build();
    const c = await newContribution(pg);
    await pg.exec(ins(c, ",email", ",'asha@example.com'"));
    expect(((await pg.query(`select share_with_moderators s from contribution_contacts where contribution_id=${c}`)).rows[0] as any).s).toBe(false);
    await bad(pg, ins(c, ",phone", ",'9876543210'"), /duplicate key|pkey/);
    await bad(pg, ins(999999, ",email", ",'a@example.com'"), /foreign key|violates/);
    await pg.close();
  });

  it("checks name, email, phone and that there is some way to reach the person", async () => {
    const { pg } = await build();
    const c = await newContribution(pg);
    await bad(pg, `insert into contribution_contacts (contribution_id,contact_name,email) values (${c},'   ','a@example.com')`, /name_ck/);
    await bad(pg, `insert into contribution_contacts (contribution_id,contact_name,email) values (${c},'${"n".repeat(151)}','a@example.com')`);
    await bad(pg, ins(c, ",email", ",'not-an-email'"), /email_ck/);
    await bad(pg, ins(c, ",email", ",'Upper@Example.com'"), /email_ck/); // stored lower-case
    await bad(pg, ins(c, ",email", ",'a b@example.com'"), /email_ck/);
    await bad(pg, ins(c, ",phone", ",'12345'"), /phone_ck/);
    await bad(pg, ins(c, ",phone", ",'5876543210'"), /phone_ck/); // Indian mobiles start 6-9
    await bad(pg, ins(c, ",phone", ",'98765 43210'"), /phone_ck|value too long/);
    await bad(pg, ins(c), /reach_ck/); // neither email nor phone
    await pg.exec(ins(c, ",phone", ",'9876543210'")); // phone alone is fine
    await pg.close();
  });

  it("is deleted with the contribution and with the user", async () => {
    const { pg } = await build();
    for (const user of [1, 2]) await pg.exec(ins(await newContribution(pg, user), ",email", ",'x@example.com'"));
    await pg.exec("delete from contributions where user_id=1");
    expect(await count(pg, "select count(*) n from contribution_contacts")).toBe(1);
    await pg.exec("delete from users where id=2");
    expect(await count(pg, "select count(*) n from contribution_contacts")).toBe(0);
    await pg.close();
  });

  it("is referenced by no view, function or trigger (nothing public can join it in)", async () => {
    const { pg } = await build();
    expect(await count(pg, "select count(*) n from information_schema.view_table_usage where table_name='contribution_contacts'")).toBe(0);
    expect(await count(pg, "select count(*) n from pg_depend d join pg_rewrite r on r.oid=d.objid join pg_class t on t.oid=d.refobjid where t.relname='contribution_contacts'")).toBe(0);
    expect(await count(pg, "select count(*) n from pg_proc where prosrc ilike '%contribution_contacts%'")).toBe(0);
    expect(await count(pg, "select count(*) n from pg_trigger where tgrelid='contribution_contacts'::regclass and not tgisinternal")).toBe(0);
    expect(await count(pg, "select count(*) n from pg_views where schemaname='public' and definition ilike '%contribution_contacts%'")).toBe(0);
    await pg.close();
  });
});

describe("who can read a contact", () => {
  async function withContact(share: boolean) {
    const { pg } = await build();
    const c = await newContribution(pg, 1);
    expect(await saveContact(db(pg), c, 1, { ...CONTACT, shareWithModerators: share })).toBe(true);
    return { pg, c };
  }

  it("the owner always can", async () => {
    for (const share of [false, true]) {
      const { pg, c } = await withContact(share);
      expect(await readContact(db(pg), c, OWNER)).toEqual({ ...CONTACT, shareWithModerators: share });
      await pg.close();
    }
  });

  it("a moderator can ONLY when the contributor ticked share", async () => {
    const { pg, c } = await withContact(false);
    expect(await readContact(db(pg), c, MODERATOR)).toBeNull();
    await saveContact(db(pg), c, 1, { ...CONTACT, shareWithModerators: true });
    expect(await readContact(db(pg), c, MODERATOR)).toMatchObject({ email: "asha@example.com", phone: "9876543210" });
    await saveContact(db(pg), c, 1, { ...CONTACT, shareWithModerators: false }); // taking it back works at once
    expect(await readContact(db(pg), c, MODERATOR)).toBeNull();
    await pg.close();
  });

  it("nobody else can, shared or not, and 'no contact' looks the same as 'not allowed'", async () => {
    for (const share of [false, true]) {
      const { pg, c } = await withContact(share);
      expect(await readContact(db(pg), c, STRANGER)).toBeNull();
      expect(await readContact(db(pg), c, { userId: 2, isModerator: "yes" as unknown as boolean })).toBeNull(); // only a real true counts
      expect(await readContact(db(pg), c, { userId: 999, isModerator: false })).toBeNull();
      expect(await readContact(db(pg), 424242, OWNER)).toBeNull();
      await pg.close();
    }
  });

  it("only the owner can save or remove it", async () => {
    const { pg, c } = await withContact(false);
    expect(await saveContact(db(pg), c, 2, { ...CONTACT, name: "Hacker" })).toBe(false);
    expect(await saveContact(db(pg), c, 3, { ...CONTACT, name: "Hacker" })).toBe(false); // not even a moderator
    expect((await readContact(db(pg), c, OWNER))!.name).toBe("Asha Rao");
    expect(await removeContact(db(pg), c, 2)).toBe(false);
    expect(await count(pg, "select count(*) n from contribution_contacts")).toBe(1);
    expect(await removeContact(db(pg), c, 1)).toBe(true);
    expect(await count(pg, "select count(*) n from contribution_contacts")).toBe(0);
    expect(await saveContact(db(pg), 424242, 1, CONTACT)).toBe(false); // no such contribution
    await pg.close();
  });

  it("saving again replaces the details (one row)", async () => {
    const { pg, c } = await withContact(false);
    await saveContact(db(pg), c, 1, { name: "Asha R", email: null, phone: "9123456780", shareWithModerators: true });
    expect(await readContact(db(pg), c, OWNER)).toEqual({ name: "Asha R", email: null, phone: "9123456780", shareWithModerators: true });
    expect(await count(pg, "select count(*) n from contribution_contacts")).toBe(1);
    await pg.close();
  });
});

describe("validateContact", () => {
  const e = (r: any) => (r.ok ? {} : r.errors);
  it("accepts a good contact, normalises it, and sharing is off unless exactly true", () => {
    const r: any = validateContact({ name: "  Asha   Rao ", email: " Asha@Example.COM ", phone: "+91 98765-43210" });
    expect(r.value).toEqual({ name: "Asha Rao", email: "asha@example.com", phone: "9876543210", shareWithModerators: false });
    expect((validateContact({ name: "A", phone: "9876543210", shareWithModerators: true }) as any).value.shareWithModerators).toBe(true);
    for (const v of ["true", 1, "yes", null, undefined]) expect((validateContact({ name: "A", phone: "9876543210", shareWithModerators: v }) as any).value.shareWithModerators).toBe(false);
  });
  it("needs a name and one way to reach the person; either alone is fine", () => {
    expect(e(validateContact({ email: "a@example.com" })).name).toBeTruthy();
    expect(e(validateContact({ name: "A" })).email).toBeTruthy();
    expect(validateContact({ name: "A", email: "a@example.com" }).ok).toBe(true);
    expect(validateContact({ name: "A", phone: "9876543210" }).ok).toBe(true);
  });
  it("rejects a bad email, a bad phone, a long name and control characters; and non-objects", () => {
    expect(e(validateContact({ name: "A", email: "nope" })).email).toBeTruthy();
    expect(e(validateContact({ name: "A", phone: "12345" })).phone).toBeTruthy();
    expect(e(validateContact({ name: "x".repeat(151), phone: "9876543210" })).name).toBeTruthy();
    expect(e(validateContact({ name: "bad\u0000name", phone: "9876543210" })).name).toBeTruthy();
    for (const v of [null, undefined, 5, "x", []]) expect(validateContact(v).ok).toBe(false);
  });
});

describe("the contact table stays private in the code", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const src = walk("src").filter((f) => /\.(ts|tsx|mjs|js|sql)$/.test(f));

  it("only src/lib/contributionContacts.ts mentions the table", () => {
    const hits = src.filter((f) => read(f).includes("contribution_contacts")).map((f) => f.replace(/\\/g, "/"));
    expect(hits).toEqual(["src/lib/contributionContacts.ts"]);
  });

  it("no migration other than 014 (and its rollback) mentions it; so no view or function can join it in", () => {
    const migs = readdirSync("db/migrations").filter((f) => read(join("db/migrations", f)).includes("contribution_contacts"));
    expect(migs).toEqual(["014_contribution_contacts.sql"]);
    expect(readdirSync("db/rollback").filter((f) => read(join("db/rollback", f)).includes("contribution_contacts"))).toEqual(["014_down.sql"]);
    expect(read(UP)).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?(MATERIALIZED\s+)?VIEW|CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
  });

  it("every query on it lists its columns (no star-select) and nothing logs", () => {
    const code = read("src/lib/contributionContacts.ts").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/SELECT\s+\*|\.\*|RETURNING\s+\*/i);
    expect(code).not.toMatch(/console\.|logger|JSON\.stringify/);
    expect(READ_CONTACT_SQL).toMatch(/SELECT cc\.contact_name, cc\.email, cc\.phone, cc\.share_with_moderators FROM/);
    expect(READ_CONTACT_SQL).toContain("c.user_id = $2 OR ($3::boolean AND cc.share_with_moderators)");
  });

  it("the other contribution modules (photos, listings, validation) never select or return contact fields", () => {
    for (const f of ["src/lib/contributions.ts", "src/lib/contributionPhotos.ts"]) {
      const code = read(f);
      expect(code, f).not.toMatch(/contact_name|share_with_moderators|contribution_contacts/);
    }
  });
});

describe("code and database use the same contact limits", () => {
  const sql = read(UP);
  const L = CONTRIBUTION_LIMITS;
  it("name, email and phone sizes", () => {
    expect(sql).toContain(`contact_name          varchar(${L.contactNameMax})`);
    expect(sql).toContain(`char_length(btrim(contact_name)) BETWEEN 1 AND ${L.contactNameMax}`);
    expect(sql).toContain(`email                 varchar(${L.emailMax})`);
    expect(sql).toContain(`phone                 varchar(${L.phoneDigits})`);
    expect(sql).toContain(`'^[6-9][0-9]{${L.phoneDigits - 1}}$'`);
  });
});

describe("rollback 014", () => {
  it("removes exactly the contact table, keeps contributions and photos, and the migration comes back (up, down, up)", async () => {
    const { pg, name } = await build();
    const c = await newContribution(pg);
    await saveContact(db(pg), c, 1, CONTACT);
    const before = (await tables(pg)).filter((t) => t !== "contribution_contacts");
    await applyFile(runner(pg), name, read(DOWN));
    expect(await tables(pg)).toEqual(before);
    expect(await count(pg, "select count(*) n from contributions")).toBe(1); // the contribution survives; only the contact is gone
    expect(await count(pg, "select count(*) n from users")).toBe(3);
    await applyFile(runner(pg), name, read(DOWN)); // twice is fine
    await applyFile(runner(pg), name, read(UP)); // up, down, up
    expect(await tables(pg)).toContain("contribution_contacts");
    expect(await count(pg, "select count(*) n from contribution_contacts")).toBe(0); // the contact did not come back
    await pg.close();
  });

  it("says plainly that it deletes the contact data", () => {
    expect(read(DOWN)).toMatch(/DELETES every contact detail/);
  });

  it("refuses without a confirmed database name", async () => {
    const { pg } = await build();
    await pg.query("select set_config('rv.expected_db', '', false)");
    await expect(pg.exec(read(DOWN))).rejects.toThrow(/not set/);
    await pg.exec("ROLLBACK");
    expect(await tables(pg)).toContain("contribution_contacts");
    await pg.close();
  });
});
