import { vi } from "vitest";
import { requestOtp, verifyOtp, type OtpPurpose } from "../src/lib/otp";

export type Call = { sql: string; params?: unknown[] };

/** Fake pg pool. `fail(sql)` may return an error to throw for a matching statement. */
export function makeFakePool(fail?: (sql: string, params?: unknown[]) => Error | undefined) {
  const calls: Call[] = [];
  let released = 0;
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      const err = fail?.(sql, params);
      if (err) throw err;
      if (/INSERT INTO users/.test(sql)) {
        return { rows: [{ id: "1", full_name: params![0], email: params![1], role: params![3], age_category: params![6] }] };
      }
      return { rows: [] };
    }),
    release: vi.fn(() => void released++),
  };
  return { pool: { connect: async () => client as never }, calls, client, released: () => released };
}

export const pgError = (code: string, constraint?: string) => Object.assign(new Error("pg error"), { code, constraint });

/** Run the OTP flow (mock provider) and return the verification token (what the UI does). */
export function verified(purpose: OtpPurpose, email: string): string {
  const { code } = requestOtp(purpose, email);
  return verifyOtp(purpose, email, code).verificationToken;
}

export function adultPayload(over: Record<string, unknown> = {}, withToken = true) {
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
    verification: { signup: withToken ? verified("signup", "asha@example.com") : undefined },
    ...over,
  };
}

export function minorPayload(over: Record<string, unknown> = {}) {
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
    verification: { signup: verified("signup", "ravi@example.com"), guardian: verified("guardian", "lakshmi@example.com") },
    ...over,
  };
}
