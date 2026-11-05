// src/lib/projectsBridge.ts: signs requests for the WordPress bridge, fails closed, and only passes on well-formed data.
import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalQuery, getProject, getSubjectIds, parseProject, signBridgeRequest } from "../src/lib/projectsBridge";

const SECRET = "s".repeat(24) + "0123456789abcdef"; // 40 chars
const env = (o: Record<string, string | undefined> = {}) => ({ RVP_BRIDGE_URL: "https://wp.internal", RVP_BRIDGE_SECRET: SECRET, ...o }) as unknown as NodeJS.ProcessEnv;

const project = (over: Record<string, unknown> = {}) => ({
  id: 12, title: "Line follower", short_description: "Follows a line", thumbnail: { url: "https://techytree.in/u/a.png", width: 640, height: 400, alt: "alt", srcset: "https://techytree.in/u/a.png 640w" },
  technology: [{ slug: "robotics", name: "Robotics" }], difficulty: { slug: "beginner", label: "Beginner" }, education: [{ slug: "iti", name: "ITI" }],
  overview: "OVERVIEW-TEXT", subjects: [{ slug: "physics", name: "Physics" }], skills: ["Soldering", "C++"], components: ["Arduino"], outcome: "OUTCOME-TEXT", ...over,
});
const jsonRes = (body: unknown, status = 200, type = "application/json; charset=UTF-8") => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": type } });

let errors: string[];
beforeEach(() => { errors = []; vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a.join(" ")); }); });
afterEach(() => vi.restoreAllMocks());

