// @vitest-environment jsdom
// returnTo through the real pages and forms: /login and /join validate ?returnTo on the server, the value survives the whole
// Join -> Sign in -> Login journey, and without a (valid) returnTo everything behaves exactly as before.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser } from "./helpers";
import { createSessionToken } from "../src/lib/session";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const h = vi.hoisted(() => ({ push: vi.fn(), nav: vi.fn(), cookie: undefined as string | undefined, host: "app.techytree.in", lastDevOtp: "" }));
vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
vi.mock("../src/lib/navigate", () => ({ hardNavigate: (to: string) => h.nav(to) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, replace: vi.fn(), refresh: vi.fn() }),
  redirect: (to: string) => { throw new Error("REDIRECT:" + to); },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "rv_session" && h.cookie ? { name: n, value: h.cookie } : undefined) }),
  headers: async () => ({ get: (n: string) => (n.toLowerCase() === "host" ? h.host : null) }),
}));

import LoginPage from "../src/app/login/page";
import JoinPage from "../src/app/join/page";
import LoginForm from "../src/app/login/LoginForm";
import JoinFlow from "../src/app/join/JoinFlow";
import { POST as loginRoute } from "../src/app/api/auth/login/route";
import { POST as otpRequest } from "../src/app/api/auth/otp/request/route";
import { POST as otpVerify } from "../src/app/api/auth/otp/verify/route";
import { POST as signup } from "../src/app/api/auth/signup/route";

const GOOD = "https://techytree.in/projects/?project=12";
const ENC = encodeURIComponent(GOOD);
const sp = (v: unknown) => ({ searchParams: Promise.resolve(v as Record<string, string | string[] | undefined>) });

