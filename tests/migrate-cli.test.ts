// The migration runner as a real command-line process. It is only ever pointed at the unreachable test placeholder,
// so it cannot touch any real database; the --apply case proves it fails cleanly instead of hanging or guessing.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TEST_DATABASE_URL } from "./setup";

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
    expect(order).toEqual(["001", "002", "003"]);
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
    const r = run(["--expect-db", "never_connects", "--force"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Unknown option: --force/);
  });
});
