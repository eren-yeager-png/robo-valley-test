// Signup API against an in-process PostgreSQL (real SQL, real migrations; see tests/helpers.ts).
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adultPayload, makeFakePool, minorPayload, overridePool, pgError, testDb, verified } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });

import { POST } from "../src/app/api/auth/signup/route";

let ctx: ReturnType<typeof makeFakePool>;
const setPool = (fail?: Parameters<typeof makeFakePool>[0]) => { ctx = makeFakePool(fail); };
const post = (body: unknown, raw?: string) =>
  POST(new Request("http://t/api/auth/signup", { method: "POST", body: raw ?? JSON.stringify(body) }));
const insertCalls = () => ctx.calls.filter((c) => /INSERT/.test(c.sql));
const verbs = () => ctx.calls.map((c) => c.sql.trim().split(/\s/)[0]);
const count = async (t: string) => Number((await testDb().raw.query(`select count(*)::int n from ${t}`)).rows[0]!["n" as never]);

beforeEach(() => { setPool(); });

describe("signup – happy paths", () => {
  it("creates an adult account with a bcrypt hash, never plaintext", async () => {
    const res = await post(await adultPayload());
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/hash|correct horse|\$2[aby]\$/);
    const params = insertCalls()[0].params as unknown[];
    expect(params).not.toContain("correct horse");
    const hash = params[7] as string;
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(await bcrypt.compare("correct horse", hash)).toBe(true);
    expect(params[1]).toBe("asha@example.com"); // normalised
    expect(params[6]).toBe("adult");
    // the verification token is consumed INSIDE the signup transaction (claim, insert, commit)
    expect(verbs()).toEqual(["BEGIN", "DELETE", "INSERT", "COMMIT"]);
    expect(ctx.released()).toBe(1);
  });

  it("persists the account in the database and consumes the verification token", async () => {
    await post(await adultPayload());
    const u = (await testDb().raw.query("select email, role, age, age_category, guardian_consent, email_verification, password_hash from users")).rows[0] as any;
    expect(u).toMatchObject({ email: "asha@example.com", role: "TC", age: null, age_category: "adult", guardian_consent: null, email_verification: "mock" });
    expect(u.password_hash).not.toContain("correct horse");
    expect(await count("users")).toBe(1);
    expect(await count("guardian_details")).toBe(0);
    expect(await count("email_verifications")).toBe(0); // single use
  });

  it("uses only parameterised SQL (no values in SQL text)", async () => {
    await post(await adultPayload());
    for (const c of ctx.calls) {
      expect(c.sql).not.toMatch(/asha|9876543210|Guntur/i);
    }
    expect(insertCalls()[0].sql).toMatch(/\$1/);
  });

  it("creates a minor student and guardian row in one transaction; consent stays pending/test", async () => {
    const res = await post(await minorPayload());
    expect(res.status).toBe(201);
    const [u, g] = insertCalls();
    expect(u.params![6]).toBe("minor");
    expect(u.params![8]).toBe(false); // guardian_consent is NOT true
    expect(g.sql).toMatch(/'pending',\$6,'test'/);
    expect(g.params).toEqual(["1", "Lakshmi Kumar", "Mother", "9988776655", "lakshmi@example.com", "mock"]);
    expect(g.sql).not.toMatch(/'granted'/);
    expect(verbs()).toEqual(["BEGIN", "DELETE", "DELETE", "INSERT", "INSERT", "COMMIT"]);
    const row = (await testDb().raw.query("select consent_status, consent_mode, consent_recorded_at, guardian_email from guardian_details")).rows[0] as any;
    expect(row).toMatchObject({ consent_status: "pending", consent_mode: "test", consent_recorded_at: null, guardian_email: "lakshmi@example.com" });
    expect(await count("email_verifications")).toBe(0);
  });

  it("stores NULL for the numeric age column", async () => {
    await post(await adultPayload());
    expect(insertCalls()[0].sql).toMatch(/\$6,NULL,\$7/);
  });

  it("accepts an explicit skip of the profile step", async () => {
    const res = await post(await adultPayload({ profile: undefined, profileSkipped: true }));
    expect(res.status).toBe(201);
    expect(insertCalls()[0].params![9]).toBe("{}");
  });
});

