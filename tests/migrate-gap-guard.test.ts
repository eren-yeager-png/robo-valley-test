// The migration runner's gap guard: `--only NNN --apply` refuses when an EARLIER migration is missing or partly applied, and lists
// them, unless --allow-gaps is given. The decision (preflight) runs on in-process PostgreSQL (PGlite) with the real migrations;
// the command-line options run as a real process pointed only at the unreachable test placeholder. No real database is involved.
import { PGlite } from "@electric-sql/pglite";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TEST_DATABASE_URL } from "./setup";
import { applyFile, decideFile, gapMessage, pickFiles, preflight } from "../scripts/migrate.mjs";
import { earlierGaps, formatStatus, migrationStatus, statusOf } from "../scripts/migration-status.mjs";
import { migratedClone } from "./helpers/migratedClone";

const read = (p: string) => readFileSync(resolve(p), "utf8");
const runner = (pg: PGlite) => ({ setExpected: (n: string) => pg.query("select set_config('rv.expected_db', $1, false)", [n]), exec: (sql: string) => pg.exec(sql) });
const nameOf = (f: string) => f.split(/[\\/]/).pop()!;
const fileFor = (id: string) => nameOf(pickFiles().find((f) => nameOf(f).startsWith(id))!);

/** A database with the base schema and every migration whose number is in `ids`. */
async function db(ids: (id: string) => boolean) {
  const { pg, name } = await migratedClone(ids); // built once per file, a fresh copy per test (tests/helpers/migratedClone.ts)
  const query = (sql: string) => pg.query(sql) as Promise<{ rows: any[] }>;
  return { pg, name, query };
}
const status = async (query: (sql: string) => Promise<{ rows: any[] }>, id: string) => statusOf(await migrationStatus(query), id)?.status;

