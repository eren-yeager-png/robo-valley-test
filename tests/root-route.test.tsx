// @vitest-environment jsdom
// "/" shows the existing login UI. It must reuse the login page (no copy), keep /login working,
// keep the Sign up -> /join link, and never create a redirect loop.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken } from "../src/lib/session";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const m = vi.hoisted(() => ({ query: vi.fn(), cookie: undefined as string | undefined }));
vi.mock("../src/lib/db", () => ({ pool: { query: m.query } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "rv_session" && m.cookie ? { name: n, value: m.cookie } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error("REDIRECT:" + to); },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import RootPage, { metadata as rootMetadata } from "../src/app/page";
import LoginPage, { metadata as loginMetadata } from "../src/app/login/page";
import DashboardHome from "../src/app/dashboard/page";
import JoinFlow from "../src/app/join/JoinFlow";
import { destinationFor } from "../src/lib/session";

const row = (role: string) => ({
  id: "7", full_name: "Asha Rao", email: "asha@example.com", role, mobile: null, district: "Guntur", preferred_language: "English",
  age_category: "adult", email_verification: "email", created_at: "2026-10-01T00:00:00.000Z", profile: {}, consents: {},
});
const signInAs = (role: string) => {
  m.query.mockResolvedValue({ rows: [row(role)] });
  m.cookie = createSessionToken({ id: "7", role }, false, Date.now(), { SESSION_SECRET: SECRET } as never).token;
};

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  m.cookie = undefined;
  m.query.mockReset().mockResolvedValue({ rows: [] });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("root route reuses the login page", () => {
  it("is literally the same page component and metadata as /login (nothing duplicated)", () => {
    expect(RootPage).toBe(LoginPage);
    expect(rootMetadata).toBe(loginMetadata);
  });

  it("an anonymous visitor to / sees the existing login form", async () => {
    render(await RootPage());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Welcome back");
    expect(screen.getByLabelText(/Email address/)).toBeTruthy();
    expect(document.getElementById("login-password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByText(/Forgot password\?/)).toBeTruthy();
  });

  it("/login still renders the same login form", async () => {
    render(await LoginPage());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Welcome back");
  });

  it("keeps \"Don't have an account? Sign up\" pointing to /join", async () => {
    render(await RootPage());
    expect(screen.getByText(/Don't have an account\?/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign up" }).getAttribute("href")).toBe("/join");
  });

  it("the signup page still links existing members to /login", () => {
    render(<JoinFlow />);
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Join the RoboValley Community");
  });
});

describe("no redirect loop", () => {
  it("a forged or invalid cookie is treated as signed out: / renders the form, it does not redirect", async () => {
    m.cookie = "not-a-real-token";
    render(await RootPage());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Welcome back");
    expect(m.query).not.toHaveBeenCalled();
  });

  it("a valid cookie whose user no longer exists is signed out: / renders the form", async () => {
    signInAs("ST");
    m.query.mockResolvedValue({ rows: [] });
    render(await RootPage());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Welcome back");
  });

  it.each(["ST", "PA", "TC", "SA", "MG", "ME", "TR", "AR", "KS", "FS", "SP", "IP"])(
    "a signed-in %s is sent from / to the role destination, and that destination does NOT send them back to /",
    async (role) => {
      signInAs(role);
      const target = destinationFor(role);
      await expect(RootPage()).rejects.toThrow(`REDIRECT:${target}`);
      expect(target).toBe("/dashboard");
      // the destination renders for this user (it does not redirect anywhere)
      const page = await DashboardHome();
      expect(page).toBeTruthy();
    }
  );

  it("the only redirect from a protected page goes to /login (which renders), never back to /", async () => {
    await expect(DashboardHome()).rejects.toThrow("REDIRECT:/login");
    render(await LoginPage()); // /login for an anonymous visitor renders; it does not redirect
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Welcome back");
  });
});
