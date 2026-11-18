// POST/OPTIONS /api/auth/logout: same-origin logout still works, and the two WordPress origins may log out
// cross-origin (credentialed). Every other origin is refused. No database is involved.
import { describe, expect, it } from "vitest";
import { OPTIONS, POST } from "../src/app/api/auth/logout/route";

const HOST = "app.techytree.in";
const OK = "https://techytree.in";
const OK_WWW = "https://www.techytree.in";
const post = (origin?: string) =>
  POST(new Request(`https://${HOST}/api/auth/logout`, { method: "POST", headers: { host: HOST, ...(origin ? { origin } : {}) } }));
const preflight = (origin?: string) =>
  OPTIONS(new Request(`https://${HOST}/api/auth/logout`, { method: "OPTIONS", headers: { host: HOST, "access-control-request-method": "POST", ...(origin ? { origin } : {}) } }));

describe("logout: allowed callers", () => {
  it.each([undefined, `https://${HOST}`, OK, OK_WWW])("origin %s: 200 and the session cookie is expired (HttpOnly)", async (origin) => {
    const res = await post(origin);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/rv_session=;/);
    expect(cookie).toMatch(/Max-Age=0/i);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it.each([OK, OK_WWW])("WordPress origin %s gets exact-origin CORS with credentials", async (origin) => {
    const res = await post(origin);
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("vary")).toMatch(/\bOrigin\b/);
  });

  it("no Origin or the app's own origin: no CORS headers", async () => {
    for (const origin of [undefined, `https://${HOST}`]) expect((await post(origin)).headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("logout: refused callers", () => {
  it.each(["https://evil.example", "http://techytree.in", "https://techytree.in.evil.example", "https://sub.techytree.in", "https://techytree.in:8443", "null"])(
    "origin %s: 403, no CORS headers, cookie NOT touched",
    async (origin) => {
      const res = await post(origin);
      expect(res.status).toBe(403);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      expect(res.headers.get("access-control-allow-credentials")).toBeNull();
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  );
});

describe("logout: preflight", () => {
  it.each([OK, OK_WWW])("%s -> 204 with POST only and credentials", async (origin) => {
    const res = await preflight(origin);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(res.headers.get("vary")).toMatch(/\bOrigin\b/);
  });

  it("other origins -> 403 and no CORS headers", async () => {
    const res = await preflight("https://evil.example");
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