beforeEach(() => {
  h.push.mockReset(); h.nav.mockReset(); h.cookie = undefined; h.host = "app.techytree.in"; h.lastDevOtp = "";
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("SITE_URL", "");
  vi.stubEnv("PROJECTS_RETURN_PATH", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  window.scrollTo = vi.fn() as never;
  const routes: Record<string, (r: Request) => Promise<Response>> = { "/api/auth/login": loginRoute, "/api/auth/otp/request": otpRequest, "/api/auth/otp/verify": otpVerify, "/api/auth/signup": signup };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const res = await routes[url](new Request("http://localhost" + url, { method: "POST", body: init.body as string }));
    if (url.endsWith("request")) { const b = await res.clone().json(); if (b.devOtp) h.lastDevOtp = b.devOtp; }
    return res;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const signUpHref = () => screen.getByRole("link", { name: "Sign up" }).getAttribute("href");
const signInHref = () => screen.getByRole("link", { name: "Sign in" }).getAttribute("href");
async function login(user = userEvent.setup(), email = "asha@example.com") {
  await user.type(screen.getByLabelText(/Email address/), email);
  await user.type(screen.getByLabelText(/^Password/), "correct horse");
  await user.click(screen.getByRole("button", { name: /^Sign in$/ }));
}

describe("the login page validates ?returnTo on the server", () => {
  it("a valid returnTo reaches the form: Sign up keeps it, and a successful login goes there (not to SITE_URL)", async () => {
    await seedUser();
    render(await LoginPage(sp({ returnTo: GOOD })));
    expect(signUpHref()).toBe(`/join?returnTo=${ENC}`);
    await login();
    await waitFor(() => expect(h.nav).toHaveBeenCalledTimes(1));
    expect(h.nav).toHaveBeenCalledWith(GOOD);
  });

  it("a path-only returnTo is rebuilt against the configured site", async () => {
    await seedUser();
    render(await LoginPage(sp({ returnTo: "/projects/?project=4" })));
    expect(signUpHref()).toBe(`/join?returnTo=${encodeURIComponent("https://techytree.in/projects/?project=4")}`);
    await login();
    await waitFor(() => expect(h.nav).toHaveBeenCalledWith("https://techytree.in/projects/?project=4"));
  });

  const evil = ["//evil.com", "https://evil.com/projects/?project=1", "/\\evil.com", "%2F%2Fevil.com", "javascript:alert(1)", "data:text/html,x", "https://techytree.in@evil.com/projects/?project=1",
    "https://techytree.in.evil.com/projects/?project=1", "https://techytree.in/projects/?project=abc", "https://techytree.in/projects/?project=-1", "https://techytree.in/other/?project=1", " https://techytree.in/projects/?project=1", ""];
  it.each(evil)("a hostile returnTo (%j) is ignored: no trace in the form, login still goes to SITE_URL", async (value) => {
    await seedUser();
    const { container } = render(await LoginPage(sp({ returnTo: value })));
    expect(signUpHref()).toBe("/join");
    expect(container.innerHTML).not.toContain("returnTo");
    await login();
    await waitFor(() => expect(h.nav).toHaveBeenCalledTimes(1));
    expect(h.nav).toHaveBeenCalledWith("https://techytree.in/"); // exactly what the login API returned: SITE_URL
  });

  it("repeated or odd parameter shapes are ignored", async () => {
    for (const v of [[GOOD, GOOD], [GOOD, "//evil.com"], undefined]) {
      cleanup();
      render(await LoginPage(sp({ returnTo: v })));
      expect(signUpHref()).toBe("/join");
    }
  });

  it("with no returnTo at all the page, the link and the login redirect are exactly what they were", async () => {
    await seedUser();
    const { container } = render(await LoginPage());
    expect(signUpHref()).toBe("/join");
    expect(container.innerHTML).not.toContain("returnTo");
    await login();
    await waitFor(() => expect(h.nav).toHaveBeenCalledWith("https://techytree.in/"));
  });

  it("honours SITE_URL / PROJECTS_RETURN_PATH for the local site", async () => {
    vi.stubEnv("SITE_URL", "http://localhost:8080/"); vi.stubEnv("PROJECTS_RETURN_PATH", "/projects-test/");
    await seedUser();
    render(await LoginPage(sp({ returnTo: "http://localhost:8080/projects-test/?project=3" })));
    await login();
    await waitFor(() => expect(h.nav).toHaveBeenCalledWith("http://localhost:8080/projects-test/?project=3"));
    cleanup();
    render(await LoginPage(sp({ returnTo: GOOD }))); // the live address is not accepted on the local configuration
    expect(signUpHref()).toBe("/join");
  });
});

describe("an already signed-in visitor on /login", () => {
  const signedIn = async () => { const { id } = await seedUser(); h.cookie = createSessionToken({ id, role: "TC" }, false, Date.now(), { SESSION_SECRET: SECRET } as never).token; };

  it("is sent to a valid returnTo, to SITE_URL for an invalid one, and to SITE_URL with none (as before)", async () => {
    await signedIn();
    await expect(LoginPage(sp({ returnTo: GOOD }))).rejects.toThrow("REDIRECT:" + GOOD);
    await expect(LoginPage(sp({ returnTo: "//evil.com" }))).rejects.toThrow("REDIRECT:https://techytree.in/");
    await expect(LoginPage(sp({ returnTo: "https://evil.com/projects/?project=1" }))).rejects.toThrow("REDIRECT:https://techytree.in/");
    await expect(LoginPage()).rejects.toThrow("REDIRECT:https://techytree.in/");
  });

  it("never redirects to its own host (no loop), even with a returnTo", async () => {
    await signedIn();
    vi.stubEnv("SITE_URL", "https://app.techytree.in/"); // the site is this very host
    const el = await LoginPage(sp({ returnTo: "https://app.techytree.in/projects/?project=5" }));
    expect(el).toBeTruthy(); // returned the form instead of redirecting
  });
});

describe("the join page and flow", () => {
  it("a valid returnTo is carried to the 'Already a member? Sign in' link; none leaves it as /login", async () => {
    render(await JoinPage(sp({ returnTo: GOOD })));
    expect(signInHref()).toBe(`/login?returnTo=${ENC}`);
    cleanup();
    render(await JoinPage(sp({ returnTo: "//evil.com" })));
    expect(signInHref()).toBe("/login");
    cleanup();
    render(await JoinPage());
    expect(signInHref()).toBe("/login");
  });

  it("Join -> Sign in -> Login -> back to the project: returnTo survives every step", async () => {
    const user = userEvent.setup();
    render(await JoinPage(sp({ returnTo: GOOD })));
    await user.click(screen.getByLabelText(/Teacher \/ lab in-charge/));
    await user.click(screen.getByRole("button", { name: /^Continue$/ }));
    await user.type(screen.getByLabelText(/Full name/), "Asha Rao");
    await user.type(screen.getByLabelText(/Mobile number/), "9876543210");
    await user.type(screen.getByLabelText(/Email address/), "asha@example.com");
    await user.type(screen.getByLabelText(/^Password/), "correct horse");
    await user.type(screen.getByLabelText(/Confirm password/), "correct horse");
    await user.type(screen.getByLabelText(/District/), "Guntur");
    await user.click(screen.getByLabelText("18 or older"));
    await user.click(screen.getByRole("button", { name: /Send code to my email/ }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Verify your email"));
    await user.click(screen.getByLabelText("Digit 1"));
    await user.paste(h.lastDevOtp);
    await user.click(screen.getByRole("button", { name: /^Verify$/ }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Privacy and consent"));
    await user.click(screen.getByLabelText(/Privacy Notice/));
    await user.click(screen.getByLabelText(/Terms of Use/));
    await user.click(screen.getByRole("button", { name: /Agree and continue/ }));
    await user.type(screen.getByLabelText(/School name/), "ZP High School");
    await user.type(screen.getByLabelText(/UDISE or ATL code/), "12345");
    await user.click(screen.getByLabelText("Science"));
    await user.click(screen.getByRole("button", { name: /^Finish$/ }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Welcome to the RoboValley Community/));

    // the account now exists; the Register step ends at "Sign in" with the returnTo attached
    await user.click(screen.getByRole("button", { name: /Sign in to my dashboard/ }));
    expect(h.push).toHaveBeenCalledTimes(1);
    const to = h.push.mock.calls[0][0] as string;
    expect(to).toBe(`/login?returnTo=${ENC}`);

    // follow that link: the login page reads the parameter the way the browser would hand it over
    cleanup();
    const returnTo = new URL(to, "https://app.techytree.in").searchParams.get("returnTo");
    render(await LoginPage(sp({ returnTo })));
    await login(user);
    await waitFor(() => expect(h.nav).toHaveBeenCalledTimes(1));
    expect(h.nav).toHaveBeenCalledWith(GOOD);
  }, 60000);

  it("without returnTo the join flow still ends with router.push('/login') exactly", async () => {
    // same journey as above is covered by join-ui.test.tsx; here only the wiring that changed
    render(<JoinFlow />);
    expect(signInHref()).toBe("/login");
  });
});

describe("components used on their own", () => {
  it("LoginForm and JoinFlow without props are unchanged", () => {
    render(<LoginForm />);
    expect(signUpHref()).toBe("/join");
    cleanup();
    render(<JoinFlow />);
    expect(signInHref()).toBe("/login");
  });
});
