import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetOtpStore } from "../src/lib/otp";
import { POST as requestRoute } from "../src/app/api/auth/otp/request/route";
import { POST as verifyRoute } from "../src/app/api/auth/otp/verify/route";

const call = (route: typeof requestRoute, body: unknown) =>
  route(new Request("http://t/x", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => { __resetOtpStore(); vi.stubEnv("OTP_PROVIDER", "mock"); });
afterEach(() => vi.unstubAllEnvs());

describe("OTP routes (mock provider)", () => {
  it("dev mode: returns a clearly-labelled mock code and verifies it", async () => {
    const r = await (await call(requestRoute, { email: "Asha@Example.com ", purpose: "signup" })).json();
    expect(r).toMatchObject({ success: true, mock: true, emailSent: false, provider: "mock" });
    expect(r.devOtp).toMatch(/^\d{6}$/);
    expect(r.notice).toMatch(/MOCK/);
    // the email is normalised, so any casing verifies
    const v = await call(verifyRoute, { email: "asha@example.com", purpose: "signup", code: r.devOtp });
    const vb = await v.json();
    expect(v.status).toBe(200);
    expect(vb.verificationToken).toHaveLength(64);
    expect(vb.notice).toMatch(/not proof/);
  });

  it("production: mock never runs and never exposes a code", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await call(requestRoute, { email: "asha@example.com", purpose: "signup" });
    const text = await res.text();
    expect(res.status).toBe(501);
    expect(text).not.toMatch(/devOtp|\d{6}/);
    expect((await call(verifyRoute, { email: "asha@example.com", purpose: "signup", code: "123456" })).status).toBe(501);
  });

  it("returns 429 + Retry-After on rapid resend", async () => {
    await call(requestRoute, { email: "asha@example.com", purpose: "signup" });
    const res = await call(requestRoute, { email: "asha@example.com", purpose: "signup" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect((await res.json()).error).toBe("RESEND_COOLDOWN");
  });

  it("wrong code gives 400 with attempts left; no OTP value is echoed", async () => {
    const r = await (await call(requestRoute, { email: "asha@example.com", purpose: "signup" })).json();
    const wrong = r.devOtp === "123456" ? "654321" : "123456";
    const res = await call(verifyRoute, { email: "asha@example.com", purpose: "signup", code: wrong });
    const b = await res.json();
    expect(res.status).toBe(400);
    expect(b.attemptsLeft).toBe(4);
    expect(JSON.stringify(b)).not.toContain(r.devOtp);
  });

  it("validates email, purpose, code format, and guardian email != student email", async () => {
    expect((await call(requestRoute, { email: "nope", purpose: "signup" })).status).toBe(400);
    expect((await call(requestRoute, { mobile: "9876543210", purpose: "signup" })).status).toBe(400); // old mobile body is rejected
    expect((await call(requestRoute, { email: "asha@example.com", purpose: "login" })).status).toBe(400);
    expect((await call(verifyRoute, { email: "asha@example.com", purpose: "signup", code: "12ab56" })).status).toBe(400);
    const same = await call(requestRoute, { email: "A@example.com", purpose: "guardian", studentEmail: "a@EXAMPLE.com" });
    expect(same.status).toBe(400);
    expect((await same.json()).error).toBe("SAME_EMAIL");
  });
});
