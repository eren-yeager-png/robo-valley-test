// Acceptance criteria that must keep passing through the serverless and Next.js changes.
// Driven through the real route handlers and server pages, against an in-process PostgreSQL (PGlite) that has
// the real migrations applied (no real database, no email). Test names start with the criterion id (AC1..AC8).
import { renderToStaticMarkup } from "react-dom/server";
import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testDb } from "./helpers";
import { MAX_FAILURES } from "../src/lib/loginThrottle";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const st = vi.hoisted(() => ({ cookie: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "rv_session" && st.cookie ? { name: n, value: st.cookie } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error("REDIRECT:" + to); },
  notFound: () => { throw new Error("NOT_FOUND"); },
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });

import { POST as otpRequest } from "../src/app/api/auth/otp/request/route";
import { POST as otpVerify } from "../src/app/api/auth/otp/verify/route";
import { POST as signup } from "../src/app/api/auth/signup/route";
import { POST as login } from "../src/app/api/auth/login/route";
import { POST as logout } from "../src/app/api/auth/logout/route";
import { PATCH as updateProfile } from "../src/app/api/account/profile/route";
import DashboardHome from "../src/app/dashboard/page";
import ProfilePage from "../src/app/dashboard/profile/page";
import SectionPage from "../src/app/dashboard/[section]/page";

// ---------- helpers ----------
const rowsOf = async (sql: string) => (await testDb().raw.query(sql)).rows as any[];
const users = () => rowsOf("select * from users order by id");
const guardians = () => rowsOf("select * from guardian_details order by id");
const send = (route: (r: Request) => Promise<Response>, body: unknown, headers: Record<string, string> = {}) =>
  route(new Request("http://localhost/x", { method: "POST", headers, body: JSON.stringify(body) }));
const cookieValue = (res: Response) => (res.headers.get("set-cookie") ?? "").match(/rv_session=([^;]*)/)?.[1];
const html = async (n: Promise<React.ReactNode>) => renderToStaticMarkup(<>{await n}</>);

/** Real OTP flow through the real routes (mock provider): request -> code -> verify -> verification token. */
async function verifyEmail(email: string, purpose: "signup" | "guardian" = "signup") {
  const r = await (await send(otpRequest, { email, purpose })).json();
  expect(r.success, "otp request").toBe(true);
  const v = await (await send(otpVerify, { email, purpose, code: r.devOtp })).json();
  expect(v.success, "otp verify").toBe(true);
  return v.verificationToken as string;
}
const adult = (over: Record<string, unknown> = {}) => ({
  role: "TC", fullName: "Asha Rao", mobile: "9876543210", email: "asha@example.com", password: "correct horse", confirmPassword: "correct horse",
  district: "Guntur", language: "English", ageCategory: "adult", consents: { privacy: true, terms: true },
  profile: { school: "ZP High School", schoolCode: "12345", subjects: ["Science"] }, ...over,
});
async function signUpAdult(over: Record<string, unknown> = {}) {
  const a = adult(over);
  return send(signup, { ...a, verification: { signup: await verifyEmail(String(a.email).trim().toLowerCase()) } });
}
async function signIn(email: string, password: string, extra: Record<string, unknown> = {}) {
  const res = await send(login, { email, password, ...extra });
  if (res.status === 200) st.cookie = cookieValue(res);
  return res;
}

afterEach(() => vi.unstubAllEnvs());

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
  st.cookie = undefined; // the database itself is emptied before each test by ./helpers
});

