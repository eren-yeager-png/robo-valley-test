import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adultPayload, makeFakePool, minorPayload, pgError, verified } from "./helpers";
import { __resetOtpStore, claimVerification } from "../src/lib/otp";

const fake = vi.hoisted(() => ({ pool: undefined as unknown }));
vi.mock("../src/lib/db", () => ({ get pool() { return fake.pool; } }));

import { POST } from "../src/app/api/auth/signup/route";

let ctx: ReturnType<typeof makeFakePool>;
const setPool = (fail?: Parameters<typeof makeFakePool>[0]) => { ctx = makeFakePool(fail); fake.pool = ctx.pool; };
const post = (body: unknown, raw?: string) =>
  POST(new Request("http://t/api/auth/signup", { method: "POST", body: raw ?? JSON.stringify(body) }));
const insertCalls = () => ctx.calls.filter((c) => /INSERT/.test(c.sql));

beforeEach(() => { __resetOtpStore(); setPool(); });

describe("signup – happy paths", () => {
  it("creates an adult account with a bcrypt hash, never plaintext", async () => {
    const res = await post(adultPayload());
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/hash|correct horse|\$2[aby]\$/);
    const ins = insertCalls()[0];
    const params = ins.params as unknown[];
    expect(params).not.toContain("correct horse");
    const hash = params[7] as string;
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(await bcrypt.compare("correct horse", hash)).toBe(true);
    expect(params[1]).toBe("asha@example.com"); // normalised
    expect(params[6]).toBe("adult");
    expect(params).not.toContain("correct horse"); // confirmPassword is not persisted either
    expect(ctx.calls.map((c) => c.sql.split(/\s/)[0])).toEqual(["BEGIN", "INSERT", "COMMIT"]);
    expect(ctx.released()).toBe(1);
  });

  it("uses only parameterised SQL (no values in SQL text)", async () => {
    await post(adultPayload());
    for (const c of insertCalls()) {
      expect(c.sql).not.toMatch(/asha|9876543210|Guntur/i);
      expect(c.sql).toMatch(/\$1/);
    }
  });

  it("creates a minor student and guardian row in one transaction; consent stays pending/test", async () => {
    const res = await post(minorPayload());
    expect(res.status).toBe(201);
    const [u, g] = insertCalls();
    expect(u.params![6]).toBe("minor");
    expect(u.params![8]).toBe(false); // guardian_consent is NOT true
    expect(g.sql).toMatch(/'pending',\$6,'test'/);
    expect(g.params).toEqual(["1", "Lakshmi Kumar", "Mother", "9988776655", "lakshmi@example.com", "mock"]);
    expect(g.sql).not.toMatch(/'granted'/);
    expect(ctx.calls.map((c) => c.sql.split(/\s/)[0])).toEqual(["BEGIN", "INSERT", "INSERT", "COMMIT"]);
  });

  it("stores NULL for the numeric age column", async () => {
    await post(adultPayload());
    expect(insertCalls()[0].sql).toMatch(/\$6,NULL,\$7/);
  });

  it("accepts an explicit skip of the profile step", async () => {
    const res = await post(adultPayload({ profile: undefined, profileSkipped: true }));
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
    const res = await post(adultPayload(over));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.fieldErrors[field]).toBeTruthy();
    expect(ctx.calls).toHaveLength(0); // nothing reached the DB
  });

  it("rejects invalid JSON and oversized bodies", async () => {
    expect((await post(null, "{not json")).status).toBe(400);
    expect((await post(null, JSON.stringify({ x: "a".repeat(40_000) }))).status).toBe(413);
  });

  it("rejects a client-forged 'verified' flag as proof", async () => {
    const res = await post(adultPayload({ verified: true, verification: { signup: "a".repeat(64) } }));
    expect(res.status).toBe(403);
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
    const res = await post(minorPayload({ guardian: g(over) }));
    expect(res.status).toBe(400);
    expect((await res.json()).fieldErrors[field]).toBeTruthy();
  });

  it("rejects missing guardian details for a minor", async () => {
    const res = await post(minorPayload({ guardian: undefined }));
    expect(res.status).toBe(400);
    const f = (await res.json()).fieldErrors;
    expect(f["guardian.name"] && f["guardian.mobile"]).toBeTruthy();
  });

  it("requires a guardian verification (failed guardian verification)", async () => {
    const p = minorPayload();
    const res = await post({ ...p, verification: { signup: p.verification.signup, guardian: undefined } });
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.which).toBe("guardian");
    expect(ctx.calls).toHaveLength(0);
  });

  it("does not accept the student's token as the guardian's", async () => {
    const p = minorPayload();
    const res = await post({ ...p, verification: { signup: p.verification.signup, guardian: verified("signup", "lakshmi@example.com") } });
    expect(res.status).toBe(403);
  });
});

describe("signup – OTP cannot be bypassed", () => {
  it("rejects signup with no verification token", async () => {
    const res = await post(adultPayload({}, false));
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toBe("VERIFICATION_REQUIRED");
  });

  it("rejects a token issued for a different email address", async () => {
    const res = await post(adultPayload({ verification: { signup: verified("signup", "someone.else@example.com") } }));
    expect(res.status).toBe(403);
  });

  it("a token cannot be used twice", async () => {
    const p = adultPayload();
    expect((await post(p)).status).toBe(201);
    setPool();
    expect((await post({ ...p, email: "other@example.com" })).status).toBe(403);
  });
});

describe("signup – database failures", () => {
  it("returns 409 for duplicate email and keeps the token usable", async () => {
    setPool((sql) => (/INSERT INTO users/.test(sql) ? pgError("23505", "users_email_key") : undefined));
    const p = adultPayload();
    const res = await post(p);
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.fieldErrors.email).toBeTruthy();
    expect(JSON.stringify(body)).not.toMatch(/users_email_key|23505|INSERT/);
    expect(ctx.calls.map((c) => c.sql.split(/\s/)[0])).toContain("ROLLBACK");
    expect(claimVerification(p.verification.signup, "signup", "asha@example.com")).not.toBeNull(); // restored
  });

  it("also maps the case-insensitive email index to 409", async () => {
    setPool((sql) => (/INSERT INTO users/.test(sql) ? pgError("23505", "users_email_lower_key") : undefined));
    expect((await post(adultPayload())).status).toBe(409);
  });

  it("rolls back the user insert if the guardian insert fails", async () => {
    setPool((sql) => (/INSERT INTO guardian_details/.test(sql) ? pgError("XX000") : undefined));
    const res = await post(minorPayload());
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(JSON.stringify(body)).not.toMatch(/XX000|guardian_details|stack/);
    const verbs = ctx.calls.map((c) => c.sql.split(/\s/)[0]);
    expect(verbs).toEqual(["BEGIN", "INSERT", "INSERT", "ROLLBACK"]);
    expect(verbs).not.toContain("COMMIT");
    expect(ctx.released()).toBe(1);
  });

  it("returns a safe 500 when the database is unreachable", async () => {
    fake.pool = { connect: async () => { throw new Error("connect ECONNREFUSED secret-host"); } };
    const res = await post(adultPayload());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/ECONNREFUSED|secret-host/);
  });
});
