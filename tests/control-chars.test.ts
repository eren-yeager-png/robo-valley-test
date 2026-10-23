// Regression: a NUL (or other control character) in an email/name/answer used to reach PostgreSQL,
// which rejects it, so the API answered 500 instead of a validation error. Found by a live probe.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakePool, seedUser } from "./helpers";
import { createSessionToken } from "../src/lib/session";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const m = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (n === "rv_session" && m.cookie ? { name: n, value: m.cookie } : undefined) }) }));

import { hasControlChars, normalizeEmail, validateSignup } from "../src/lib/validation";
import { POST as login } from "../src/app/api/auth/login/route";
import { POST as signup } from "../src/app/api/auth/signup/route";
import { POST as otpRequest } from "../src/app/api/auth/otp/request/route";
import { PATCH as updateProfile } from "../src/app/api/account/profile/route";

const BAD = ["\u0000", "\u0001", "\t", "\n", "\r", "\u001F", "\u007F"];
const post = (route: (r: Request) => Promise<Response>, body: unknown) =>
  route(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }));

let ctx: ReturnType<typeof makeFakePool>;
beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  ctx = makeFakePool(); // in-process PostgreSQL with the real migrations; every statement the app runs is recorded in ctx.calls
  m.cookie = undefined;
});

describe("helpers", () => {
  it.each(BAD)("hasControlChars flags %j", (c) => expect(hasControlChars(`a${c}b`)).toBe(true));
  it("does not flag normal text, Telugu/Hindi names, accents or emoji", () => {
    for (const s of ["Asha Rao", "రవి కుమార్", "आशा राव", "José Müller", "O'Brien-Smith", "Ravi 👍"]) expect(hasControlChars(s), s).toBe(false);
  });
  it.each(BAD)("normalizeEmail rejects an email containing %j", (c) => {
    expect(normalizeEmail(`a${c}@b.co`)).toBeNull();
    expect(normalizeEmail(`a@b${c}.co`)).toBeNull();
  });
  it("normalizeEmail still accepts and normalises ordinary addresses", () => {
    expect(normalizeEmail("  Asha.Rao+tag@Example.COM ")).toBe("asha.rao+tag@example.com");
  });
});

const good = () => ({
  role: "TC", fullName: "Asha Rao", mobile: "9876543210", email: "asha@example.com", password: "correct horse", confirmPassword: "correct horse",
  district: "Guntur", language: "English", ageCategory: "adult", consents: { privacy: true, terms: true },
  profile: { school: "ZP High", schoolCode: "1", subjects: ["Maths"] },
});

describe("validateSignup rejects control characters and still accepts unicode", () => {
  it.each([
    ["fullName", { fullName: "Ra\u0000vi" }],
    ["district", { district: "Gun\u0000tur" }],
    ["email", { email: "a\u0000@example.com" }],
    ["profile.school", { profile: { school: "ZP\u0000High", schoolCode: "1", subjects: ["Maths"] } }],
  ])("%s with a NUL byte -> validation error (no database call possible)", (field, over) => {
    const v = validateSignup({ ...good(), ...over });
    expect(v.ok).toBe(false);
    expect((v as { errors: Record<string, string> }).errors[field]).toBeTruthy();
  });

  it("guardian name with a control character is rejected", () => {
    const v = validateSignup({
      ...good(), role: "ST", ageCategory: "minor", profile: { class: "Class 9–10", school: "GHS" },
      guardian: { name: "Lak\u0000shmi", relationship: "Mother", mobile: "9988776655", email: "g@example.com" },
    });
    expect((v as { errors: Record<string, string> }).errors["guardian.name"]).toMatch(/invalid characters/);
  });

  it("Telugu name, apostrophes and emoji in answers are still valid", () => {
    const v = validateSignup({ ...good(), fullName: "రవి కుమార్", district: "Visakhapatnam", profile: { school: "St. Mary's ZP 👍 High", schoolCode: "1", subjects: ["Maths"] } });
    expect(v.ok).toBe(true);
  });
});

describe("API routes answer 400 (not 500) and never touch the database", () => {
  it("login: NUL in email -> 400 validation error", async () => {
    const res = await post(login, { email: "a\u0000@b.co", password: "x" });
    expect(res.status).toBe(400);
    expect((await res.json()).fieldErrors.email).toBeTruthy();
    expect(ctx.calls).toHaveLength(0);
  });

  it("login: a NUL byte in the PASSWORD is just a wrong password (401), never a 500", async () => {
    const res = await post(login, { email: "a@b.co", password: "pass\u0000word" });
    expect(res.status).toBe(401);
  });

  it("signup: NUL in name/district/answers -> 400 before any transaction starts", async () => {
    for (const over of [{ fullName: "Ra\u0000vi" }, { district: "G\u0000" }, { profile: { school: "a\u0000", schoolCode: "1", subjects: ["Maths"] } }]) {
      const res = await post(signup, { ...good(), ...over });
      expect(res.status).toBe(400);
    }
    expect(ctx.calls).toHaveLength(0);
  });

  it("OTP request: NUL in email -> 400", async () => {
    expect((await post(otpRequest, { email: "a\u0000@b.co", purpose: "signup" })).status).toBe(400);
  });

  it("settings API: NUL in name/district -> 400 and no UPDATE issued", async () => {
    const me = await seedUser({ email: "a@e.co", fullName: "A" });
    m.cookie = createSessionToken({ id: me.id, role: "TC" }, false, Date.now(), { SESSION_SECRET: SECRET } as never).token;
    for (const body of [{ fullName: "A\u0000" }, { district: "G\u0000" }]) {
      const res = await updateProfile(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) }));
      expect(res.status).toBe(400);
    }
    expect(ctx.calls.filter((c) => /UPDATE/i.test(c.sql))).toHaveLength(0);
  });
});