describe("AC1 adult signup -> email OTP -> login -> dashboard", () => {
  it("completes end to end and shows the dashboard to the right user", async () => {
    const res = await signUpAdult();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user).toMatchObject({ email: "asha@example.com", role: "TC", ageCategory: "adult" });
    expect(JSON.stringify(body)).not.toMatch(/hash|password|\$2[aby]\$/i);

    const row = (await users())[0];
    expect(row.password_hash).toMatch(/^\$2[aby]\$12\$/);
    expect(await bcrypt.compare("correct horse", row.password_hash)).toBe(true);
    expect(JSON.stringify(row)).not.toContain("correct horse");

    const lr = await signIn("ASHA@example.com", "correct horse");
    expect(lr.status).toBe(200);
    expect((await lr.json()).redirectTo).toBe("/dashboard");

    const page = await html(DashboardHome());
    expect(page).toContain("Welcome, Asha!");
    expect(page).toContain("Teacher / lab in-charge");
  });

  it("cannot skip the email OTP: signup without a verification token is refused and nothing is stored", async () => {
    const res = await send(signup, adult());
    expect(res.status).toBe(403);
    expect(await users()).toHaveLength(0);
  });

  it("a code for one email cannot verify another", async () => {
    const r = await (await send(otpRequest, { email: "a@example.com", purpose: "signup" })).json();
    const v = await send(otpVerify, { email: "b@example.com", purpose: "signup", code: r.devOtp });
    expect(v.status).toBe(400);
  });
});

describe("AC2 duplicate email", () => {
  it('answers 409 "An account with this email already exists." and stores only one account', async () => {
    expect((await signUpAdult()).status).toBe(201);
    await testDb().raw.exec("update otp_challenges set last_sent_at = last_sent_at - interval '1 minute'"); // a real user waits out the 30 s resend cooldown before asking for a second code
    const dup = await signUpAdult({ fullName: "Someone Else", email: "ASHA@Example.com" }); // different casing, same email
    const body = await dup.json();
    expect(dup.status).toBe(409);
    expect(body.message).toBe("An account with this email already exists.");
    expect(body.fieldErrors.email).toBe("An account with this email already exists.");
    expect(await users()).toHaveLength(1);
    expect(JSON.stringify(body)).not.toMatch(/users_email_key|23505|INSERT/);
  });
});

