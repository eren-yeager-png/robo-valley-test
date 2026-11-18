// GET/OPTIONS /api/auth/session: the read-only session check used by the WordPress Account Corner.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken } from "../src/lib/session";

const m = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/lib/db", () => ({ pool: { query: m.query } }));

import { GET, OPTIONS } from "../src/app/api/auth/session/route";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const HOST = "app.techytree.in";
const OK = "https://techytree.in";
const OK_WWW = "https://www.techytree.in";
const row = (over: Record<string, unknown> = {}) => ({ full_name: "Asha Rao", role: "TC", email_verification: "email", ...over });
const tokenFor = (id = "7", role = "TC", now = Date.now()) => createSessionToken({ id, role }, false, now, { SESSION_SECRET: SECRET } as never).token;

const get = (o: { cookie?: string; origin?: string } = {}) => {
  const headers: Record<string, string> = { host: HOST };
  if (o.cookie !== undefined) headers.cookie = `rv_session=${o.cookie}`;
  if (o.origin) headers.origin = o.origin;
  return GET(new NextRequest(`https://${HOST}/api/auth/session`, { headers }));
};
const preflight = (origin?: string) =>
  OPTIONS(new Request(`https://${HOST}/api/auth/session`, {
    method: "OPTIONS",
    headers: { host: HOST, "access-control-request-method": "GET", ...(origin ? { origin } : {}) },
  }));

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  m.query.mockReset().mockResolvedValue({ rows: [row()] });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("session check: results", () => {
  it("valid session -> 200 with only fullName and role", async () => {
    const res = await get({ cookie: tokenFor() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: true, user: { fullName: "Asha Rao", role: "TC" } });
    expect(m.query.mock.calls[0][1]).toEqual(["7"]); // parameterised, id taken from the verified token
  });

  it("never leaks the token, hash, email or id, even if the query returned them", async () => {
    const t = tokenFor();
    m.query.mockResolvedValue({ rows: [row({ id: "7", email: "asha@example.com", password_hash: "$2a$12$secrethash" })] });
    const res = await get({ cookie: t });
    const text = await res.text();
    for (const bad of [t, "secrethash", "asha@example.com", "password", "email\"", "\"id\""]) expect(text).not.toContain(bad);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("the role comes from the database, not from the token", async () => {
    m.query.mockResolvedValue({ rows: [row({ role: "ST" })] });
    const body = await (await get({ cookie: tokenFor("7", "SA") })).json();
    expect(body.user.role).toBe("ST");
  });

  it("missing cookie -> 401 and no database query", async () => {
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ authenticated: false });
    expect(m.query).not.toHaveBeenCalled();
  });

  it("tampered, malformed and expired tokens -> 401 and no database query", async () => {
    for (const cookie of [tokenFor().slice(0, -3) + "AAA", "garbage", "a.b", tokenFor("7", "TC", Date.now() - 13 * 3600 * 1000)]) {
      const res = await get({ cookie });
      expect(res.status, cookie).toBe(401);
      expect(await res.json()).toEqual({ authenticated: false });
    }
    expect(m.query).not.toHaveBeenCalled();
  });

  it("a token signed with a different secret -> 401", async () => {
    const forged = createSessionToken({ id: "7", role: "SA" }, false, Date.now(), { SESSION_SECRET: "another-secret-another-secret-12345" } as never).token;
    expect((await get({ cookie: forged })).status).toBe(401);
  });

  it("deleted user -> 401", async () => {
    m.query.mockResolvedValue({ rows: [] });
    const res = await get({ cookie: tokenFor() });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ authenticated: false });
  });

  it("an account that no longer satisfies the email-verification policy -> 401", async () => {
    m.query.mockResolvedValue({ rows: [row({ email_verification: "none" })] });
    expect((await get({ cookie: tokenFor() })).status).toBe(401);
  });

  it("database failure -> 503 with a generic body (no internals), and a redacted log line", async () => {
    m.query.mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED postgresql://neondb_owner:Pw9@ep-x.neon.tech/neondb"), { code: "ECONNREFUSED" }));
    const res = await get({ cookie: tokenFor(), origin: OK });
    const text = await res.text();
    expect(res.status).toBe(503);
    expect(JSON.parse(text)).toEqual({ authenticated: false, error: "SERVICE_UNAVAILABLE" });
    expect(text).not.toMatch(/ECONNREFUSED|postgres|neon|Pw9/);
    expect(res.headers.get("access-control-allow-origin")).toBe(OK); // the page can still read the status
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    console.error("session.check.failed: database lookup unavailable.");
    expect(logged).not.toMatch(/Pw9|neondb_owner|postgresql:\/\//);
  });

  it("missing SESSION_SECRET -> 503 (not a misleading 401)", async () => {
    const t = tokenFor();
    vi.stubEnv("SESSION_SECRET", "");
    expect((await get({ cookie: t })).status).toBe(503);
  });
});

describe("session check: CORS", () => {
  it.each([OK, OK_WWW])("allowed origin %s gets exact-origin, credentials and Vary headers on every outcome", async (origin) => {
    const outcomes = [await get({ cookie: tokenFor(), origin }), await get({ origin }), await get({ cookie: "garbage", origin })];
    expect(outcomes.map((r) => r.status)).toEqual([200, 401, 401]);
    for (const res of outcomes) {
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
      expect(res.headers.get("access-control-allow-credentials")).toBe("true");
      expect(res.headers.get("vary")).toMatch(/\bOrigin\b/);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it.each([
    "https://evil.example", "http://techytree.in", "https://techytree.in.evil.example", "https://evil-techytree.in",
    "https://sub.techytree.in", "https://techytree.in:8443", "https://TECHYTREE.IN", "null", "https://techytree.in/",
  ])("rejected origin %s: 403, no CORS headers, no data, no database query", async (origin) => {
    const res = await get({ cookie: tokenFor(), origin });
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    expect(res.headers.get("vary")).toMatch(/\bOrigin\b/);
    expect(await res.json()).toEqual({ authenticated: false, error: "ORIGIN_NOT_ALLOWED" });
    expect(m.query).not.toHaveBeenCalled();
  });

  it("never uses a wildcard, and sends no CORS headers when there is no Origin", async () => {
    const res = await get({ cookie: tokenFor() });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toMatch(/\bOrigin\b/);
    for (const origin of [OK, OK_WWW]) expect((await get({ origin })).headers.get("access-control-allow-origin")).not.toBe("*");
  });

  it("the app's own origin (same host) is not refused", async () => {
    expect((await get({ cookie: tokenFor(), origin: `https://${HOST}` })).status).toBe(200);
  });
});

describe("session check: preflight (OPTIONS)", () => {
  it.each([OK, OK_WWW])("allowed origin %s -> 204 with read-only methods and credentials", async (origin) => {
    const res = await preflight(origin);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    expect(res.headers.get("vary")).toMatch(/\bOrigin\b/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(m.query).not.toHaveBeenCalled();
  });

  it("rejected origin -> 403 and no CORS headers", async () => {
    const res = await preflight("https://evil.example");
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-methods")).toBeNull();
  });

  it("does not offer write methods", async () => {
    expect((await preflight(OK)).headers.get("access-control-allow-methods")).not.toMatch(/POST|PUT|DELETE|PATCH/);
  });
});
