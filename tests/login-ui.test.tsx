// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";

const h = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: h.replace, refresh: h.refresh, push: vi.fn() }) }));

import LoginForm from "../src/app/login/LoginForm";
import { POST as loginRoute } from "../src/app/api/auth/login/route";

const PASSWORD = "correct horse";
let calls: Array<Record<string, unknown>>;
let gate: Promise<void> | null;

beforeEach(async () => {
  await seedUser(); // the account the UI signs in to (database was emptied by ./helpers)
  calls = []; gate = null;
  h.replace.mockReset(); h.refresh.mockReset();
  vi.stubEnv("SESSION_SECRET", "unit-test-secret-unit-test-secret-1234");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(init.body as string));
    if (gate) await gate;
    return loginRoute(new Request("http://localhost/api/auth/login", { method: "POST", body: init.body as string }));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const setup = () => { const user = userEvent.setup(); render(<LoginForm />); return user; };
const email = () => screen.getByLabelText(/Email address/) as HTMLInputElement;
const pw = () => document.getElementById("login-password") as HTMLInputElement;
const submit = () => screen.getByRole("button", { name: /Sign in|Signing in/ }) as HTMLButtonElement;

describe("login page UI", () => {
  it("shows the heading, subtitle, labelled fields and a sign-up link", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Welcome back");
    expect(screen.getByText(/Sign in to your RoboValley account/)).toBeTruthy();
    expect(email().type).toBe("email");
    expect(pw().type).toBe("password");
    expect(screen.getByText(/Don't have an account\?/)).toBeTruthy();
    expect((screen.getByRole("link", { name: "Sign up" }) as HTMLAnchorElement).getAttribute("href")).toBe("/join");
  });

  it("'Forgot password?' is clearly unavailable, not a fake link", () => {
    setup();
    expect(screen.getByText(/Forgot password\?/).closest("[aria-disabled='true']")).toBeTruthy();
    expect(screen.getByText("Coming soon")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Forgot/ })).toBeNull();
  });

  it("show/hide password toggles the field type and reports its state", async () => {
    const user = setup();
    const toggle = screen.getByRole("button", { name: /Show/ });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await user.click(toggle);
    expect(pw().type).toBe("text");
    expect(screen.getByRole("button", { name: /Hide/ }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: /Hide/ }));
    expect(pw().type).toBe("password");
  });
});

describe("validation", () => {
  it("shows inline errors and sends nothing for empty fields", async () => {
    const user = setup();
    await user.click(submit());
    expect(screen.getByText("Enter your email address.")).toBeTruthy();
    expect(screen.getByText("Enter your password.")).toBeTruthy();
    expect(email().getAttribute("aria-invalid")).toBe("true");
    expect(calls).toHaveLength(0);
  });

  it("rejects a malformed email", async () => {
    const user = setup();
    await user.type(email(), "not-an-email");
    await user.type(pw(), PASSWORD);
    await user.click(submit());
    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});

describe("submitting", () => {
  it("success: posts the credentials and moves to the dashboard", async () => {
    const user = setup();
    await user.type(email(), "Asha@Example.com");
    await user.type(pw(), PASSWORD);
    await user.click(submit());
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/dashboard"));
    expect(calls).toEqual([{ email: "Asha@Example.com", password: PASSWORD, remember: false }]);
  });

  it("'Remember me' is sent to the server", async () => {
    const user = setup();
    await user.type(email(), "asha@example.com");
    await user.type(pw(), PASSWORD);
    await user.click(screen.getByLabelText(/Remember me/));
    await user.click(submit());
    await waitFor(() => expect(calls[0].remember).toBe(true));
  });

  it("wrong credentials: generic error, email kept, password cleared, form usable again", async () => {
    const user = setup();
    await user.type(email(), "asha@example.com");
    await user.type(pw(), "wrong password");
    await user.click(submit());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Incorrect email or password."));
    expect(email().value).toBe("asha@example.com");
    expect(pw().value).toBe("");
    expect(submit().disabled).toBe(false);
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("an unknown email shows the very same message", async () => {
    await testDb().raw.exec("delete from users"); // no such account
    const user = setup();
    await user.type(email(), "nobody@example.com");
    await user.type(pw(), "whatever123");
    await user.click(submit());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Incorrect email or password."));
  });

  it("loading state: button disabled while pending and only one request is sent", async () => {
    const user = setup();
    await user.type(email(), "asha@example.com");
    await user.type(pw(), PASSWORD);
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    await user.click(submit());
    await waitFor(() => expect(submit().disabled).toBe(true));
    expect(submit().textContent).toMatch(/Signing in/);
    await user.click(submit());
    await user.type(pw(), "{Enter}");
    release();
    await waitFor(() => expect(h.replace).toHaveBeenCalled());
    expect(calls).toHaveLength(1);
  });

  it("shows server-side field errors and network errors", async () => {
    const user = setup();
    await user.type(email(), "asha@example.com");
    await user.type(pw(), PASSWORD);
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("offline"));
    await user.click(submit());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Could not reach the server/));
    expect(submit().disabled).toBe(false);
  });

  it("unverified email: shows the verification message", async () => {
    await testDb().raw.exec("update users set email_verification = 'none'");
    const user = setup();
    await user.type(email(), "asha@example.com");
    await user.type(pw(), PASSWORD);
    await user.click(submit());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/verify your email/));
    expect(h.replace).not.toHaveBeenCalled();
  });
});