describe("AC3 lockout policy: five wrong passwords, sixth is refused", () => {
  it('attempts 1-5 are "Incorrect email or password."; the 6th says "Too many failed attempts" (429)', async () => {
    await signUpAdult();
    const msgs: string[] = [];
    for (let i = 1; i <= MAX_FAILURES; i++) {
      const r = await send(login, { email: "asha@example.com", password: "wrong-" + i });
      expect(r.status).toBe(401);
      msgs.push((await r.json()).message);
    }
    expect(new Set(msgs)).toEqual(new Set(["Incorrect email or password."]));
    const sixth = await send(login, { email: "asha@example.com", password: "wrong-6" });
    const b = await sixth.json();
    expect(sixth.status).toBe(429);
    expect(b.message).toMatch(/^Too many failed attempts/);
    expect(Number(sixth.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("while locked even the correct password is refused, and other accounts are unaffected", async () => {
    await signUpAdult();
    await send(signup, { ...adult({ email: "other@example.com", fullName: "Other" }), verification: { signup: await verifyEmail("other@example.com") } });
    for (let i = 0; i < MAX_FAILURES; i++) await send(login, { email: "asha@example.com", password: "bad" + i });
    expect((await send(login, { email: "asha@example.com", password: "correct horse" })).status).toBe(429);
    expect((await send(login, { email: "other@example.com", password: "correct horse" })).status).toBe(200);
  });

  it("a successful login before the limit resets the counter", async () => {
    await signUpAdult();
    for (let i = 0; i < MAX_FAILURES - 1; i++) await send(login, { email: "asha@example.com", password: "bad" + i });
    expect((await send(login, { email: "asha@example.com", password: "correct horse" })).status).toBe(200);
    for (let i = 0; i < MAX_FAILURES - 1; i++) expect((await send(login, { email: "asha@example.com", password: "bad" + i })).status).toBe(401);
  });
});

describe("AC4 session cookie flags", () => {
  it("is HttpOnly + SameSite=Lax + Path=/ always, and Secure in production (HTTPS)", async () => {
    await signUpAdult();
    const dev = (await send(login, { email: "asha@example.com", password: "correct horse" })).headers.get("set-cookie") ?? "";
    expect(dev).toMatch(/HttpOnly/i);
    expect(dev).toMatch(/SameSite=lax/i);
    expect(dev).toMatch(/Path=\//i);
    expect(dev).not.toMatch(/Secure/i); // plain http://localhost during development

    vi.stubEnv("NODE_ENV", "production");
    // an account verified with the test-mode OTP is refused in production (policy), whatever the password
    expect((await send(login, { email: "asha@example.com", password: "correct horse" })).status).toBe(403);
    await testDb().raw.exec("update users set email_verification = 'email'"); // the same account, verified by a real emailed code
    const prod = (await send(login, { email: "asha@example.com", password: "correct horse", remember: true })).headers.get("set-cookie") ?? "";
    expect(prod).toMatch(/HttpOnly/i);
    expect(prod).toMatch(/Secure/i);
    expect(prod).toMatch(/SameSite=lax/i);
    expect(prod).toMatch(/Max-Age=2592000/i); // "remember me": 30 days
    expect(prod).not.toContain("correct horse");
  });
});

describe("AC5 sign-out", () => {
  it("expires the cookie, and every protected page and API then refuses access", async () => {
    await signUpAdult();
    await signIn("asha@example.com", "correct horse");
    expect(await html(DashboardHome())).toContain("Welcome, Asha!"); // signed in

    const out = await send(logout, {});
    expect(out.status).toBe(200);
    const c = out.headers.get("set-cookie") ?? "";
    expect(cookieValue(out)).toBe("");
    expect(c).toMatch(/Max-Age=0/i);
    expect(c).toMatch(/HttpOnly/i);

    st.cookie = cookieValue(out) || undefined; // the browser now holds an empty/expired cookie
    await expect(DashboardHome()).rejects.toThrow("REDIRECT:/login");
    await expect(ProfilePage()).rejects.toThrow("REDIRECT:/login");
    await expect(SectionPage({ params: Promise.resolve({ section: "projects" }) })).rejects.toThrow("REDIRECT:/login");
    const patch = await updateProfile(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ fullName: "X" }) }));
    expect(patch.status).toBe(401);
  });
});

describe("AC6 role-based access", () => {
  it("a student is denied /dashboard/faults (supplier-only) and other roles' sections, but sees their own", async () => {
    await signUpAdult({ role: "ST", fullName: "Stu Dent", email: "student@example.com", profile: { class: "Class 9–10", school: "GHS" } });
    await signIn("student@example.com", "correct horse");
    for (const slug of ["faults", "catalogue", "schools", "kits", "requests"]) {
      const out = await html(SectionPage({ params: Promise.resolve({ section: slug }) }));
      expect(out, slug).toContain("Access denied");
      expect(out).not.toContain("Nothing to show here yet");
    }
    expect(await html(SectionPage({ params: Promise.resolve({ section: "projects" }) }))).toContain("Nothing to show here yet");
  });

  it("an authorised supplier (KS) can open /dashboard/faults", async () => {
    await signUpAdult({ role: "KS", fullName: "Kit Maker", email: "kits@example.com", profile: { company: "Kits Ltd", supplies: ["Robotics kits"] } });
    await signIn("kits@example.com", "correct horse");
    const out = await html(SectionPage({ params: Promise.resolve({ section: "faults" }) }));
    expect(out).toContain("Fault reports");
    expect(out).not.toContain("Access denied");
  });

  it("the role cannot be chosen or changed through login or the settings API", async () => {
    await signUpAdult({ role: "ST", email: "student@example.com", profile: { class: "Class 9–10", school: "GHS" } });
    const lr = await signIn("student@example.com", "correct horse", { role: "SA" });
    expect((await lr.json()).user.role).toBe("ST");
    const res = await updateProfile(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ role: "SA" }) }));
    expect(res.status).toBe(400);
    expect((await users())[0].role).toBe("ST");
  });
});

