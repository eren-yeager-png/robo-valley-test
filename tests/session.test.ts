import { describe, expect, it } from "vitest";
import {
  canSignIn, createSessionToken, destinationFor, REMEMBER_TTL_SECONDS, SESSION_TTL_SECONDS,
  SessionConfigError, sessionCookieOptions, verifySessionToken,
} from "../src/lib/session";

const env = { SESSION_SECRET: "unit-test-secret-unit-test-secret-1234" } as unknown as NodeJS.ProcessEnv;
const user = { id: "42", role: "TC" };
const NOW = 1_800_000_000_000;

describe("session tokens", () => {
  it("round-trips and carries only id, role and times", () => {
    const { token, maxAgeSeconds } = createSessionToken(user, false, NOW, env);
    expect(maxAgeSeconds).toBe(SESSION_TTL_SECONDS);
    const p = verifySessionToken(token, NOW + 1000, env)!;
    expect(p).toMatchObject({ sub: "42", role: "TC", rem: false });
    expect(Object.keys(p).sort()).toEqual(["exp", "iat", "rem", "sub", "role", "v"].sort());
  });

  it("remember-me lasts 30 days, otherwise 12 hours", () => {
    expect(createSessionToken(user, true, NOW, env).maxAgeSeconds).toBe(REMEMBER_TTL_SECONDS);
    expect(REMEMBER_TTL_SECONDS).toBe(30 * 24 * 3600);
    expect(SESSION_TTL_SECONDS).toBe(12 * 3600);
  });

  it("rejects an expired token", () => {
    const { token } = createSessionToken(user, false, NOW, env);
    expect(verifySessionToken(token, NOW + (SESSION_TTL_SECONDS + 1) * 1000, env)).toBeNull();
  });

  it("rejects a tampered payload (e.g. role elevation) and a tampered signature", () => {
    const { token } = createSessionToken(user, false, NOW, env);
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), role: "SA" })).toString("base64url");
    expect(verifySessionToken(`${forged}.${sig}`, NOW, env)).toBeNull();
    expect(verifySessionToken(`${body}.${sig.slice(0, -2)}AA`, NOW, env)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const { token } = createSessionToken(user, false, NOW, { SESSION_SECRET: "another-secret-another-secret-123456" } as never);
    expect(verifySessionToken(token, NOW, env)).toBeNull();
  });

  it("rejects garbage without throwing", () => {
    for (const bad of [undefined, null, 5, "", "a", "a.b.c", "x".repeat(5000), "e30.e30", "!!.!!"]) {
      expect(verifySessionToken(bad, NOW, env)).toBeNull();
    }
  });

  it("refuses to work without a strong SESSION_SECRET (no insecure default)", () => {
    expect(() => createSessionToken(user, false, NOW, {} as never)).toThrow(SessionConfigError);
    expect(() => createSessionToken(user, false, NOW, { SESSION_SECRET: "short" } as never)).toThrow(SessionConfigError);
    const { token } = createSessionToken(user, false, NOW, env);
    expect(verifySessionToken(token, NOW, {} as never)).toBeNull();
  });
});

describe("cookie options", () => {
  it("is HttpOnly + SameSite=Lax + path /, and Secure only in production", () => {
    expect(sessionCookieOptions(undefined, { NODE_ENV: "development" } as never)).toEqual({ httpOnly: true, secure: false, sameSite: "lax", path: "/" });
    expect(sessionCookieOptions(100, { NODE_ENV: "production" } as never)).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 100 });
  });
});

describe("email verification policy", () => {
  it("real email verification always passes; none never passes", () => {
    expect(canSignIn("email", { NODE_ENV: "production" } as never)).toBe(true);
    expect(canSignIn("none", { NODE_ENV: "development" } as never)).toBe(false);
    expect(canSignIn(undefined, {} as never)).toBe(false);
  });
  it("mock-verified accounts pass outside production only", () => {
    expect(canSignIn("mock", { NODE_ENV: "development" } as never)).toBe(true);
    expect(canSignIn("mock", { NODE_ENV: "production" } as never)).toBe(false);
  });
});

describe("destination", () => {
  it("every role currently lands on the shared dashboard", () => {
    for (const r of ["ST", "PA", "TC", "SA"]) expect(destinationFor(r)).toBe("/dashboard");
  });
});
