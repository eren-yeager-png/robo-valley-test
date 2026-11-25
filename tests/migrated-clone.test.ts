// tests/helpers/migratedClone.ts hands each test a clone of a migrated database instead of a from-scratch build. That is only allowed
// if a clone cannot be told apart from a build: same objects, same rows, same next identity values, and fully separate from its
// template and from other clones. In-process PostgreSQL (PGlite) only.
import type { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { migratedClone, migratedFromScratch } from "./helpers/migratedClone";

const q = async (pg: PGlite, sql: string) => JSON.stringify((await pg.query(sql)).rows);
const fingerprint = async (pg: PGlite) => ({
  columns: await q(pg, "select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' order by 1, 2"),
  constraints: await q(pg, "select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2"),
  indexes: await q(pg, "select indexname, indexdef from pg_indexes where schemaname = 'public' order by 1"),
  triggers: await q(pg, "select tgrelid::regclass::text t, tgname, tgfoid::regproc::text f from pg_trigger where not tgisinternal order by 1, 2"),
  functions: await q(pg, "select proname, pg_get_function_identity_arguments(oid) a, md5(prosrc) s from pg_proc where pronamespace = 'public'::regnamespace order by 1, 2"),
  sectors: await q(pg, "select id, slug, name, sort_order, is_active, is_demo from sectors order by id"),
});
const nextIds = async (pg: PGlite) => {
  await pg.exec("insert into users (full_name, email, role, password_hash) values ('A', 'a@example.com', 'TC', 'x')");
  await pg.exec("insert into sectors (slug, name) values ('education', 'Education')");
  return q(pg, "select (select max(id) from users) u, (select max(id) from sectors) s");
};

describe("a migrated clone is the same database as a from-scratch build", () => {
  it("same tables, columns, constraints, indexes, triggers, functions and rows (001-026)", async () => {
    const built = await migratedFromScratch();
    const { pg: clone } = await migratedClone();
    expect(await fingerprint(clone)).toEqual(await fingerprint(built));
    await built.close(); await clone.close();
  });

  it("identity values continue exactly as after a build (the next sector after 016's seed is 2, the first user is 1)", async () => {
    const built = await migratedFromScratch();
    const { pg: clone } = await migratedClone();
    expect(await nextIds(clone)).toBe(await nextIds(built));
    expect(JSON.parse(await q(clone, "select (select min(id) from users)::int u, (select id from sectors where slug = 'education') s"))).toEqual([{ u: 1, s: 2 }]);
    await built.close(); await clone.close();
  });

  it("each clone is separate: a change in one is not seen by the next clone", async () => {
    const { pg: a } = await migratedClone();
    await a.exec("insert into sectors (slug, name) values ('healthcare', 'Healthcare')");
    await a.exec("drop table api_rate_limits");
    const { pg: b } = await migratedClone();
    expect(await q(b, "select slug from sectors order by id")).toBe(JSON.stringify([{ slug: "agriculture-dairy" }]));
    expect(await q(b, "select to_regclass('api_rate_limits') is not null t")).toBe(JSON.stringify([{ t: true }]));
    await a.close(); await b.close();
  });

  it("a template is chosen by exactly which migrations it holds", async () => {
    const { pg: upTo015 } = await migratedClone((id) => id <= "015");
    expect(await q(upTo015, "select to_regclass('sectors') is not null s, to_regclass('contribution_reviews') is not null r")).toBe(JSON.stringify([{ s: true, r: false }]));
    const { pg: all } = await migratedClone();
    expect(await q(all, "select to_regclass('contribution_reviews') is not null r")).toBe(JSON.stringify([{ r: true }]));
    await upTo015.close(); await all.close();
  });
});
