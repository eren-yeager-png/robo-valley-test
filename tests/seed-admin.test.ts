// scripts/seed-admin.mjs: exactly one administrator. Real SQL on the in-process database; no real database.
import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { seedUser, testDb } from "./helpers";
import { DEFAULT_ADMIN_EMAIL, readAdminFromEnv, seedAdmin } from "../scripts/seed-admin.mjs";

const PW = "a-long-test-password-1";
const env = (o: Record<string, string> = {}) => ({ ADMIN_EMAIL: DEFAULT_ADMIN_EMAIL, ADMIN_PASSWORD: PW, ...o }) as unknown as NodeJS.ProcessEnv;
const db = () => ({ query: async (s: string, p?: unknown[]) => ({ rows: (await testDb().raw.query(s, p as never)).rows as any[] }) });
const roles = async () => Object.fromEntries(((await testDb().raw.query("select email, role from users order by id")).rows as any[]).map((r) => [r.email, r.role]));

describe("seed-admin", () => {
  it("creates the one admin with a bcrypt hash (never the plain password), verified, no forced password change", async () => {
    const r = await seedAdmin({ db: db(), env: env() });
    expect(r).toEqual({ email: DEFAULT_ADMIN_EMAIL, action: "created", demoted: 0 });
    const u = (await testDb().raw.query("select role, password_hash, email_verification, must_change_password from users")).rows[0] as any;
    expect(u).toMatchObject({ role: "admin", email_verification: "email", must_change_password: false });
    expect(u.password_hash).not.toContain(PW);
    expect(await bcrypt.compare(PW, u.password_hash)).toBe(true);
  });

  it("demotes every other admin to 'user' and leaves everyone else exactly as they are", async () => {
    await seedUser({ email: "admin@robovalley.com", role: "admin" });
    await seedUser({ email: "yasaswinipilla41@gmail.com", role: "admin" });
    await seedUser({ email: "student@example.com", role: "ST" });
    await seedUser({ email: "parent@example.com", role: "PA" });
    const r = await seedAdmin({ db: db(), env: env() });
    expect(r.demoted).toBe(2);
    expect(await roles()).toEqual({
      "admin@robovalley.com": "user", "yasaswinipilla41@gmail.com": "user", "student@example.com": "ST", "parent@example.com": "PA", [DEFAULT_ADMIN_EMAIL]: "admin",
    });
  });

  it("is idempotent", async () => {
    await seedAdmin({ db: db(), env: env() });
    const hash1 = ((await testDb().raw.query("select password_hash h from users")).rows[0] as any).h;
    const r = await seedAdmin({ db: db(), env: env() });
    expect(r).toEqual({ email: DEFAULT_ADMIN_EMAIL, action: "unchanged", demoted: 0 });
    expect(((await testDb().raw.query("select count(*)::int n from users")).rows[0] as any).n).toBe(1);
    expect(((await testDb().raw.query("select password_hash h from users")).rows[0] as any).h).toBe(hash1);
  });

  it("promotes an existing account without touching its password, unless --reset-password", async () => {
    const u = await seedUser({ email: DEFAULT_ADMIN_EMAIL, role: "PA", password: "old password 123" });
    const before = ((await testDb().raw.query("select password_hash h from users where id=$1", [u.id])).rows[0] as any).h;
    expect((await seedAdmin({ db: db(), env: env() })).action).toBe("promoted");
    expect(((await testDb().raw.query("select password_hash h, role from users where id=$1", [u.id])).rows[0] as any)).toMatchObject({ h: before, role: "admin" });
    expect((await seedAdmin({ db: db(), env: env(), resetPassword: true })).action).toBe("password-reset");
    const after = ((await testDb().raw.query("select password_hash h from users where id=$1", [u.id])).rows[0] as any).h;
    expect(await bcrypt.compare(PW, after)).toBe(true);
  });

  it("matches the email case-insensitively and never creates a second account", async () => {
    await seedUser({ email: "AI@Symbiosystech.com", role: "ST" });
    await seedAdmin({ db: db(), env: env() });
    expect(((await testDb().raw.query("select count(*)::int n from users")).rows[0] as any).n).toBe(1);
  });

  it("rolls everything back if a step fails (no half-done change)", async () => {
    await seedUser({ email: "admin@robovalley.com", role: "admin" });
    const failing = { query: async (s: string, p?: unknown[]) => { if (/SET role = 'user'/.test(s)) throw new Error("boom"); return db().query(s, p); } };
    await expect(seedAdmin({ db: failing, env: env() })).rejects.toThrow("boom");
    expect(await roles()).toEqual({ "admin@robovalley.com": "admin" });
  });

  it("reads ADMIN_EMAIL/ADMIN_PASSWORD, or falls back to the ADMINn pair that holds the default admin address", () => {
    expect(readAdminFromEnv(env()).email).toBe(DEFAULT_ADMIN_EMAIL);
    const e = { ADMIN1_EMAIL: "other@x.com", ADMIN1_PASSWORD: PW, ADMIN3_EMAIL: "AI@symbiosystech.com", ADMIN3_PASSWORD: "third-password-99" } as unknown as NodeJS.ProcessEnv;
    expect(readAdminFromEnv(e)).toMatchObject({ email: DEFAULT_ADMIN_EMAIL, password: "third-password-99", vars: ["ADMIN3_EMAIL", "ADMIN3_PASSWORD"] });
  });

  it("errors name the variable, never the value", () => {
    const secret = "short";
    for (const bad of [{ ADMIN_EMAIL: "a@b.co" }, { ADMIN_EMAIL: "not-an-email", ADMIN_PASSWORD: PW }, { ADMIN_EMAIL: "a@b.co", ADMIN_PASSWORD: secret }, {}]) {
      let msg = "";
      try { readAdminFromEnv(bad as unknown as NodeJS.ProcessEnv); } catch (e) { msg = (e as Error).message; }
      expect(msg).toBeTruthy();
      expect(msg).not.toContain(secret);
      expect(msg).not.toContain(PW);
    }
  });
});
