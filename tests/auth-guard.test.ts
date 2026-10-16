// Protected-page guard: getCurrentUser() and the /dashboard Server Component.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/session";

const m = vi.hoisted(() => ({ query: vi.fn(), cookie: undefined as string | undefined }));
vi.mock("../src/lib/db", () => ({ pool: { query: m.query } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "rv_session" && m.cookie ? { name: n, value: m.cookie } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error("REDIRECT:" + to); },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import { getCurrentUser } from "../src/lib/currentUser";
import Dashboard from "../src/app/dashboard/page";
import LoginPage from "../src/app/login/page";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const dbRow = (over: Record<string, unknown> = {}) => ({ id: "7", full_name: "Asha Rao", email: "asha@example.com", role: "TC", email_verification: "email", created_at: "2026-10-01T00:00:00.000Z", age_category: "adult", profile: {}, consents: {}, ...over });
const tokenFor = (id = "7", role = "TC") => createSessionToken({ id, role }, false, Date.now(), { SESSION_SECRET: SECRET } as never).token;

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  m.cookie = undefined;
  m.query.mockReset().mockResolvedValue({ rows: [dbRow()] });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getCurrentUser", () => {
  it("is null without a cookie (and does not query the database)", async () => {
    expect(await getCurrentUser()).toBeNull();
    expect(m.query).not.toHaveBeenCalled();
  });

  it("returns the user for a valid session, reading id from the token via a parameterised query", async () => {
    m.cookie = tokenFor();
    expect(await getCurrentUser()).toEqual({ id: "7", fullName: "Asha Rao", email: "asha@example.com", role: "TC" });
    expect(m.query.mock.calls[0][1]).toEqual(["7"]);
  });

  it("rejects tampered and expired tokens", async () => {
    const t = tokenFor();
    m.cookie = t.slice(0, -3) + "AAA";
    expect(await getCurrentUser()).toBeNull();
    m.cookie = createSessionToken({ id: "7", role: "TC" }, false, Date.now() - 13 * 3600 * 1000, { SESSION_SECRET: SECRET } as never).token;
    expect(await getCurrentUser()).toBeNull();
  });

  it("the role comes from the database, not from the token", async () => {
    m.cookie = tokenFor("7", "SA"); // token claims SA...
    m.query.mockResolvedValue({ rows: [dbRow({ role: "ST" })] }); // ...database says ST
    expect((await getCurrentUser())!.role).toBe("ST");
  });

  it("a deleted user loses access immediately", async () => {
    m.cookie = tokenFor();
    m.query.mockResolvedValue({ rows: [] });
    expect(await getCurrentUser()).toBeNull();
  });

  it("an account that no longer satisfies the verification policy loses access", async () => {
    m.cookie = tokenFor();
    m.query.mockResolvedValue({ rows: [dbRow({ email_verification: "none" })] });
    expect(await getCurrentUser()).toBeNull();
  });

  it("fails closed on database errors", async () => {
    m.cookie = tokenFor();
    m.query.mockRejectedValue(new Error("db down"));
    expect(await getCurrentUser()).toBeNull();
  });
});

describe("protected pages", () => {
  it("/dashboard redirects visitors without a session to /login", async () => {
    await expect(Dashboard()).rejects.toThrow("REDIRECT:/login");
  });

  it("/dashboard renders for a signed-in user", async () => {
    m.cookie = tokenFor();
    const el = await Dashboard();
    const text = JSON.stringify(el);
    expect(text).toContain("Asha"); // greeted by name
    expect(text).toContain("Teacher / lab in-charge"); // role label from the database
  });

  it("/login sends an already signed-in user to the dashboard, and shows the form otherwise", async () => {
    expect(await LoginPage()).toBeTruthy();
    m.cookie = tokenFor();
    await expect(LoginPage()).rejects.toThrow("REDIRECT:/dashboard");
  });
});