describe("signup – validation", () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ["missing name", { fullName: "" }, "fullName"],
    ["invalid email", { email: "nope" }, "email"],
    ["invalid mobile", { mobile: "12345" }, "mobile"],
    ["mobile starting with 5", { mobile: "5876543210" }, "mobile"],
    ["short password", { password: "short", confirmPassword: "short" }, "password"],
    ["mismatched passwords", { confirmPassword: "different pass" }, "confirmPassword"],
    ["unsupported role", { role: "XX" }, "role"],
    ["missing district", { district: " " }, "district"],
    ["bad language", { language: "Klingon" }, "language"],
    ["missing age category", { ageCategory: undefined }, "ageCategory"],
    ["invalid age category", { ageCategory: "teen" }, "ageCategory"],
    ["minor with non-student role", { ageCategory: "minor", role: "TC", guardian: { name: "A", relationship: "Mother", mobile: "9988776655", email: "g@example.com" } }, "ageCategory"],
    ["missing required profile answer", { profile: { school: "x" } }, "profile.schoolCode"],
    ["unknown profile field", { profile: { school: "x", schoolCode: "1", subjects: ["Maths"], evil: "y" } }, "profile.evil"],
    ["profile option not in list", { profile: { school: "x", schoolCode: "1", subjects: ["Hacking"] } }, "profile.subjects"],
    ["terms not accepted", { consents: { privacy: true, terms: false } }, "consents"],
    ["guardian on adult", { guardian: { name: "A", relationship: "Mother", mobile: "9988776655", email: "g@example.com" } }, "guardian"],
    ["overlong name", { fullName: "x".repeat(101) }, "fullName"],
  ];
  it.each(cases)("rejects: %s", async (_n, over, field) => {
    const res = await post(await adultPayload(over));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.fieldErrors[field]).toBeTruthy();
    expect(ctx.calls).toHaveLength(0); // nothing reached the DB
  });

  it("rejects invalid JSON and oversized bodies", async () => {
    expect((await post(null, "{not json")).status).toBe(400);
    expect((await post(null, JSON.stringify({ x: "a".repeat(40_000) }))).status).toBe(413);
  });

  it("rejects a client-forged 'verified' flag and a made-up (well-formed) token; nothing is stored", async () => {
    const res = await post(await adultPayload({ verified: true, verification: { signup: "a".repeat(64) } }));
    expect(res.status).toBe(403);
    expect(insertCalls()).toHaveLength(0);
    expect(verbs()).toEqual(["BEGIN", "DELETE", "ROLLBACK"]);
    expect(await count("users")).toBe(0);
  });

  it("a malformed token is refused without touching the database or spending time hashing the password", async () => {
    for (const bad of ["not-a-token", "", "A".repeat(64), "z".repeat(64), "a".repeat(63)]) {
      const res = await post(await adultPayload({ verification: { signup: bad } }));
      expect(res.status, bad).toBe(403);
    }
    expect(ctx.calls).toHaveLength(0);
  });
});

describe("signup – guardian", () => {
  const g = (over: object) => ({ name: "Lakshmi", relationship: "Mother", mobile: "9988776655", email: "lakshmi@example.com", ...over });
  it.each([
    ["invalid guardian mobile", { mobile: "123" }, "guardian.mobile"],
    ["guardian number equals student's", { mobile: "9123456780" }, "guardian.mobile"],
    ["invalid guardian email", { email: "not-an-email" }, "guardian.email"],
    ["guardian email equals student's", { email: "RAVI@example.com" }, "guardian.email"],
    ["missing guardian email", { email: "" }, "guardian.email"],
    ["missing guardian name", { name: "" }, "guardian.name"],
    ["bad relationship", { relationship: "Neighbour" }, "guardian.relationship"],
  ])("rejects %s", async (_n, over, field) => {
    const res = await post(await minorPayload({ guardian: g(over) }));
    expect(res.status).toBe(400);
    expect((await res.json()).fieldErrors[field]).toBeTruthy();
  });

  it("rejects missing guardian details for a minor", async () => {
    const res = await post(await minorPayload({ guardian: undefined }));
    expect(res.status).toBe(400);
    const f = (await res.json()).fieldErrors;
    expect(f["guardian.name"] && f["guardian.mobile"]).toBeTruthy();
  });

  it("requires a guardian verification (failed guardian verification)", async () => {
    const p = await minorPayload();
    const res = await post({ ...p, verification: { signup: p.verification.signup, guardian: undefined } });
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.which).toBe("guardian");
    expect(ctx.calls).toHaveLength(0);
  });

  it("does not accept the student's token as the guardian's; the student's own token is not consumed either", async () => {
    const p = await minorPayload();
    const wrongPurpose = await verified("signup", "lakshmi@example.com");
    const res = await post({ ...p, verification: { signup: p.verification.signup, guardian: wrongPurpose } });
    expect(res.status).toBe(403);
    expect((await res.json()).which).toBe("guardian");
    expect(await count("users")).toBe(0);
    expect(await count("email_verifications")).toBe(3); // all three tokens still available (rolled back together)
  });
});

