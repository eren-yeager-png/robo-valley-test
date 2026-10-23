// Shared test helpers. Importing this file gives the test file its own in-process PostgreSQL (PGlite) database,
// created with the real migrations before the tests run and emptied before each test. No real database is used.
//
// Every test file that exercises code touching the database mocks "../src/lib/db" like this (note: it must NOT
// import ./helpers itself, which would be circular; it reads the pool from the dependency-free currentPool module):
//   vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { requestOtp, verifyOtp, type OtpPurpose } from "../src/lib/otp";
import { getPool, setPool } from "./helpers/currentPool";
import { createHarness, type Call, type Harness } from "./helpers/db";

export type { Call };

let harness: Harness | undefined;
let tick = 0; // synthetic clock for arranging state: each helper-issued code is "requested" 31 s after the previous

beforeAll(async () => { harness = await createHarness(); setPool(harness.pool); });
beforeEach(async () => { tick = 0; await harness!.reset(); setPool(harness!.pool); }); // also drops any override from a previous test
afterAll(async () => { await harness?.close(); harness = undefined; });

/** The in-process test database (raw access, quiet pool, recorded calls ...). */
export const testDb = () => harness!;
/** What the application's `pool` resolves to during a test (the harness, unless overridden). */
export const testPool = (): any => getPool();
/** Replace the application's pool for the rest of the current test (e.g. to simulate an unreachable database). */
export const overridePool = (p: unknown) => setPool(p);

export type FailRule = (sql: string, params?: unknown[]) => Error | undefined;

/** Pool backed by the in-process database. `fail` may return an error to throw for a matching statement. */
export function makeFakePool(fail?: FailRule) {
  const h = harness!;
  h.failOn(fail);
  return { pool: h.pool, calls: h.calls, released: h.released };
}

export const pgError = (code: string, constraint?: string) => Object.assign(new Error("pg error"), { code, constraint });

/**
 * Run the OTP flow (mock provider) and return the verification token (what the UI does). Not recorded in `calls`.
 * Uses a synthetic clock that moves forward 31 s per call, so arranging several tokens for one email does not
 * trip the real 30-second resend cooldown. (Tests of the cooldown itself use the routes/functions directly.)
 */
export async function verified(purpose: OtpPurpose, email: string): Promise<string> {
  const now = Date.now() + ++tick * 31_000;
  const { code } = await requestOtp(purpose, email, now, harness!.quiet);
  return (await verifyOtp(purpose, email, code, now, harness!.quiet)).verificationToken;
}

export async function adultPayload(over: Record<string, unknown> = {}, withToken = true) {
  const mobile = "9876543210";
  return {
    role: "TC",
    fullName: "Asha Rao",
    mobile,
    email: "Asha@Example.com",
    password: "correct horse",
    confirmPassword: "correct horse",
    district: "Guntur",
    language: "English",
    ageCategory: "adult",
    consents: { privacy: true, terms: true, whatsapp: true },
    profile: { school: "ZP High School", schoolCode: "12345", subjects: ["Science", "Maths"] },
    verification: { signup: withToken ? await verified("signup", "asha@example.com") : undefined },
    ...over,
  };
}

export async function minorPayload(over: Record<string, unknown> = {}) {
  const mobile = "9123456780";
  const gm = "9988776655";
  return {
    role: "ST",
    fullName: "Ravi Kumar",
    mobile,
    email: "ravi@example.com",
    password: "longenough1",
    confirmPassword: "longenough1",
    district: "Krishna",
    language: "Telugu",
    ageCategory: "minor",
    guardian: { name: "Lakshmi Kumar", relationship: "Mother", mobile: gm, email: "lakshmi@example.com" },
    consents: { privacy: true, terms: true },
    profile: { class: "Class 9–10", school: "Govt High School" },
    verification: { signup: await verified("signup", "ravi@example.com"), guardian: await verified("guardian", "lakshmi@example.com") },
    ...over,
  };
}

/** Inserts a user directly (not recorded in `calls`). The password is hashed with bcrypt at a low cost, for speed only. */
export async function seedUser(over: Partial<{
  email: string; password: string; role: string; fullName: string; emailVerification: string; ageCategory: string | null;
  profile: object; consents: object; district: string;
}> = {}) {
  const o = { email: "asha@example.com", password: "correct horse", role: "TC", fullName: "Asha Rao", emailVerification: "email", ageCategory: "adult", profile: {}, consents: {}, district: "Guntur", ...over };
  const hash = await bcrypt.hash(o.password, 4);
  const r = await harness!.raw.query(
    `insert into users (full_name,email,mobile,role,district,preferred_language,age_category,password_hash,profile,consents,email_verification)
     values ($1,$2,'9876543210',$3,$4,'English',$5,$6,$7::jsonb,$8::jsonb,$9) returning id`,
    [o.fullName, o.email, o.role, o.district, o.ageCategory, hash, JSON.stringify(o.profile), JSON.stringify(o.consents), o.emailVerification]
  );
  return { id: String((r.rows[0] as any).id), ...o };
}
