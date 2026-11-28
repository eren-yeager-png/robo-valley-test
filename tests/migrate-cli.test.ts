// The migration runner as a real command-line process. It is only ever pointed at the unreachable test placeholder,
// so it cannot touch any real database; the --apply case proves it fails cleanly instead of hanging or guessing.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TEST_DATABASE_URL } from "./setup";
import { checkMigrationNames, forwardMigrationName, MIGRATIONS_DIR, neonEndpointId, parseOnly } from "../scripts/migrate.mjs";

const run = (args: string[], env: Record<string, string | undefined> = {}) => {
  const r = spawnSync(process.execPath, [resolve("scripts/migrate.mjs"), ...args], {
    encoding: "utf8", timeout: 20_000,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DATABASE_URL: TEST_DATABASE_URL, ...env } as unknown as NodeJS.ProcessEnv,
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
};

describe("scripts/migrate.mjs (fails closed)", () => {
  it("refuses without --expect-db, and says so", () => {
    const r = run(["--only", "003"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Missing --expect-db/);
    expect(r.out).toMatch(/Nothing was changed/);
  });

  it("refuses when DATABASE_URL is not set (it does not read .env.local by itself)", () => {
    const r = run(["--expect-db", "never_connects"], { DATABASE_URL: "" });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/DATABASE_URL is not set/);
  });

  it("refuses when the confirmed name differs from the database in DATABASE_URL, even for a dry run", () => {
    const r = run(["--expect-db", "something_else", "--only", "003"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/points to database "never_connects" but you confirmed "something_else"/);
  });

  it("dry run (the default) shows the target and files, connects to nothing, changes nothing", () => {
    const r = run(["--expect-db", "never_connects", "--only", "003"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Target database name : never_connects/);
    expect(r.out).toMatch(/003_otp_and_login_throttle\.sql/);
    expect(r.out).not.toMatch(/001_|002_/);
    expect(r.out).toMatch(/DRY RUN: nothing was connected or changed/);
  });

  it("dry run lists all migrations in order when no filter is given, and never the rollback file", () => {
    const r = run(["--expect-db", "never_connects"]);
    const order = [...r.out.matchAll(/(\d{3})_\w+\.sql/g)].map((m) => m[1]);
    expect(order).toEqual(["001", "002", "003", "004", "005", "006", "007", "008", "009", "010", "011", "012", "013", "014", "015", "016", "017", "018", "019", "020", "021", "022", "023", "024", "025", "026", "027", "028", "029"]);
    expect(r.out).not.toMatch(/down/);
  });

  it("never prints the password, the user name, the host or the full URL", () => {
    const r = run(["--expect-db", "never_connects", "--only", "003"]);
    expect(r.out).not.toContain("tests-only");
    expect(r.out).not.toContain("127.0.0.1");
    expect(r.out).not.toContain("postgresql://");
  });

  it("--apply against an unreachable database fails cleanly with a one-line error and exit code 1", () => {
    const r = run(["--expect-db", "never_connects", "--only", "003", "--apply"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Nothing further was changed|Nothing was changed/);
    expect(r.out).not.toContain("tests-only");
    expect(r.out).not.toMatch(/\n\s+at /); // no stack trace
  });

  it("rejects unknown options instead of ignoring them", () => {
    const r = run(["--expect-db", "never_connects", "--bogus"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Unknown option: --bogus/);
  });

  it("an option without its value refuses to start (it used to run EVERY migration, or skip the endpoint check)", () => {
    const cases: string[][] = [["--only"], ["--file"], ["--expect-host"], ["--only", ""], ["--file", "   "], ["--expect-host", ""],
      ["--only", "--apply"], ["--file", "--apply"], ["--expect-host", "--only", "003"]];
    for (const extra of cases) {
      const r = run(["--expect-db", "never_connects", ...extra]);
      const label = JSON.stringify(extra);
      expect(r.code, label).toBe(1);
      expect(r.out, label).toMatch(new RegExp(`${extra[0]} needs a value, for example ${extra[0]} \\S+\\. Nothing was run\\.`));
      expect(r.out, label).not.toMatch(/Files to run|DRY RUN|db[\\/]migrations[\\/]0\d\d_/); // nothing was listed, let alone run
    }
    expect(run(["--expect-db"]).out).toMatch(/--expect-db needs a value/);
    expect(run(["--expect-db", "", "--only", "003"]).out).toMatch(/--expect-db needs a value/);
  });

  it("--file on a migration in db/migrations is checked like --only; a path there that is not a migration file is refused", () => {
    const ok = run(["--expect-db", "never_connects", "--file", "db/migrations/017_review_statuses.sql"]);
    expect(ok.code).toBe(0);
    expect(ok.out).toMatch(/017_review_statuses\.sql/);
    expect(ok.out).toMatch(/With --apply, it first checks that every earlier migration is applied/);
    const rollback = run(["--expect-db", "never_connects", "--file", "db/rollback/017_down.sql"]);
    expect(rollback.code).toBe(0);
    expect(rollback.out).not.toMatch(/first checks that every earlier migration is applied/); // a rollback has its own checks
    for (const bad of ["db/migrations/notes.sql", "db/migrations/old/017_review_statuses.sql"]) {
      const r = run(["--expect-db", "never_connects", "--file", bad]);
      expect(r.code, bad).toBe(1);
      expect(r.out, bad).toMatch(/is inside db\/migrations but is not a migration file/);
      expect(r.out, bad).not.toMatch(/DRY RUN/);
    }
  });
});

describe("--only selects exactly one migration", () => {
  const listed = (out: string) => [...out.matchAll(/^\s+- db[\\/]migrations[\\/](\d{3})_/gm)].map((m) => m[1]);
  it("--only 01 no longer means 010-019: it is refused as ambiguous, and nothing is listed or run", () => {
    const r = run(["--expect-db", "never_connects", "--only", "01"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/--only 01 is ambiguous: write the full three-digit migration number/);
    expect(r.out).not.toMatch(/Files to run|DRY RUN/);
    expect(listed(r.out)).toEqual([]);
  });
  it("a three-digit number selects that migration only; a short number without a leading zero means the same", () => {
    expect(listed(run(["--expect-db", "never_connects", "--only", "011"]).out)).toEqual(["011"]);
    expect(listed(run(["--expect-db", "never_connects", "--only", "11"]).out)).toEqual(["011"]);
    expect(listed(run(["--expect-db", "never_connects", "--only", "3"]).out)).toEqual(["003"]);
    expect(listed(run(["--expect-db", "never_connects", "--only", "026"]).out)).toEqual(["026"]);
  });
  it("several numbers, letters, four digits or a number with no migration are refused with a clear message and exit code 1", () => {
    const cases: Array<[string, RegExp]> = [["011,012", /--only takes one migration number/], ["011 012", /--only takes one migration number/],
      ["abc", /--only takes one migration number/], ["0011", /--only takes one migration number/], ["-1", /--only takes one migration number/],
      ["0", /is ambiguous/], ["030", /There is no migration 030 in db\/migrations/], ["99", /There is no migration 099 in db\/migrations/]];
    for (const [value, msg] of cases) {
      const r = run(["--expect-db", "never_connects", "--only", value]);
      expect(r.code, value).toBe(1);
      expect(r.out, value).toMatch(msg);
      expect(r.out, value).toMatch(/Nothing was run/);
      expect(listed(r.out), value).toEqual([]);
    }
  });
  it("parseOnly reads exactly one number from the real folder", () => {
    const names = readdirSync(MIGRATIONS_DIR);
    expect(parseOnly("024", names)).toBe("024");
    expect(parseOnly(" 24 ", names)).toBe("024");
    expect(parseOnly("1", names)).toBe("001");
    expect(() => parseOnly("01", names)).toThrow(/ambiguous/);
    expect(() => parseOnly("02", names)).toThrow(/ambiguous/);
    expect(() => parseOnly("100", names)).toThrow(/There is no migration 100/);
  });
});

describe("the migrations folder (fails closed)", () => {
  it("returns the migration files in order and ignores files that are not .sql", () => {
    expect(checkMigrationNames(["002_b.sql", "README.md", "001_a.sql", ".gitkeep", "010_c.sql"])).toEqual(["001_a.sql", "002_b.sql", "010_c.sql"]);
  });
  it("refuses two files with the same number instead of running both", () => {
    expect(() => checkMigrationNames(["001_a.sql", "002_b.sql", "002_other.sql"])).toThrow(/002_b\.sql and 002_other\.sql share one\. Renumber one of them first; nothing was run\./);
  });
  it("refuses a misnamed .sql file instead of silently skipping it", () => {
    for (const bad of ["26_questions.sql", "026-questions.sql", "026_questions.SQL", "026_.sql", "questions.sql", "0026_questions.sql"]) {
      expect(() => checkMigrationNames(["001_a.sql", bad]), bad).toThrow(new RegExp(`not named NNN_name\\.sql.*${bad.replace(/[.]/g, "\\.")}`));
    }
  });
  it("the real folder passes, so every run still sees 001 to 029", () => {
    expect(checkMigrationNames(readdirSync(MIGRATIONS_DIR))).toHaveLength(29);
  });
  it("forwardMigrationName: a migration in db/migrations gives its name; a rollback gives null; anything else there is refused", () => {
    expect(forwardMigrationName("db/migrations/017_review_statuses.sql")).toBe("017_review_statuses.sql");
    expect(forwardMigrationName(resolve("db/migrations/017_review_statuses.sql"))).toBe("017_review_statuses.sql");
    expect(forwardMigrationName("db/rollback/017_down.sql")).toBeNull();
    expect(forwardMigrationName("somewhere/else.sql")).toBeNull();
    expect(() => forwardMigrationName("db/migrations/old/017_x.sql")).toThrow(/not a migration file/);
    expect(() => forwardMigrationName("db/migrations/readme.sql")).toThrow(/not a migration file/);
  });
});

describe("telling a staging branch from production (portal PR1: both databases are called neondb)", () => {
  // A made-up Neon address: a dry run never connects, so nothing is contacted.
  const NEON = "postgresql://someone:pa55word@ep-test-staging-123456-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require";
  it("prints only Neon's endpoint ID, never the rest of the host, the user or the password", () => {
    const r = run(["--expect-db", "neondb", "--only", "019"], { DATABASE_URL: NEON });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Neon endpoint ID {5}: ep-test-staging-123456\s*$/m);
    expect(r.out).toMatch(/DRY RUN: nothing was connected or changed/);
    for (const secret of ["pa55word", "someone", "us-east-2", "neon.tech", "-pooler", "postgresql://"]) expect(r.out).not.toContain(secret);
  });
  it("--expect-host with the right endpoint goes on; with any other endpoint it refuses, even for a dry run", () => {
    expect(run(["--expect-db", "neondb", "--expect-host", "ep-test-staging-123456", "--only", "019"], { DATABASE_URL: NEON }).code).toBe(0);
    const wrong = run(["--expect-db", "neondb", "--expect-host", "ep-production-999999", "--only", "019"], { DATABASE_URL: NEON });
    expect(wrong.code).toBe(1);
    expect(wrong.out).toMatch(/points to Neon endpoint "ep-test-staging-123456" but you confirmed "ep-production-999999"/);
    expect(wrong.out).toMatch(/Nothing was changed/);
    expect(wrong.out).not.toMatch(/DRY RUN/);
  });
  it("--expect-host refuses a database that is not on Neon at all", () => {
    const r = run(["--expect-db", "never_connects", "--expect-host", "ep-test-staging-123456", "--only", "003"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/not a Neon address/);
  });
  it("reads the endpoint ID from pooled and direct addresses, and nothing from look-alikes", () => {
    expect(neonEndpointId("postgresql://u:p@ep-cool-darkness-123456-pooler.c-2.us-east-2.aws.neon.tech/neondb")).toBe("ep-cool-darkness-123456");
    expect(neonEndpointId("postgresql://u:p@ep-cool-darkness-123456.us-east-2.aws.neon.tech/neondb")).toBe("ep-cool-darkness-123456");
    expect(neonEndpointId("postgresql://u:p@ep-x-1.neon.tech.evil.example/neondb")).toBeNull();
    expect(neonEndpointId("postgresql://u:p@db.example.com/neondb")).toBeNull();
    expect(neonEndpointId("not a url")).toBeNull();
  });
});