describe("signup – OTP cannot be bypassed", () => {
  it("rejects signup with no verification token", async () => {
    const res = await post(await adultPayload({}, false));
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toBe("VERIFICATION_REQUIRED");
  });

  it("rejects a token issued for a different email address", async () => {
    const res = await post(await adultPayload({ verification: { signup: await verified("signup", "someone.else@example.com") } }));
    expect(res.status).toBe(403);
    expect(await count("users")).toBe(0);
  });

  it("a token cannot be used twice", async () => {
    const p = await adultPayload();
    expect((await post(p)).status).toBe(201);
    expect((await post({ ...p, email: "other@example.com" })).status).toBe(403);
    expect(await count("users")).toBe(1);
  });

  it("two simultaneous submissions with the same token create exactly one account", async () => {
    const p = await adultPayload();
    const results = await Promise.all([post(p), post(p)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 403]);
    expect(await count("users")).toBe(1);
  });
});

describe("signup – database failures", () => {
  it("returns 409 for a duplicate email and keeps the token usable", async () => {
    const first = await adultPayload();
    expect((await post(first)).status).toBe(201);
    const p = await adultPayload({ fullName: "Someone Else" }); // new token, same email
    const res = await post(p);
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.message).toBe("An account with this email already exists.");
    expect(body.fieldErrors.email).toBe("An account with this email already exists.");
    expect(JSON.stringify(body)).not.toMatch(/users_email_key|23505|INSERT/);
    expect(verbs()).toContain("ROLLBACK");
    expect(await count("users")).toBe(1);
    expect(await count("email_verifications")).toBe(1); // the second token survived the rollback
  });

  it("a different letter-case of the same email is also a duplicate (real unique index)", async () => {
    expect((await post(await adultPayload())).status).toBe(201);
    const res = await post(await adultPayload({ email: "ASHA@EXAMPLE.COM" }));
    expect(res.status).toBe(409);
  });

  it("maps either email constraint name to 409 (simulated errors)", async () => {
    for (const constraint of ["users_email_key", "users_email_lower_key"]) {
      setPool((sql) => (/INSERT INTO users/.test(sql) ? pgError("23505", constraint) : undefined));
      expect((await post(await adultPayload())).status, constraint).toBe(409);
      await testDb().reset();
    }
  });

  it("rolls back the user insert and keeps all tokens if the guardian insert fails", async () => {
    setPool((sql) => (/INSERT INTO guardian_details/.test(sql) ? pgError("XX000") : undefined));
    const res = await post(await minorPayload());
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(JSON.stringify(body)).not.toMatch(/XX000|guardian_details|stack/);
    expect(verbs()).toEqual(["BEGIN", "DELETE", "DELETE", "INSERT", "INSERT", "ROLLBACK"]);
    expect(verbs()).not.toContain("COMMIT");
    expect(ctx.released()).toBe(1);
    expect(await count("users")).toBe(0);
    expect(await count("email_verifications")).toBe(2);
  });

  it("returns a safe 500 when the database is unreachable", async () => {
    const p = await adultPayload();
    overridePool({ connect: async () => { throw new Error("connect ECONNREFUSED secret-host"); } });
    const res = await post(p);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/ECONNREFUSED|secret-host/);
  });
});