describe("AC7 under-18 signup needs a parent/guardian, and consent stays Pending", () => {
  const minor = (over: Record<string, unknown> = {}) => ({
    role: "ST", fullName: "Ravi Kumar", mobile: "9123456780", email: "ravi@example.com", password: "longenough1", confirmPassword: "longenough1",
    district: "Krishna", language: "Telugu", ageCategory: "minor", consents: { privacy: true, terms: true },
    guardian: { name: "Lakshmi Kumar", relationship: "Mother", mobile: "9988776655", email: "lakshmi@example.com" },
    profile: { class: "Class 9–10", school: "GHS" }, ...over,
  });

  it("is refused without the guardian's verified email, and without guardian details", async () => {
    const own = await verifyEmail("ravi@example.com");
    expect((await send(signup, { ...minor(), verification: { signup: own } })).status).toBe(403);
    expect((await send(signup, { ...minor({ guardian: undefined }), verification: { signup: own } })).status).toBe(400);
    expect(await users()).toHaveLength(0);
  });

  it("is created with consent Pending (never auto-granted), and the dashboard says so", async () => {
    const res = await send(signup, { ...minor(), verification: { signup: await verifyEmail("ravi@example.com"), guardian: await verifyEmail("lakshmi@example.com", "guardian") } });
    expect(res.status).toBe(201);
    expect((await users())[0].guardian_consent).toBe(false);
    expect((await guardians())[0]).toMatchObject({ consent_status: "pending", consent_mode: "test", consent_recorded_at: null });

    await signIn("ravi@example.com", "longenough1");
    const page = await html(DashboardHome());
    expect(page).toContain("Parent or guardian consent is pending");
    expect(page).toContain(">Pending<");
    expect(page).not.toContain(">Granted<");
  });

  it("only an actual grant recorded in the database changes the dashboard to Granted", async () => {
    await send(signup, { ...minor(), verification: { signup: await verifyEmail("ravi@example.com"), guardian: await verifyEmail("lakshmi@example.com", "guardian") } });
    await signIn("ravi@example.com", "longenough1");
    await testDb().raw.exec("update guardian_details set consent_status = 'granted'"); // what a real consent workflow would record
    const page = await html(DashboardHome());
    expect(page).toContain(">Granted<");
    expect(page).not.toContain("Parent or guardian consent is pending");
  });

  it("an adult cannot send guardian details, and a minor cannot register as a non-student", async () => {
    expect((await send(signup, { ...adult(), guardian: minor().guardian, verification: { signup: await verifyEmail("asha@example.com") } })).status).toBe(400);
    expect((await send(signup, { ...minor({ role: "TC" }), verification: { signup: await verifyEmail("ravi@example.com"), guardian: await verifyEmail("lakshmi@example.com", "guardian") } })).status).toBe(400);
  });
});

describe("AC8 invalid input is a 400, never a 500", () => {
  const CONTROL = ["\u0000", "\u0001", "\n", "\t", "\u007F"];
  it.each(CONTROL)("control character %j in signup fields", async (c) => {
    const tok = await verifyEmail("asha@example.com");
    for (const over of [{ fullName: `Ra${c}vi` }, { district: `G${c}x` }, { profile: { school: `x${c}y`, schoolCode: "1", subjects: ["Maths"] } }, { email: `a${c}b@example.com` }]) {
      const res = await send(signup, { ...adult(over), verification: { signup: tok } });
      expect(res.status, JSON.stringify(over)).toBe(400);
    }
    expect(await users()).toHaveLength(0);
  });
  it.each(CONTROL)("control character %j in a login email", async (c) => {
    expect((await send(login, { email: `a${c}b@b.co`, password: "x" })).status).toBe(400);
  });
  it("malformed/oversized JSON and wrong types", async () => {
    for (const route of [signup, login, otpRequest, otpVerify]) {
      expect((await route(new Request("http://localhost/x", { method: "POST", body: "{nope" }))).status).toBe(400);
      expect((await route(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ pad: "x".repeat(40000) }) }))).status).toBe(413);
    }
    expect((await send(login, { email: 5, password: {} })).status).toBe(400);
    expect((await send(signup, [])).status).toBe(400);
  });
});