describe("signing", () => {
  it("matches an independently computed HMAC over method, route, timestamp, nonce and the query hash", () => {
    const now = 1_793_000_000_123, nonce = "abcdef0123456789abcdef";
    const h = signBridgeRequest("GET", "/rvp-bridge/v1/subject-ids", { subjects: "physics,chemistry" }, SECRET, now, nonce);
    const toSign = ["RVP1", "GET", "/rvp-bridge/v1/subject-ids", "1793000000", nonce, createHash("sha256").update("subjects=physics%2Cchemistry").digest("hex")].join("\n");
    expect(h).toEqual({ "X-RVP-Timestamp": "1793000000", "X-RVP-Nonce": nonce, "X-RVP-Signature": createHmac("sha256", SECRET).update(toSign).digest("hex") });
  });

  it("uses a fresh random nonce each time (16+ chars of the allowed alphabet)", () => {
    const a = signBridgeRequest("GET", "/r", {}, SECRET), b = signBridgeRequest("GET", "/r", {}, SECRET);
    expect(a["X-RVP-Nonce"]).not.toBe(b["X-RVP-Nonce"]);
    expect(a["X-RVP-Nonce"]).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(a["X-RVP-Signature"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changing the method, route, query or secret changes the signature", () => {
    const base = signBridgeRequest("GET", "/a", { x: "1" }, SECRET, 1e12, "n".repeat(16))["X-RVP-Signature"];
    expect(signBridgeRequest("POST", "/a", { x: "1" }, SECRET, 1e12, "n".repeat(16))["X-RVP-Signature"]).not.toBe(base);
    expect(signBridgeRequest("GET", "/b", { x: "1" }, SECRET, 1e12, "n".repeat(16))["X-RVP-Signature"]).not.toBe(base);
    expect(signBridgeRequest("GET", "/a", { x: "2" }, SECRET, 1e12, "n".repeat(16))["X-RVP-Signature"]).not.toBe(base);
    expect(signBridgeRequest("GET", "/a", { x: "1" }, SECRET + "x", 1e12, "n".repeat(16))["X-RVP-Signature"]).not.toBe(base);
  });

  it("encodes the query like PHP's rawurlencode, sorted by name", () => {
    expect(canonicalQuery({})).toBe("");
    expect(canonicalQuery({ b: "2", a: "1" })).toBe("a=1&b=2");
    expect(canonicalQuery({ subjects: "a,b" })).toBe("subjects=a%2Cb");
    expect(canonicalQuery({ q: "!'()* ~-_.é" })).toBe("q=%21%27%28%29%2A%20~-_.%C3%A9");
  });
});

describe("requests", () => {
  it("sends a signed, credential-free GET: no Origin or Cookie, no redirects followed, a timeout, no caching", async () => {
    const f = vi.fn(async () => jsonRes(project()));
    const r = await getProject(12, { env: env(), fetchImpl: f as never, now: 1_793_000_000_000 });
    expect(r).toEqual({ ok: true, data: project() });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://wp.internal/wp-json/rvp-bridge/v1/project/12");
    expect(init.method).toBe("GET");
    const h = init.headers as Record<string, string>;
    expect(Object.keys(h).map((k) => k.toLowerCase())).toEqual(["accept", "x-rvp-timestamp", "x-rvp-nonce", "x-rvp-signature"]);
    expect(init.redirect).toBe("manual");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // the signature on the wire verifies with an independent computation
    const expected = createHmac("sha256", SECRET).update(["RVP1", "GET", "/rvp-bridge/v1/project/12", h["X-RVP-Timestamp"], h["X-RVP-Nonce"], createHash("sha256").update("").digest("hex")].join("\n")).digest("hex");
    expect(h["X-RVP-Signature"]).toBe(expected);
    expect(JSON.stringify([url, h])).not.toContain(SECRET); // the secret itself is never sent
  });

  it("puts the subjects in the query and signs exactly that query", async () => {
    const f = vi.fn(async () => jsonRes({ ids: [3, 5], total: 2, limit: 1000, truncated: false }));
    const r = await getSubjectIds(["physics", "computer-science"], { env: env({ RVP_BRIDGE_URL: "https://wp.internal/blog/" }), fetchImpl: f as never, now: 1_793_000_000_000 });
    expect(r).toEqual({ ok: true, data: { ids: [3, 5], total: 2, limit: 1000, truncated: false } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://wp.internal/blog/wp-json/rvp-bridge/v1/subject-ids?subjects=physics%2Ccomputer-science");
    const h = init.headers as Record<string, string>;
    const sig = createHmac("sha256", SECRET).update(["RVP1", "GET", "/rvp-bridge/v1/subject-ids", h["X-RVP-Timestamp"], h["X-RVP-Nonce"], createHash("sha256").update("subjects=physics%2Ccomputer-science").digest("hex")].join("\n")).digest("hex");
    expect(h["X-RVP-Signature"]).toBe(sig);
  });

  it("passes a truncated result through honestly", async () => {
    const f = vi.fn(async () => jsonRes({ ids: [1, 2], total: 1500, limit: 1000, truncated: true }));
    expect(await getSubjectIds(["physics"], { env: env(), fetchImpl: f as never })).toEqual({ ok: true, data: { ids: [1, 2], total: 1500, limit: 1000, truncated: true } });
  });
});

describe("fails closed", () => {
  const cases: Array<[string, Record<string, string | undefined>]> = [
    ["no URL", { RVP_BRIDGE_URL: undefined }], ["empty URL", { RVP_BRIDGE_URL: " " }], ["URL is not http(s)", { RVP_BRIDGE_URL: "ftp://wp" }], ["URL is garbage", { RVP_BRIDGE_URL: "not a url" }],
    ["no secret", { RVP_BRIDGE_SECRET: undefined }], ["empty secret", { RVP_BRIDGE_SECRET: "" }], ["31-character secret", { RVP_BRIDGE_SECRET: "x".repeat(31) }],
  ];
  it.each(cases)("%s: unavailable, and WordPress is never called", async (_n, over) => {
    const f = vi.fn();
    expect(await getProject(12, { env: env(over), fetchImpl: f as never })).toEqual({ ok: false, reason: "unavailable" });
    expect(await getSubjectIds(["a"], { env: env(over), fetchImpl: f as never })).toEqual({ ok: false, reason: "unavailable" });
    expect(f).not.toHaveBeenCalled();
  });

  it("a 32-character secret is accepted", async () => {
    const f = vi.fn(async () => jsonRes(project()));
    expect((await getProject(12, { env: env({ RVP_BRIDGE_SECRET: "x".repeat(32) }), fetchImpl: f as never })).ok).toBe(true);
  });

  it("404 means not_found (project routes only)", async () => {
    expect(await getProject(12, { env: env(), fetchImpl: (async () => jsonRes({ code: "x" }, 404)) as never })).toEqual({ ok: false, reason: "not_found" });
    expect(await getSubjectIds(["a"], { env: env(), fetchImpl: (async () => jsonRes({}, 404)) as never })).toEqual({ ok: false, reason: "unavailable" }); // the plugin is missing
  });

  it.each([400, 401, 403, 429, 500, 502, 503, 504, 301, 302, 307, 204])("HTTP %i is unavailable", async (status) => {
    expect(await getProject(12, { env: env(), fetchImpl: (async () => jsonRes(project(), status)) as never })).toEqual({ ok: false, reason: "unavailable" });
  });

  it("network error, timeout, non-JSON, wrong content type and oversize bodies are unavailable", async () => {
    const o = (fetchImpl: unknown) => getProject(12, { env: env(), fetchImpl: fetchImpl as never, timeoutMs: 30 });
    expect(await o(async () => { throw new TypeError("fetch failed"); })).toEqual({ ok: false, reason: "unavailable" });
    expect(await o((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason))))).toEqual({ ok: false, reason: "unavailable" }); // really times out
    expect(await o(async () => jsonRes("<html>oops</html>", 200, "text/html"))).toEqual({ ok: false, reason: "unavailable" });
    expect(await o(async () => jsonRes("{not json", 200))).toEqual({ ok: false, reason: "unavailable" });
    expect(await o(async () => jsonRes(JSON.stringify({ pad: "x".repeat(300_000) }), 200))).toEqual({ ok: false, reason: "unavailable" });
  });

  it("a response that is valid JSON of the wrong shape is unavailable (never passed on)", async () => {
    const bad: unknown[] = [
      null, [], "str", 42, {}, project({ id: "12" }), project({ id: 13 }), project({ id: 0 }), project({ title: 5 }), project({ overview: null }), project({ outcome: undefined }),
      project({ skills: "a" }), project({ skills: [1] }), project({ components: null }), project({ subjects: [{ slug: 1, name: "x" }] }), project({ technology: [null] }),
      project({ education: {} }), project({ difficulty: { slug: 1 } }), project({ thumbnail: { url: "javascript:alert(1)", width: 1, height: 1, alt: "" } }),
      project({ thumbnail: { url: "https://x/a.png", width: "1", height: 1, alt: "" } }), project({ skills: Array.from({ length: 51 }, () => "x") }),
    ];
    for (const b of bad) expect(await getProject(12, { env: env(), fetchImpl: (async () => jsonRes(b)) as never })).toEqual({ ok: false, reason: "unavailable" });
    for (const b of [null, {}, { ids: "1" }, { ids: [1, "2"], total: 2, limit: 1, truncated: false }, { ids: [0], total: 1, limit: 1, truncated: false }, { ids: [1], total: 1, limit: 1 }, { ids: [1], total: -1, limit: 1, truncated: false }]) {
      expect(await getSubjectIds(["a"], { env: env(), fetchImpl: (async () => jsonRes(b)) as never })).toEqual({ ok: false, reason: "unavailable" });
    }
  });

  it("never logs the secret, a signature, or project text", async () => {
    await getProject(12, { env: env(), fetchImpl: (async () => jsonRes(project(), 500)) as never });
    await getProject(12, { env: env(), fetchImpl: (async () => { throw new Error(`boom ${SECRET}`); }) as never });
    await getProject(12, { env: env(), fetchImpl: (async () => jsonRes(project({ id: "x" }))) as never });
    await getProject(12, { env: env({ RVP_BRIDGE_URL: undefined }), fetchImpl: vi.fn() as never });
    expect(errors.length).toBeGreaterThan(0);
    const all = errors.join("\n");
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain("OVERVIEW-TEXT");
    expect(all).not.toContain("OUTCOME-TEXT");
    expect(all).not.toMatch(/[0-9a-f]{64}/); // no signature
  });
});

describe("parseProject", () => {
  it("keeps only the known fields (unknown extras from the server are dropped)", () => {
    const p = parseProject({ ...project(), secret_extra: "x", admin_note: "y" }) as Record<string, unknown>;
    expect(Object.keys(p).sort()).toEqual(["components", "difficulty", "education", "id", "outcome", "overview", "short_description", "skills", "subjects", "technology", "thumbnail", "title"]);
  });
  it("accepts a project with no image and no difficulty", () => {
    expect(parseProject(project({ thumbnail: null, difficulty: null }))).toMatchObject({ thumbnail: null, difficulty: null });
  });
});
