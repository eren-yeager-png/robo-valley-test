// scripts/seed-moderator.mjs (item 4): credentials only from RV_MODERATOR_*, idempotent, never prints secrets, refuses an administrator.
// The function runs on the in-process database; the CLI is only ever pointed at the unreachable test placeholder.
import bcrypt from "bcryptjs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { seedUser, testDb } from "./helpers";
import { TEST_DATABASE_URL } from "./setup";
import { MODERATOR_ROLE, readModeratorFromEnv, seedModerator } from "../scripts/seed-moderator.mjs";
import { MODERATOR_ROLE as APP_ROLE } from "../src/lib/reviewerHome";

const PW = "temporary-mod-pass-1";
const ENV = { RV_MODERATOR_USER: "  RoboValley   Moderator ", RV_MODERATOR_EMAIL: " Mod@RoboValley.com ", RV_MODERATOR_PASSWORD: PW };
const row = async (email = "mod@robovalley.com") => (await testDb().raw.query("select id, full_name, role, password_hash, must_change_password, email_verification, is_moderator from users where email = $1", [email])).rows[0] as any;
const read = (e: Record<string, string>) => readModeratorFromEnv(e as never);
const seed = (env: Record<string, string> = ENV, resetPassword = false) => seedModerator({ db: testDb().quiet, env: env as never, resetPassword });

describe("readModeratorFromEnv", () => {
  it("needs all three variables and names the missing ones, never a value", () => {
    expect(() => read({})).toThrow("RV_MODERATOR_USER, RV_MODERATOR_EMAIL, RV_MODERATOR_PASSWORD are not set");
    expect(() => read({ ...ENV, RV_MODERATOR_PASSWORD: "" })).toThrow("RV_MODERATOR_PASSWORD is not set");
    try { read({ ...ENV, RV_MODERATOR_PASSWORD: "short" }); } catch (e) { expect(String(e)).not.toContain("short\""); expect(String(e)).toContain("at least 8"); }
    expect(() => read({ ...ENV, RV_MODERATOR_EMAIL: "not-an-email" })).toThrow("RV_MODERATOR_EMAIL is not a valid email address.");
    expect(() => read({ ...ENV, RV_MODERATOR_USER: "<b>x</b>" })).toThrow(/RV_MODERATOR_USER must be/);
    expect(() => read({ ...ENV, RV_MODERATOR_PASSWORD: "é".repeat(40) })).toThrow(/too long/);
  });
  it("tidies the name and the email", () => {
    expect(read(ENV)).toEqual({ name: "RoboValley Moderator", email: "mod@robovalley.com", password: PW });
  });
  it("uses the same role value as the app", () => expect(MODERATOR_ROLE).toBe(APP_ROLE));
});

describe("seedModerator", () => {
  it("creates the account: role moderator, the flag, a bcrypt hash of the temporary password, must change it; the flag change is audited", async () => {
    expect(await seed()).toEqual({ email: "mod@robovalley.com", action: "created" });
    const r = await row();
    expect([r.full_name, r.role, r.is_moderator, r.must_change_password, r.email_verification]).toEqual(["RoboValley Moderator", "moderator", true, true, "email"]);
    expect(r.password_hash).toMatch(/^\$2[aby]\$12\$/);
    expect(await bcrypt.compare(PW, r.password_hash)).toBe(true);
    const audit = (await testDb().raw.query("select admin_id, target_user_id, granted from moderator_audit where target_user_id = $1", [r.id])).rows as any[];
    expect(audit).toEqual([{ admin_id: null, target_user_id: r.id, granted: true }]);
  });
  it("is idempotent and never overwrites a password that was changed since", async () => {
    await seed();
    await testDb().raw.query("update users set password_hash = 'changed', must_change_password = false where email = 'mod@robovalley.com'");
    expect((await seed()).action).toBe("unchanged");
    const r = await row();
    expect([r.password_hash, r.must_change_password]).toEqual(["changed", false]);
    expect(Number(((await testDb().raw.query("select count(*)::int n from users where email = 'mod@robovalley.com'")).rows[0] as any).n)).toBe(1);
  });
  it("an existing member account gets the flag only (role and password untouched); --reset-password also sets a temporary password", async () => {
    const u = await seedUser({ email: "mod@robovalley.com", role: "TC", fullName: "Ravi Teacher" });
    const before = await row();
    expect((await seed()).action).toBe("flagged");
    let r = await row();
    expect([r.role, r.is_moderator, r.password_hash, r.full_name]).toEqual(["TC", true, before.password_hash, "Ravi Teacher"]);
    expect((await seed(ENV, true)).action).toBe("password-reset");
    r = await row();
    expect(r.must_change_password).toBe(true); expect(await bcrypt.compare(PW, r.password_hash)).toBe(true);
    expect(String(r.id)).toBe(String(u.id)); // the same account, not a new one
  });
  it("refuses an administrator's email and changes nothing", async () => {
    await seedUser({ email: "mod@robovalley.com", role: "admin", fullName: "Boss" });
    const before = await row();
    await expect(seed()).rejects.toThrow("That email belongs to an administrator");
    expect(await row()).toEqual(before);
  });
});

describe("the command line (never connects in these tests)", () => {
  const run = (args: string[], env: Record<string, string>) => {
    const r = spawnSync(process.execPath, [resolve("scripts/seed-moderator.mjs"), ...args], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", DATABASE_URL: TEST_DATABASE_URL, ...env } as never });
    return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
  };
  const dbName = decodeURIComponent(new URL(TEST_DATABASE_URL).pathname.slice(1));
  it("refuses without --expect-db, and with the wrong name", () => {
    expect(run([], ENV)).toMatchObject({ code: 1 });
    expect(run([], ENV).out).toContain("Missing --expect-db");
    expect(run(["--expect-db", "something_else"], ENV).out).toContain(`points to database "${dbName}" but you confirmed "something_else"`);
  });
  it("a dry run shows the target and the email, never the password or the address, and changes nothing", () => {
    const r = run(["--expect-db", dbName], ENV);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Moderator email      : mod@robovalley.com");
    expect(r.out).toContain("DRY RUN");
    expect(r.out).not.toContain(PW); expect(r.out).not.toContain(TEST_DATABASE_URL);
  });
  it("a missing variable is named, the others are never shown", () => {
    const r = run(["--expect-db", dbName], { RV_MODERATOR_USER: "Mod", RV_MODERATOR_EMAIL: "mod@robovalley.com" });
    expect(r.code).toBe(1); expect(r.out).toContain("RV_MODERATOR_PASSWORD is not set");
  });
});
