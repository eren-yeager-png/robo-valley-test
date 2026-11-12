// @vitest-environment jsdom
// The Forgot password and Choose a new password pages (the forms only; the routes have their own tests).
import { StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ForgotForm from "../src/app/forgot-password/ForgotForm";
import ResetForm, { tokenFromHash } from "../src/app/reset-password/ResetForm";

const TOKEN = "A".repeat(20) + "b_-".repeat(7) + "Zz"; // 43 characters
let calls: Array<{ url: string; body: any }>;
let answer: { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  answer = { status: 200, body: { success: true, message: "If an account exists for that email address, we have sent a link." } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

describe("Forgot password page", () => {
  it("when reset is not configured it says so and shows no form", () => {
    render(<ForgotForm available={false} />);
    expect(screen.getByRole("status").textContent).toMatch(/Password reset is not available yet/);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to sign in" }).getAttribute("href")).toBe("/login");
  });

  it("checks the address before sending, then shows the server's same-for-everyone message", async () => {
    const user = userEvent.setup();
    render(<ForgotForm available />);
    await user.type(screen.getByLabelText(/Email address/), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(calls).toHaveLength(0);
    expect(screen.getByRole("alert").textContent).toBe("Enter a valid email address.");
    await user.clear(screen.getByLabelText(/Email address/));
    await user.type(screen.getByLabelText(/Email address/), "asha@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/If an account exists/));
    expect(calls).toEqual([{ url: "/api/auth/password/forgot", body: { email: "asha@example.com" } }]);
    expect(screen.queryByRole("button", { name: "Send reset link" })).toBeNull();
  });

  it("shows a 429 message from the server", async () => {
    answer = { status: 429, body: { success: false, error: "RATE_LIMITED", message: "Too many requests from this device. Please try again in 15 minutes." } };
    const user = userEvent.setup();
    render(<ForgotForm available />);
    await user.type(screen.getByLabelText(/Email address/), "asha@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Too many requests/));
  });
});

describe("Choose a new password page", () => {
  it("reads the token from the fragment, removes it from the address bar at once, and sends it only in the request body", async () => {
    window.history.replaceState(null, "", `/reset-password#token=${TOKEN}`);
    const user = userEvent.setup();
    render(<ResetForm />);
    await waitFor(() => expect(window.location.hash).toBe(""));
    expect(window.location.pathname).toBe("/reset-password");
    answer = { status: 200, body: { success: true, message: "Your password was changed. Sign in with your new password." } };
    await user.type(screen.getByLabelText("New password"), "brand new password");
    await user.type(screen.getByLabelText(/Confirm new password/), "brand new password");
    await user.click(screen.getByRole("button", { name: "Save new password" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/password was changed/));
    expect(calls).toEqual([{ url: "/api/auth/password/reset", body: { token: TOKEN, password: "brand new password", confirmPassword: "brand new password" } }]);
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
  });

  it("shows the server's field errors next to the fields", async () => {
    window.history.replaceState(null, "", `/reset-password#token=${TOKEN}`);
    answer = { status: 400, body: { success: false, error: "VALIDATION_FAILED", message: "Please check the new password.", fieldErrors: { password: "Password must contain at least 8 characters." } } };
    const user = userEvent.setup();
    render(<ResetForm />);
    await waitFor(() => expect(screen.getByLabelText("New password")).toBeTruthy());
    await user.type(screen.getByLabelText("New password"), "short");
    await user.type(screen.getByLabelText(/Confirm new password/), "short");
    await user.click(screen.getByRole("button", { name: "Save new password" }));
    await waitFor(() => expect(screen.getByText("Password must contain at least 8 characters.")).toBeTruthy());
    expect(screen.getByLabelText("New password").getAttribute("aria-invalid")).toBe("true");
  });

  it("an invalid or used link says so and offers a new one", async () => {
    window.history.replaceState(null, "", `/reset-password#token=${TOKEN}`);
    answer = { status: 400, body: { success: false, error: "INVALID_TOKEN", message: "This reset link is not valid any more. Please ask for a new one." } };
    const user = userEvent.setup();
    render(<ResetForm />);
    await waitFor(() => expect(screen.getByLabelText("New password")).toBeTruthy());
    await user.type(screen.getByLabelText("New password"), "brand new password");
    await user.type(screen.getByLabelText(/Confirm new password/), "brand new password");
    await user.click(screen.getByRole("button", { name: "Save new password" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/not valid any more/));
    expect(screen.getByRole("link", { name: "Ask for a new one" }).getAttribute("href")).toBe("/forgot-password");
  });

  it("without a token in the link it explains instead of showing a form", async () => {
    window.history.replaceState(null, "", "/reset-password");
    render(<ResetForm />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/incomplete/));
    expect(screen.queryByLabelText("New password")).toBeNull();
  });

  it("works when React runs the mount effect twice (Strict Mode, as in development): the token is read once and kept", async () => {
    window.history.replaceState(null, "", `/reset-password#token=${TOKEN}`);
    const user = userEvent.setup();
    render(<StrictMode><ResetForm /></StrictMode>);
    await waitFor(() => expect(screen.getByLabelText("New password")).toBeTruthy());
    expect(screen.queryByText(/incomplete/)).toBeNull();
    expect(window.location.hash).toBe("");
    answer = { status: 200, body: { success: true, message: "Your password was changed. Sign in with your new password." } };
    await user.type(screen.getByLabelText("New password"), "brand new password");
    await user.type(screen.getByLabelText(/Confirm new password/), "brand new password");
    await user.click(screen.getByRole("button", { name: "Save new password" }));
    await waitFor(() => expect(calls[0]?.body.token).toBe(TOKEN));
  });

  it("tokenFromHash takes only a plain token value", () => {
    expect(tokenFromHash(`#token=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash("#token=abc<script>")).toBeNull();
    expect(tokenFromHash("#x=1&token=abc_DEF-1")).toBe("abc_DEF-1");
    expect(tokenFromHash("")).toBeNull();
  });
});
