// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakePool, pgError, testDb } from "./helpers";

const h = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));

import JoinFlow from "../src/app/join/JoinFlow";
import { POST as otpRequest } from "../src/app/api/auth/otp/request/route";
import { POST as otpVerify } from "../src/app/api/auth/otp/verify/route";
import { POST as signup } from "../src/app/api/auth/signup/route";

let db: ReturnType<typeof makeFakePool>;
let lastDevOtp = "";
let requests: string[] = [];
let signupDelay: Promise<void> | null = null;
let stripDevOtp = false; // simulates the Resend provider: no devOtp, emailSent=true

beforeEach(() => {
  db = makeFakePool();
  h.push.mockReset();
  lastDevOtp = ""; requests = []; signupDelay = null; stripDevOtp = false;
  window.scrollTo = vi.fn() as never;
  const routes: Record<string, (r: Request) => Promise<Response>> = {
    "/api/auth/otp/request": otpRequest, "/api/auth/otp/verify": otpVerify, "/api/auth/signup": signup,
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    requests.push(url);
    if (url === "/api/auth/signup" && signupDelay) await signupDelay;
    const res = await routes[url](new Request("http://t" + url, { method: "POST", body: init.body as string }));
    if (url.endsWith("request")) {
      const body = await res.clone().json();
      if (body.devOtp) lastDevOtp = body.devOtp;
      if (stripDevOtp) { delete body.devOtp; body.emailSent = true; return new Response(JSON.stringify(body), { status: res.status }); }
    }
    return res;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const setup = () => { const user = userEvent.setup(); render(<JoinFlow />); return user; };
const next = (user: ReturnType<typeof userEvent.setup>, name: RegExp) => user.click(screen.getByRole("button", { name }));
const heading = () => screen.getByRole("heading", { level: 1 }).textContent;

async function fillDetails(user: ReturnType<typeof userEvent.setup>, o: Partial<Record<string, string>> = {}, age: "18 or older" | "Under 18" = "18 or older") {
  const v = { name: "Asha Rao", mobile: "9876543210", email: "asha@example.com", pw: "correct horse", pw2: "correct horse", district: "Guntur", ...o };
  await user.type(screen.getByLabelText(/Full name/), v.name);
  await user.type(screen.getByLabelText(/Mobile number/), v.mobile);
  await user.type(screen.getByLabelText(/Email address/), v.email);
  await user.type(screen.getByLabelText(/^Password/), v.pw);
  await user.type(screen.getByLabelText(/Confirm password/), v.pw2);
  await user.type(screen.getByLabelText(/District/), v.district);
  await user.click(screen.getByLabelText(age));
}
async function verifyCode(user: ReturnType<typeof userEvent.setup>, code = lastDevOtp) {
  await user.click(screen.getByLabelText("Digit 1"));
  await user.paste(code);
  await next(user, /^Verify$/);
}

describe("role selection and navigation", () => {
  it("requires a role, expands 'View value', and moves to details", async () => {
    const user = setup();
    expect(heading()).toBe("Join the RoboValley Community");
    await next(user, /^Continue$/);
    expect(screen.getByRole("alert").textContent).toMatch(/Choose a role/);

    await user.click(screen.getAllByRole("button", { name: /View value/ })[0]);
    expect(screen.getByText("What you get")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Join as Student/ })).toBeTruthy();

    await user.click(screen.getByLabelText(/Teacher \/ lab in-charge/));
    await next(user, /^Continue$/);
    expect(heading()).toBe("Your details");
    expect(screen.getByText(/Joining as/).textContent).toMatch(/Teacher/);
    await user.click(screen.getByRole("button", { name: /← Back/ }));
    expect(heading()).toBe("Join the RoboValley Community");
  });
});

describe("details validation", () => {
  it("shows field-level errors and checks password confirmation; keeps entered data", async () => {
    const user = setup();
    await user.click(screen.getByLabelText(/^Student/));
    await next(user, /^Continue$/);
    await fillDetails(user, { pw2: "different" });
    await next(user, /Send code to my email/);
    expect(screen.getByLabelText(/Confirm password/).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getAllByText("Passwords do not match.").length).toBeGreaterThan(0);
    expect((screen.getByLabelText(/Full name/) as HTMLInputElement).value).toBe("Asha Rao");
    expect(requests).toEqual([]); // nothing sent to the server
  });

  it("rejects an invalid mobile number and email", async () => {
    const user = setup();
    await user.click(screen.getByLabelText(/^Student/));
    await next(user, /^Continue$/);
    await fillDetails(user, { mobile: "12345", email: "bad" });
    await next(user, /Send code to my email/);
    expect(screen.getAllByText(/10-digit mobile number starting with/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Enter a valid email address.").length).toBeGreaterThan(0);
  });
});

describe("adult journey (UI → API → database)", () => {
  it("signs up end to end with mock OTP and persists a hashed password", async () => {
    const user = setup();
    await user.click(screen.getByLabelText(/Teacher \/ lab in-charge/));
    await next(user, /^Continue$/);
    await fillDetails(user);
    await next(user, /Send code to my email/);

    await waitFor(() => expect(heading()).toBe("Verify your email"));
    expect(screen.getByText(/Development mock OTP/).textContent).toMatch(/no email was sent/);
    // resend is locked behind a countdown
    expect((screen.getByRole("button", { name: /Resend code/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/in \d+s/)).toBeTruthy();

    // wrong code
    await verifyCode(user, lastDevOtp === "000000" ? "111111" : "000000");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/not correct/));
    expect(heading()).toBe("Verify your email");

    // right code
    await user.click(screen.getByLabelText("Digit 1"));
    await user.paste(lastDevOtp);
    await next(user, /^Verify$/);
    await waitFor(() => expect(heading()).toBe("Privacy and consent"));

    // consent is required
    await next(user, /Agree and continue/);
    expect(screen.getByRole("alert").textContent).toMatch(/Please agree/);
    await user.click(screen.getByLabelText(/Privacy Notice/));
    await user.click(screen.getByLabelText(/Terms of Use/));
    await next(user, /Agree and continue/);
    expect(heading()).toBe("About you");

    // required profile answers
    await next(user, /^Finish$/);
    expect(screen.getByRole("alert").textContent).toMatch(/Please answer/);
    expect(requests).not.toContain("/api/auth/signup");
    await user.type(screen.getByLabelText(/School name/), "ZP High School");
    await user.type(screen.getByLabelText(/UDISE or ATL code/), "12345");
    await user.click(screen.getByLabelText("Science"));
    await next(user, /^Finish$/);

    await waitFor(() => expect(heading()).toMatch(/Welcome to the RoboValley Community, Asha!/));
    const ins = db.calls.find((c) => /INSERT INTO users/.test(c.sql))!;
    const params = ins.params as unknown[];
    expect(params).not.toContain("correct horse");
    expect(await bcrypt.compare("correct horse", params[7] as string)).toBe(true);
    expect(JSON.parse(params[9] as string)).toEqual({ school: "ZP High School", schoolCode: "12345", subjects: ["Science"] });
    expect(db.calls.some((c) => /guardian_details/.test(c.sql))).toBe(false);

    await user.click(screen.getByRole("button", { name: /Sign in to my dashboard/ }));
    expect(h.push).toHaveBeenCalledWith("/login");
  });

  it("'Skip for now' creates the account with profileSkipped", async () => {
    const user = setup();
    await user.click(screen.getByLabelText(/^Student/));
    await next(user, /^Continue$/);
    await fillDetails(user);
    await next(user, /Send code to my email/);
    await waitFor(() => expect(heading()).toBe("Verify your email"));
    await verifyCode(user);
    await waitFor(() => expect(heading()).toBe("Privacy and consent"));
    await user.click(screen.getByLabelText(/Privacy Notice/));
    await user.click(screen.getByLabelText(/Terms of Use/));
    await next(user, /Agree and continue/);
    await next(user, /Skip for now/);
    await waitFor(() => expect(heading()).toMatch(/Welcome/));
    expect(db.calls.some((c) => /INSERT INTO users/.test(c.sql))).toBe(true);
  });

  it("OTP resend works after the countdown (new code is issued)", async () => {
    const user = setup();
    await user.click(screen.getByLabelText(/^Student/));
    await next(user, /^Continue$/);
    await fillDetails(user);
    await next(user, /Send code to my email/);
    await waitFor(() => expect(heading()).toBe("Verify your email"));
    const first = lastDevOtp;
    // fast-forward the server-side cooldown and the client countdown
    await testDb().raw.exec("update otp_challenges set last_sent_at = last_sent_at - interval '1 minute'"); // the server-side 30 s cooldown has passed
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
    const resend = screen.getByRole("button", { name: /Resend code/ }) as HTMLButtonElement;
    await waitFor(() => expect(resend.disabled).toBe(false), { timeout: 3000 });
    await user.click(resend);
    await waitFor(() => expect(requests.filter((r) => r.endsWith("request")).length).toBe(2));
    expect(lastDevOtp).toMatch(/^\d{6}$/);
    expect(first).toMatch(/^\d{6}$/);
    vi.restoreAllMocks();
  });

  it("shows the emailed-code notice and no dev OTP box when the server returns no code (Resend-like)", async () => {
    stripDevOtp = true;
    const user = setup();
    await user.click(screen.getByLabelText(/^Student/));
    await next(user, /^Continue$/);
    await fillDetails(user);
    await next(user, /Send code to my email/);
    await waitFor(() => expect(heading()).toBe("Verify your email"));
    expect(screen.queryByText(/Development mock OTP/)).toBeNull();
    expect(screen.getByText(/We've emailed you a 6-digit code/)).toBeTruthy();
    expect(document.body.textContent).not.toContain(lastDevOtp);
  });
});

describe("minor journey", () => {
  async function toGuardian(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByLabelText(/^Student/));
    await next(user, /^Continue$/);
    await fillDetails(user, {}, "Under 18");
    await next(user, /Send code to my email/);
    await waitFor(() => expect(heading()).toBe("Verify your email"));
    await verifyCode(user);
    await waitFor(() => expect(heading()).toBe("Your parent or guardian"));
  }

  it("shows the guardian steps for under-18 and rejects the student's own number", async () => {
    const user = setup();
    await toGuardian(user);
    await user.type(screen.getByLabelText(/Parent \/ guardian name/), "Lakshmi");
    await user.selectOptions(screen.getByLabelText(/Relationship/), "Mother");
    await user.type(screen.getByLabelText(/Their mobile number/), "9876543210");
    await user.type(screen.getByLabelText(/Their email address/), "ASHA@example.com");
    await next(user, /Send code to parent/);
    expect(screen.getAllByText("Your parent's number must be different from yours.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Your parent's email must be different from yours.").length).toBeGreaterThan(0);
    expect(heading()).toBe("Your parent or guardian");
  });

  it("requires a separate guardian OTP, then creates student + guardian rows with consent pending", async () => {
    const user = setup();
    await toGuardian(user);
    await user.type(screen.getByLabelText(/Parent \/ guardian name/), "Lakshmi");
    await user.selectOptions(screen.getByLabelText(/Relationship/), "Mother");
    await user.type(screen.getByLabelText(/Their mobile number/), "9988776655");
    await user.type(screen.getByLabelText(/Their email address/), "lakshmi@example.com");
    await next(user, /Send code to parent/);
    await waitFor(() => expect(heading()).toBe("Parent's consent"));

    // the student's OTP value must not unlock the guardian step
    const guardianCode = lastDevOtp;
    await user.click(screen.getByLabelText(/I am the parent/));
    await user.type(screen.getByLabelText(/Code sent to/), guardianCode === "000000" ? "111111" : "000000");
    await next(user, /^Verify$/);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/not correct/));

    const field = screen.getByLabelText(/Code sent to/);
    await user.clear(field);
    await user.type(field, guardianCode);
    await next(user, /^Verify$/);
    await waitFor(() => expect(heading()).toBe("Privacy and consent"));
    await user.click(screen.getByLabelText(/Privacy Notice/));
    await user.click(screen.getByLabelText(/Terms of Use/));
    await next(user, /Agree and continue/);
    await user.selectOptions(screen.getByLabelText(/Class or course/), "Class 9–10");
    await user.type(screen.getByLabelText(/School or college name/), "Govt High School");
    await next(user, /^Finish$/);

    await waitFor(() => expect(heading()).toMatch(/Welcome/));
    const g = db.calls.find((c) => /INSERT INTO guardian_details/.test(c.sql))!;
    expect(g.sql).toMatch(/'pending',\$6,'test'/);
    expect(g.params).toEqual(["1", "Lakshmi", "Mother", "9988776655", "lakshmi@example.com", "mock"]);
    expect(screen.getByText(/consent is still pending/)).toBeTruthy();
    const user_ = db.calls.find((c) => /INSERT INTO users/.test(c.sql))!;
    expect((user_.params as unknown[])[8]).toBe(false);
  });
});

describe("error and loading states", () => {
  async function toProfile(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByLabelText(/^Student/));
    await next(user, /^Continue$/);
    await fillDetails(user);
    await next(user, /Send code to my email/);
    await waitFor(() => expect(heading()).toBe("Verify your email"));
    await verifyCode(user);
    await waitFor(() => expect(heading()).toBe("Privacy and consent"));
    await user.click(screen.getByLabelText(/Privacy Notice/));
    await user.click(screen.getByLabelText(/Terms of Use/));
    await next(user, /Agree and continue/);
    await user.selectOptions(screen.getByLabelText(/Class or course/), "Class 9–10");
    await user.type(screen.getByLabelText(/School or college name/), "Govt High School");
  }

  it("disables the button while pending and sends only one signup request", async () => {
    const user = setup();
    await toProfile(user);
    let release!: () => void;
    signupDelay = new Promise<void>((r) => (release = r));
    const btn = screen.getByRole("button", { name: /^Finish$/ });
    await user.click(btn);
    await waitFor(() => expect((screen.getByRole("button", { name: /Please wait/ }) as HTMLButtonElement).disabled).toBe(true));
    await user.click(screen.getByRole("button", { name: /Please wait/ }));
    release();
    await waitFor(() => expect(heading()).toMatch(/Welcome/));
    expect(requests.filter((r) => r === "/api/auth/signup")).toHaveLength(1);
    expect(db.calls.filter((c) => /INSERT INTO users/.test(c.sql))).toHaveLength(1);
  });

  it("duplicate email returns to the details step with the error and keeps entered data", async () => {
    db = makeFakePool((sql) => (/INSERT INTO users/.test(sql) ? pgError("23505", "users_email_key") : undefined));
    const user = setup();
    await toProfile(user);
    await next(user, /^Finish$/);
    await waitFor(() => expect(heading()).toBe("Your details"));
    expect(screen.getAllByText("An account with this email already exists.").length).toBeGreaterThan(0);
    expect((screen.getByLabelText(/Email address/) as HTMLInputElement).value).toBe("asha@example.com");
    expect((screen.getByLabelText(/Full name/) as HTMLInputElement).value).toBe("Asha Rao");
  });

  it("shows a friendly error when the server is unreachable", async () => {
    const user = setup();
    await user.click(screen.getByLabelText(/^Student/));
    await next(user, /^Continue$/);
    await fillDetails(user);
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("network"));
    await next(user, /Send code to my email/);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Could not reach the server/));
    expect(heading()).toBe("Your details");
    expect(within(document.body).getByDisplayValue("Asha Rao")).toBeTruthy();
  });
});
