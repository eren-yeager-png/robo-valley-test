// scripts/seed-admins.mjs: idempotent, never overwrites a changed password, never prints secrets.
// The function runs on the in-process database; the CLI is only ever pointed at the unreachable test placeholder.
import bcrypt from "bcryptjs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";
import { TEST_DATABASE_URL } from "./setup";
import { readAdminsFromEnv, seedAdmins } from "../scripts/seed-admins.mjs";

const P1 = "first-admin-password-1";
const P2 = "second-admin-password-2";
const ENV = { ADMIN1_EMAIL: "  Admin@RoboValley.com ", ADMIN1_PASSWORD: P1, ADMIN2_EMAIL: "yasaswinipilla41@gmail.com", ADMIN2_PASSWORD: P2 };
const rows = async () => (await testDb().raw.query("select email, role, password_hash, must_change_password, email_verification from users order by email")).rows as any[];
const seed = (env: Record<string, string> = ENV, resetPassword = false) => seedAdmins({ db: testDb().quiet, env: env as never, resetPassword });

describe("seedAdmins", () => {
  it("creates both admins: normalised email, role admin, bcrypt hash, must change password", async () => {
    const out = await seed();
    expect(out).toEqual([{ email: "admin@robovalley.com", action: "created" }, { email: "yasaswinipilla41@gmail.com", action: "created" }]);
    const r = await rows();
    expect(r.map((x) => [x.email, x.role, x.must_change_password, x.email_verification])).toEqual([
      ["admin@robovalley.com", "admin", true, "email"],
      ["yasaswinipilla41@gmail.com", "admin", true, "email"],
    ]);
    expect(r[0].password_hash).toMatch(/^\$2[aby]\$12\$/);
    expect(await bcrypt.compare(P1, r[0].password_hash)).toBe(true);
    expect(await bcrypt.compare(P2, r[1].password_hash)).toBe(true);
  });

  it("is idempotent: a second run creates no duplicates and changes nothing", async () => {
    await seed();
    const before = await rows();
    const out = await seed();
    expect(out.map((o) => o.action)).toEqual(["unchanged", "unchanged"]);
    expect(await rows()).toEqual(before);
  });

  it("does NOT overwrite a password that was changed since (and keeps the flag cleared)", async () => {
    await seed();
    const changed = await bcrypt.hash("changed-by-the-admin-1", 4);
    await testDb().raw.query("update users set password_hash = $1, must_change_password = false where email = 'admin@robovalley.com'", [changed]);
    await seed();
    const a = (await rows()).find((x) => x.email === "admin@robovalley.com");
    expect(a.password_hash).toBe(changed);
    expect(a.must_change_password).toBe(false);
  });

  it("--reset-password replaces the password and sets the flag again", async () => {
    await seed();
    await testDb().raw.query("update users set password_hash = $1, must_change_password = false", [await bcrypt.hash("changed-by-the-admin-1", 4)]);
    const out = await seed(ENV, true);
    expect(out.map((o) => o.action)).toEqual(["password-reset", "password-reset"]);
    const r = await rows();
    expect(await bcrypt.compare(P1, r[0].password_hash)).toBe(true);
    expect(r.every((x) => x.must_change_password)).toBe(true);
  });

  it("promotes an existing regular account (matched case-insensitively) and leaves its password alone", async () => {
    const u = await seedUser({ email: "yasaswinipilla41@gmail.com", role: "ST", password: "her-own-password-1" });
    const out = await seed();
    expect(out.find((o) => o.email === "yasaswinipilla41@gmail.com")?.action).toBe("promoted");
    const row = (await testDb().raw.query("select role, password_hash from users where id = $1", [u.id])).rows[0] as any;
    expect(row.role).toBe("admin");
    expect(await bcrypt.compare("her-own-password-1", row.password_hash)).toBe(true);
    expect(((await testDb().raw.query("select count(*)::int c from users")).rows[0] as any).c).toBe(2);
  });

  it("is all-or-nothing if the database fails part-way", async () => {
    let n = 0;
    const flaky = {
      query: async (sql: string, params?: unknown[]) => {
        if (/^INSERT INTO users/i.test(sql.trim()) && ++n === 2) throw new Error("boom");
        return testDb().quiet.query(sql, params);
      },
    };
    await expect(seedAdmins({ db: flaky, env: ENV as never })).rejects.toThrow("boom");
    expect(await rows()).toEqual([]);
  });

  it("writes nothing to the console", async () => {
    const spies = (["log", "error", "warn", "info"] as const).map((f) => vi.spyOn(console, f).mockImplementation(() => {}));
    await seed();
    expect(spies.flatMap((s) => s.mock.calls)).toEqual([]);
    vi.restoreAllMocks();
  });
});

