// src/lib/cors.ts: exact-match origin allow-list with a built-in fallback for the production WordPress site.
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ALLOWED_ORIGINS, allowedOrigins, corsOrigin, preflight, withCors } from "../src/lib/cors";

const env = (v?: string) => ({ ...(v === undefined ? {} : { ALLOWED_ORIGINS: v }) }) as unknown as NodeJS.ProcessEnv;
const req = (origin?: string, method = "GET") => new Request("https://app.techytree.in/api/auth/me", { method, headers: origin ? { origin } : {} });

afterEach(() => vi.unstubAllEnvs());

describe("allowedOrigins", () => {
  it("falls back to the two production origins when ALLOWED_ORIGINS is unset, empty or has no valid entry", () => {
    const want = ["https://techytree.in", "https://www.techytree.in"];
    expect([...DEFAULT_ALLOWED_ORIGINS]).toEqual(want);
    for (const v of [undefined, "", "   ", ",,,", "not a url", '"https://techytree.in', "ftp://techytree.in", "javascript:alert(1)"]) {
      expect(allowedOrigins(env(v))).toEqual(want);
    }
  });

  it("uses ONLY the configured list when it has a valid entry (the default does not widen it)", () => {
    expect(allowedOrigins(env("http://localhost:8080"))).toEqual(["http://localhost:8080"]);
    expect(allowedOrigins(env(" https://techytree.in/ , https://a.example:8443 ,bad"))).toEqual(["https://techytree.in", "https://a.example:8443"]);
  });

  it("never contains a wildcard", () => {
    expect(allowedOrigins(env("*"))).toEqual([...DEFAULT_ALLOWED_ORIGINS]);
    expect(allowedOrigins(env("*")).join(",")).not.toContain("*");
  });
});

describe("CORS responses with the default list (ALLOWED_ORIGINS not set)", () => {
  it.each(["https://techytree.in", "https://www.techytree.in"])("echoes %s with credentials", (o) => {
    vi.stubEnv("ALLOWED_ORIGINS", "");
    expect(corsOrigin(req(o))).toBe(o);
    const res = withCors(req(o), new Response("{}"), "GET, OPTIONS");
    expect(res.headers.get("access-control-allow-origin")).toBe(o);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("vary")).toContain("Origin");
  });

  it("answers the preflight for an allowed origin with 204 and the CORS headers", () => {
    vi.stubEnv("ALLOWED_ORIGINS", "");
    const pre = preflight(req("https://techytree.in", "OPTIONS"), "POST, OPTIONS");
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://techytree.in");
    expect(pre.headers.get("access-control-allow-credentials")).toBe("true");
    expect(pre.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(pre.headers.get("access-control-allow-headers")).toBe("Content-Type");
  });

  it("still refuses any other origin: no allow-origin header, preflight 403", () => {
    vi.stubEnv("ALLOWED_ORIGINS", "");
    for (const o of ["https://example.com", "https://evil.techytree.in", "http://techytree.in", "https://techytree.in.evil.example", "null"]) {
      expect(corsOrigin(req(o))).toBeNull();
      expect(withCors(req(o), new Response("{}")).headers.get("access-control-allow-origin")).toBeNull();
      expect(preflight(req(o, "OPTIONS"), "POST, OPTIONS").status).toBe(403);
    }
  });

  it("a configured list replaces the default: techytree.in is then NOT allowed unless it is listed", () => {
    vi.stubEnv("ALLOWED_ORIGINS", "http://localhost:8080");
    expect(corsOrigin(req("https://techytree.in"))).toBeNull();
    expect(corsOrigin(req("http://localhost:8080"))).toBe("http://localhost:8080");
  });
});