describe("preflight: a --only run that would skip earlier migrations", () => {
  it("refuses 022 when 019 and 020 are missing, lists them in number order, and says what to run instead", async () => {
    const { pg, name, query } = await db((id) => id < "019" || id === "021");
    const p = await preflight(query, fileFor("022"), { only: true, expectDb: name });
    expect(p.action).toBe("refuse");
    expect(p.message).toContain("022_contribution_origin.sql comes after 2 migrations that are not fully applied in this database:");
    expect(p.message).toMatch(/019 {2}missing {9}moderation portal\n {4}020 {2}missing {9}password reset/);
    expect(p.message).toContain(`node scripts/migrate.mjs --expect-db ${name} --only 019 --apply`);
    expect(p.message).toContain("Only if you are sure 022 does not need them, run it again with --allow-gaps.");
    expect(p.message).not.toMatch(/postgres(ql)?:\/\/|password=|@/); // no connection details
    expect(await status(query, "022")).toBe("missing"); // a decision only: nothing was changed
    await pg.close();
  });

  it("a partly applied earlier migration counts too, and is called 'partly applied'", async () => {
    const { pg, query } = await db((id) => id <= "021");
    await pg.exec("drop index password_reset_tokens_user_idx"); // 020 is now partly applied
    expect(await status(query, "020")).toBe("partial");
    const p = await preflight(query, fileFor("022"), { only: true });
    expect(p.action).toBe("refuse");
    expect(p.message).toContain("022_contribution_origin.sql comes after a migration that is not fully applied in this database:");
    expect(p.message).toMatch(/020 {2}partly applied {2}password reset/);
    expect(p.message).toContain("--expect-db <database name> --only 020 --apply"); // no name given: a placeholder, never a guess
    await pg.close();
  });

  it("--allow-gaps lets it run (the operator decided); the gap is then not checked", async () => {
    const { pg, name, query } = await db((id) => id < "019" || id === "021");
    expect(await preflight(query, fileFor("022"), { only: true, allowGaps: true })).toEqual({ action: "run", note: undefined });
    await applyFile(runner(pg), name, read(pickFiles().find((f) => nameOf(f).startsWith("022"))!)); // and it really applies
    expect(await status(query, "022")).toBe("applied");
    await pg.close();
  });

  it("a full run (no --only) is not refused: it applies every migration in order, so nothing is skipped", async () => {
    const { pg, query } = await db((id) => id < "019");
    expect((await preflight(query, fileFor("019"), { only: false })).action).toBe("run");
    expect((await preflight(query, fileFor("022"), { only: false })).action).toBe("run");
    await pg.close();
  });

  it("nothing earlier missing: it runs; already applied: it is skipped (gaps or not)", async () => {
    const { pg, query } = await db((id) => id <= "021");
    expect(await preflight(query, fileFor("022"), { only: true })).toEqual({ action: "run", note: undefined });
    const { pg: pg2, query: q2 } = await db((id) => id !== "019");
    const skip = await preflight(q2, fileFor("021"), { only: true });
    expect(skip.action).toBe("skip"); // 021 is there already: skipping it is harmless even though 019 is missing
    expect(skip.message).toMatch(/Skipping 021_contact_share\.sql \(already applied/);
    await pg.close(); await pg2.close();
  });

  it("a missing prerequisite is refused even with --allow-gaps (its SQL could not work)", async () => {
    const { pg, query } = await db((id) => id < "012");
    const p = await preflight(query, fileFor("021"), { only: true, allowGaps: true });
    expect(p).toMatchObject({ action: "refuse" });
    expect(p.message).toMatch(/021_contact_share\.sql needs migration 012 first/);
    await pg.close();
  });

  it("a partly applied target is run with a note (unchanged behaviour)", async () => {
    const { pg, query } = await db((id) => true);
    await pg.exec("drop index password_reset_tokens_user_idx");
    const p = await preflight(query, fileFor("020"), { only: true });
    expect(p.action).toBe("run");
    expect(p.note).toMatch(/020_password_reset\.sql is partly applied \(index password_reset_tokens_user_idx missing\)/);
    await pg.close();
  });
});

describe("a migration without a status entry (fails closed)", () => {
  it("is refused on a fully migrated and on an empty database, whatever the options, with what to do", async () => {
    const full = await db(() => true);
    const empty = await db(() => false);
    for (const { query } of [full, empty]) {
      for (const opts of [{}, { only: true }, { force: true }, { only: true, allowGaps: true }]) {
        const p = await preflight(query, "099_something_new.sql", opts);
        expect(p.action, JSON.stringify(opts)).toBe("refuse");
        expect(p.message).toMatch(/099_something_new\.sql has no entry in scripts\/migration-status\.mjs/);
        expect(p.message).toMatch(/Add its entry there first/);
      }
    }
    await full.pg.close(); await empty.pg.close();
  });
  it("every migration file in the folder has an entry, so a normal run never meets that refusal", async () => {
    const { query, pg } = await db(() => true);
    for (const f of pickFiles()) expect((await preflight(query, nameOf(f), {})).action, nameOf(f)).not.toBe("refuse");
    await pg.close();
  });
});

describe("--file on a migration in db/migrations gets the same checks as --only (decideFile)", () => {
  it("already applied: skipped; with --force: run (017 then only widens, see tests/migration-017.test.ts)", async () => {
    const { query, pg } = await db(() => true);
    const file = "db/migrations/" + fileFor("017");
    expect((await decideFile(query, resolve(file), { file })).action).toBe("skip");
    expect((await decideFile(query, resolve(file), { file, force: true })).action).toBe("run");
    await pg.close();
  });
  it("an earlier migration missing: refused with the list, exactly like --only (and --allow-gaps cannot be combined with --file)", async () => {
    const { query, pg } = await db((id) => id < "019" || id === "021");
    const file = "db/migrations/" + fileFor("022");
    const viaFile = await decideFile(query, resolve(file), { file, expectDb: "neondb" });
    const viaOnly = await preflight(query, fileFor("022"), { only: true, expectDb: "neondb" });
    expect(viaFile).toEqual(viaOnly);
    expect(viaFile.action).toBe("refuse");
    expect(viaFile.message).toMatch(/019 {2}missing/);
    await pg.close();
  });
  it("a missing prerequisite: refused (its SQL could not work)", async () => {
    const { query, pg } = await db((id) => id < "012");
    const file = "db/migrations/" + fileFor("021");
    const p = await decideFile(query, resolve(file), { file });
    expect(p.action).toBe("refuse");
    expect(p.message).toMatch(/needs migration 012 first/);
    await pg.close();
  });
  it("a rollback (or any file outside db/migrations) runs without the status checks: its own SQL refuses what it must not do", async () => {
    const { query, pg } = await db(() => true);
    expect(await decideFile(query, resolve("db/rollback/017_down.sql"), { file: "db/rollback/017_down.sql" })).toEqual({ action: "run" });
    await pg.close();
  });
  it("a normal run (no --file) decides exactly as before: preflight per file", async () => {
    const { query, pg } = await db((id) => id < "022");
    const f = pickFiles({ only: "022" })[0]!;
    expect(await decideFile(query, f, { only: "022" })).toEqual(await preflight(query, nameOf(f), { only: true }));
    expect(await decideFile(query, pickFiles({ only: "021" })[0]!, {})).toEqual({ action: "skip", message: `Skipping ${fileFor("021")} (already applied; --force runs it again)` });
    await pg.close();
  });
});

describe("a prerequisite must be fully applied, not just present", () => {
  it("prerequisite applied: the migration runs", async () => {
    const { pg, query } = await db((id) => id < "021");
    expect(await preflight(query, fileFor("021"), { only: true })).toEqual({ action: "run", note: undefined });
    await pg.close();
  });
  it("prerequisite partly applied: refused (even with --allow-gaps), naming the prerequisite and exactly what it is missing", async () => {
    const { pg, query } = await db((id) => id < "021");
    await pg.exec("drop index contributions_public_idx"); // 012 is now partly applied
    for (const opts of [{ only: true }, { only: true, allowGaps: true }, { only: false }]) {
      const p = await preflight(query, fileFor("021"), opts);
      expect(p.action, JSON.stringify(opts)).toBe("refuse");
      expect(p.message).toContain("021_contact_share.sql needs migration 012 first, fully applied:");
      expect(p.message).toContain("012 is partly applied (missing: index contributions_public_idx)");
      expect(p.message).toContain("--only 012 --apply");
    }
    const r = await migrationStatus(query);
    expect(statusOf(r, "021")!.blockedBy).toEqual(["012"]);
    expect(formatStatus(r)).toMatch(/021 {2}MISSING[^\n]*\n {11}needs 012 \(partly applied\) first/);
    await pg.close();
  });
  it("prerequisite missing: refused, saying it is missing", async () => {
    const { pg, query } = await db((id) => id < "012");
    const p = await preflight(query, fileFor("021"), { only: true, allowGaps: true });
    expect(p.action).toBe("refuse");
    expect(p.message).toContain("012 is missing (none of its objects are in this database)");
    await pg.close();
  });
  it("a missing trigger is enough to make a prerequisite partial; running the prerequisite again lets the migration go ahead", async () => {
    const { pg, name, query } = await db((id) => id < "024");
    await pg.exec("drop trigger contribution_scopes_keep_last on contribution_scopes"); // 012 partial: one of its safety triggers is gone
    expect((await preflight(query, fileFor("024"), { only: true })).message).toContain("012 is partly applied (missing: trigger contribution_scopes_keep_last on contribution_scopes calling rv_scope_keep_last())");
    await applyFile(runner(pg), name, read(pickFiles({ only: "012" })[0]!)); // what --only 012 --apply does
    expect(await preflight(query, fileFor("024"), { only: true })).toEqual({ action: "run", note: undefined });
    await pg.close();
  });
  it("an already applied migration is still skipped when a prerequisite is partial (nothing would run)", async () => {
    const { pg, query } = await db(() => true);
    await pg.exec("drop index contributions_public_idx");
    expect((await preflight(query, fileFor("021"), { only: true })).action).toBe("skip");
    await pg.close();
  });
});

describe("earlierGaps and gapMessage", () => {
  it("lists only lower numbers that are not applied, in order", () => {
    const r = [
      { id: "017", title: "a", status: "applied" }, { id: "018", title: "b", status: "missing" }, { id: "019", title: "c", status: "partial" },
      { id: "020", title: "d", status: "applied" }, { id: "021", title: "e", status: "missing" }, { id: "022", title: "f", status: "missing" },
    ];
    expect(earlierGaps(r, "021")).toEqual([{ id: "018", title: "b", status: "missing" }, { id: "019", title: "c", status: "partial" }]);
    expect(earlierGaps(r, "018")).toEqual([]);
  });
  it("one gap reads in the singular", () => {
    expect(gapMessage("024_sector_robot_types.sql", [{ id: "023", title: "the type the member chose", status: "missing" }], "neondb"))
      .toBe([
        "024_sector_robot_types.sql comes after a migration that is not fully applied in this database:",
        "    023  missing         the type the member chose",
        "  Apply them first, lowest number first (a dry run, then --apply), for example:",
        "    node scripts/migrate.mjs --expect-db neondb --only 023 --apply",
        "  Only if you are sure 024 does not need them, run it again with --allow-gaps.",
      ].join("\n"));
  });
});

describe("the --allow-gaps option on the command line (never connects)", () => {
  const run = (args: string[]) => {
    const r = spawnSync(process.execPath, [resolve("scripts/migrate.mjs"), ...args], {
      encoding: "utf8", timeout: 20_000,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DATABASE_URL: TEST_DATABASE_URL } as unknown as NodeJS.ProcessEnv,
    });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
  };
  it("is accepted with --only; the dry run then does not promise the check", () => {
    const r = run(["--expect-db", "never_connects", "--only", "021", "--allow-gaps"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/DRY RUN/);
    expect(r.out).not.toMatch(/first checks that every earlier migration is applied/);
  });
  it("a --only dry run says that --apply will check the earlier migrations first", () => {
    const r = run(["--expect-db", "never_connects", "--only", "021"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/With --apply, it first checks that every earlier migration is applied, and refuses \(listing them\) if one is not\./);
  });
  it("is refused without --only, and with --status", () => {
    const a = run(["--expect-db", "never_connects", "--allow-gaps"]);
    expect(a.code).toBe(1);
    expect(a.out).toMatch(/--allow-gaps only goes with --only <number>/);
    expect(a.out).toMatch(/Nothing was changed/);
    const b = run(["--expect-db", "never_connects", "--status", "--allow-gaps"]);
    expect(b.code).toBe(1);
    expect(b.out).toMatch(/--status only reads the database\. It cannot be combined with .*--allow-gaps/);
  });
  it("the usage notes at the top of the script describe it", () => {
    expect(read("scripts/migrate.mjs")).toMatch(/--allow-gaps {6}with --only: run it even though an EARLIER migration is missing or partly applied/);
  });
});