describe("readAdminsFromEnv (errors name variables, never values)", () => {
  const err = (env: Record<string, string>) => { try { readAdminsFromEnv(env as never); } catch (e) { return String((e as Error).message); } return ""; };

  it("needs at least one admin", () => expect(err({})).toMatch(/ADMIN1_EMAIL/));
  it("needs email and password together", () => {
    expect(err({ ADMIN1_EMAIL: "a@example.com" })).toMatch(/ADMIN1_PASSWORD is missing/);
    expect(err({ ADMIN2_PASSWORD: "long-enough-pass" })).toMatch(/ADMIN2_EMAIL is missing/);
  });
  it("rejects a bad email, a short password, an over-long password and a repeated email without echoing them", () => {
    const secret = "short";
    const msgs = [
      err({ ADMIN1_EMAIL: "not-an-email", ADMIN1_PASSWORD: "long-enough-pass" }),
      err({ ADMIN1_EMAIL: "a@example.com", ADMIN1_PASSWORD: secret }),
      err({ ADMIN1_EMAIL: "a@example.com", ADMIN1_PASSWORD: "x".repeat(80) }),
      err({ ADMIN1_EMAIL: "a@example.com", ADMIN1_PASSWORD: "long-enough-pass", ADMIN2_EMAIL: "A@Example.com", ADMIN2_PASSWORD: "long-enough-pass" }),
    ];
    expect(msgs[0]).toMatch(/ADMIN1_EMAIL is not a valid/);
    expect(msgs[1]).toMatch(/ADMIN1_PASSWORD must have at least 8/);
    expect(msgs[2]).toMatch(/too long/);
    expect(msgs[3]).toMatch(/repeats/);
    for (const m of msgs) { expect(m).not.toContain(secret); expect(m).not.toContain("long-enough-pass"); expect(m).not.toContain("not-an-email"); }
  });
});

describe("seed-admins.mjs as a command", () => {
  const run = (args: string[], env: Record<string, string | undefined> = {}) => {
    const r = spawnSync(process.execPath, [resolve("scripts/seed-admins.mjs"), ...args], {
      encoding: "utf8", timeout: 20_000,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DATABASE_URL: TEST_DATABASE_URL, ...env } as unknown as NodeJS.ProcessEnv,
    });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
  };

  it("refuses without --expect-db", () => {
    const r = run([], ENV);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Missing --expect-db/);
  });

  it("refuses when the confirmed name differs from DATABASE_URL, and prints no password", () => {
    const r = run(["--expect-db", "some_other_db"], ENV);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/points to database "never_connects" but you confirmed "some_other_db"/);
    expect(r.out).not.toContain(P1);
    expect(r.out).not.toContain(P2);
  });

  it("fails clearly when the admin variables are missing", () => {
    const r = run(["--expect-db", "never_connects"], {});
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/No admin variables are set/);
  });

  it("is a dry run by default: connects to nothing and prints no password", () => {
    const r = run(["--expect-db", "never_connects"], ENV);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/DRY RUN/);
    expect(r.out).toMatch(/admin@robovalley\.com/);
    expect(r.out).not.toContain(P1);
    expect(r.out).not.toContain(P2);
  });
});
