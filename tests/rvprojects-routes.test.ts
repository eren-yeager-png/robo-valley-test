// GET /api/projects/[id] and GET /api/projects/subject-filter: the members-only gate.
// The real session code runs (cookie signature, expiry, database re-check); only the database and the WordPress bridge's
// network call are stubbed. Every response, success or error, must be Cache-Control: no-store.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createSessionToken } from "../src/lib/session";

const m = vi.hoisted(() => ({ query: vi.fn(), cookie: undefined as string | undefined, fetch: vi.fn(), cookieReads: 0 }));
vi.mock("../src/lib/db", () => ({ pool: { query: m.query } }));
vi.mock("next/headers", () => ({
  cookies: async () => { m.cookieReads++; return { get: (n: string) => (n === "rv_session" && m.cookie ? { name: n, value: m.cookie } : undefined) }; },
  headers: async () => ({ get: () => null }),
}));

import * as projectRoute from "../src/app/api/projects/[id]/route";
import * as subjectRoute from "../src/app/api/projects/subject-filter/route";
import * as optionsRoute from "../src/app/api/projects/subject-options/route";
import { IP_LIMIT, USER_LIMIT } from "../src/lib/projectsGate";
import { __resetRateLimit } from "../src/lib/projectsRateLimit";

const { GET: getProject, OPTIONS: optionsProject } = projectRoute;
const { GET: getSubjects, OPTIONS: optionsSubjects } = subjectRoute;

const SECRET = "unit-test-secret-unit-test-secret-1234";
const BRIDGE_SECRET = "bridge-secret-bridge-secret-0123456789";
const BRIDGE_URL = "https://wp.internal.example";
const HOST = "app.techytree.in";

const dbUser = (over: Record<string, unknown> = {}) => ({ id: "7", full_name: "Asha Rao", email: "asha@example.com", role: "TC", email_verification: "email", ...over });
const tokenFor = (id = "7", now = Date.now(), env: Record<string, string> = { SESSION_SECRET: SECRET }) => createSessionToken({ id, role: "TC" }, false, now, env as never).token;

const wpProject = (over: Record<string, unknown> = {}) => ({
  id: 12, title: "Line follower", short_description: "Follows a line", thumbnail: null, technology: [{ slug: "robotics", name: "Robotics" }], difficulty: { slug: "beginner", label: "Beginner" },
  education: [{ slug: "iti", name: "ITI" }], overview: "RESTRICTED-OVERVIEW", subjects: [{ slug: "physics", name: "Physics" }], skills: ["RESTRICTED-SKILL"], components: ["RESTRICTED-PART"], outcome: "RESTRICTED-OUTCOME", ...over,
});
const wpJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let ip = 0;
const projectReq = (id: string | number, o: { origin?: string; ip?: string; host?: string } = {}) =>
  new Request(`https://${HOST}/api/projects/${id}`, { headers: { host: o.host ?? HOST, "x-forwarded-for": o.ip ?? `10.0.0.${++ip}`, ...(o.origin ? { origin: o.origin } : {}) } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const subjectReq = (q: string, o: { origin?: string; ip?: string } = {}) =>
  new Request(`https://${HOST}/api/projects/subject-filter${q}`, { headers: { host: HOST, "x-forwarded-for": o.ip ?? `10.0.1.${++ip}`, ...(o.origin ? { origin: o.origin } : {}) } });
const signedIn = (id = "7") => { m.cookie = tokenFor(id); m.query.mockResolvedValue({ rows: [dbUser({ id })] }); };
const noStore = (r: Response) => expect(r.headers.get("cache-control")).toBe("no-store");
const bodyOf = async (r: Response) => await r.text();
const RESTRICTED = /RESTRICTED-|zebra/;

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("RVP_BRIDGE_URL", BRIDGE_URL);
  vi.stubEnv("RVP_BRIDGE_SECRET", BRIDGE_SECRET);
  vi.stubEnv("ALLOWED_ORIGINS", "https://techytree.in,https://www.techytree.in");
  m.cookie = undefined; m.cookieReads = 0;
  m.query.mockReset().mockResolvedValue({ rows: [] });
  m.fetch.mockReset().mockImplementation(async () => wpJson(wpProject()));
  vi.stubGlobal("fetch", m.fetch);
  __resetRateLimit();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("the routes only offer GET and OPTIONS", () => {
  it("exports no POST/PUT/PATCH/DELETE handlers", () => {
    for (const mod of [projectRoute, subjectRoute]) {
      const names = Object.keys(mod);
      for (const bad of ["POST", "PUT", "PATCH", "DELETE", "HEAD"]) expect(names).not.toContain(bad);
    }
  });
});

describe("GET /api/projects/[id]: input is validated before anything else", () => {
  it.each(["0", "-1", "abc", "1.5", "01", "1e3", "+1", " 1", "1 ", "99999999999", "2147483648", "0x1", "１２", "1;2", "%31", "../1", "1/2", ""])(
    "id %j -> 400 and neither the cookie, the database nor WordPress is touched",
    async (id) => {
      signedIn();
      const res = await getProject(projectReq("x"), ctx(id));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ success: false, error: "BAD_REQUEST" });
      noStore(res);
      expect(m.cookieReads).toBe(0);
      expect(m.query).not.toHaveBeenCalled();
      expect(m.fetch).not.toHaveBeenCalled();
    },
  );
});

describe("GET /api/projects/[id]: who may call it", () => {
  it("no cookie -> 401 with a generic body; WordPress is not called; nothing restricted", async () => {
    const res = await getProject(projectReq(12), ctx("12"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "UNAUTHENTICATED" });
    noStore(res);
    expect(m.query).not.toHaveBeenCalled();
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it("a tampered, forged, expired or garbage cookie -> 401 (the database is not even asked)", async () => {
    const good = tokenFor();
    const [body, sig] = good.split(".");
    const flipped = sig.slice(0, -2) + (sig.endsWith("AA") ? "BB" : "AA");
    const otherBody = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), sub: "8" })).toString("base64url");
    const cases = [
      `${body}.${flipped}`,                                  // signature changed
      `${otherBody}.${sig}`,                                 // payload changed (another user id), old signature
      tokenFor("7", Date.now(), { SESSION_SECRET: "another-secret-another-secret-another-1" }), // signed with a different secret
      tokenFor("7", Date.now() - 13 * 3600 * 1000),          // expired (12 h session)
      body, `${body}.`, `.${sig}`, `${good}.extra`, "garbage", "x".repeat(3000), "{}", "null",
    ];
    for (const c of cases) {
      m.cookie = c; m.query.mockClear(); m.fetch.mockClear();
      const res = await getProject(projectReq(12), ctx("12"));
      expect(res.status, c.slice(0, 30)).toBe(401);
      expect(await bodyOf(res)).not.toMatch(RESTRICTED);
      expect(m.query).not.toHaveBeenCalled();
      expect(m.fetch).not.toHaveBeenCalled();
    }
  });

  it("a valid cookie for a user who no longer exists, or who may not sign in, -> 401", async () => {
    m.cookie = tokenFor();
    m.query.mockResolvedValue({ rows: [] });
    expect((await getProject(projectReq(12), ctx("12"))).status).toBe(401);
    m.query.mockResolvedValue({ rows: [dbUser({ email_verification: "none" })] });
    expect((await getProject(projectReq(12), ctx("12"))).status).toBe(401);
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it("the database being down fails closed: 401, nothing from WordPress", async () => {
    m.cookie = tokenFor();
    m.query.mockRejectedValue(new Error("connection refused"));
    const res = await getProject(projectReq(12), ctx("12"));
    expect(res.status).toBe(401);
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it("the session is re-checked in the database with a parameterised query on every call", async () => {
    signedIn();
    await getProject(projectReq(12), ctx("12"));
    await getProject(projectReq(12), ctx("12"));
    expect(m.query).toHaveBeenCalledTimes(2);
    expect(m.query.mock.calls[0][1]).toEqual(["7"]);
  });
});

describe("GET /api/projects/[id]: success and the bridge", () => {
  it("signed-in member -> 200 with the restricted fields, no-store, nothing but the project", async () => {
    signedIn();
    const res = await getProject(projectReq(12), ctx("12"));
    expect(res.status).toBe(200);
    noStore(res);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.project).toMatchObject({ id: 12, title: "Line follower", overview: "RESTRICTED-OVERVIEW", outcome: "RESTRICTED-OUTCOME", skills: ["RESTRICTED-SKILL"], components: ["RESTRICTED-PART"] });
    expect(body.project.subjects).toEqual([{ slug: "physics", name: "Physics" }]);
    expect(Object.keys(body).sort()).toEqual(["project", "success"]);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("access-control-allow-origin")).toBeNull(); // no Origin sent: no CORS headers
    // the bridge was called once, server-side, for exactly this project
    expect(m.fetch).toHaveBeenCalledTimes(1);
    expect(String(m.fetch.mock.calls[0][0])).toBe(`${BRIDGE_URL}/wp-json/rvp-bridge/v1/project/12`);
  });

  it("the member's own cookie and any request header are never forwarded to WordPress", async () => {
    signedIn();
    await getProject(projectReq(12), ctx("12"));
    const init = m.fetch.mock.calls[0][1] as RequestInit;
    const names = Object.keys(init.headers as Record<string, string>).map((k) => k.toLowerCase());
    expect(names).not.toContain("cookie");
    expect(names).not.toContain("origin");
    expect(names).not.toContain("authorization");
  });

  it("the bridge says 404 (unknown / unpublished / protected) -> 404 NOT_FOUND with no project data", async () => {
    signedIn();
    m.fetch.mockResolvedValue(wpJson({ code: "rvp_bridge_error", message: "Not found.", data: { status: 404 } }, 404));
    const res = await getProject(projectReq(99), ctx("99"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "NOT_FOUND" });
    noStore(res);
  });

  const down: Array<[string, () => Promise<Response> | Response]> = [
    ["WordPress unreachable", () => { throw new TypeError("fetch failed: ECONNREFUSED 10.1.2.3:80"); }],
    ["WordPress answers 503 (bridge switched off)", () => wpJson({ code: "rvp_bridge_error" }, 503)],
    ["WordPress answers 401 (signature or clock rejected)", () => wpJson({ code: "rvp_bridge_error" }, 401)],
    ["WordPress answers 403", () => wpJson({}, 403)],
    ["WordPress answers 500", () => new Response("<html>Fatal error at /var/www/secret.php</html>", { status: 500 })],
    ["WordPress redirects", () => new Response(null, { status: 302, headers: { location: "https://evil.example" } })],
    ["HTML instead of JSON", () => new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } })],
    ["malformed JSON", () => new Response("{oops", { status: 200, headers: { "content-type": "application/json" } })],
    ["wrong shape", () => wpJson({ id: 12, title: "x" })],
    ["a different project than asked for", () => wpJson(wpProject({ id: 13 }))],
  ];
  it.each(down)("%s -> 503, no restricted data, no internal detail", async (_n, answer) => {
    signedIn();
    m.fetch.mockImplementation(async () => answer());
    const res = await getProject(projectReq(12), ctx("12"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ success: false, error: "UNAVAILABLE" });
    noStore(res);
    const text = JSON.stringify([...res.headers.entries()]);
    expect(text).not.toMatch(/wp\.internal|ECONNREFUSED|10\.1\.2\.3|secret\.php|evil\.example|RESTRICTED/);
  });

  it("a timeout (bridge too slow) -> 503", async () => {
    signedIn();
    m.fetch.mockImplementation((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason))));
    const t = Date.now();
    const res = await getProject(projectReq(12), ctx("12")); // the real 4 s timeout would be slow: shorten it by faking timers is overkill, so just assert behaviour once it fires
    expect(res.status).toBe(503);
    expect(Date.now() - t).toBeLessThan(6000);
  }, 10000);

  it.each([
    ["no URL", { RVP_BRIDGE_URL: "" }], ["no secret", { RVP_BRIDGE_SECRET: "" }], ["a 31-character secret", { RVP_BRIDGE_SECRET: "x".repeat(31) }],
  ])("bridge misconfigured (%s) -> 503 and WordPress is never called", async (_n, over) => {
    signedIn();
    for (const [k, v] of Object.entries(over)) vi.stubEnv(k, v);
    const res = await getProject(projectReq(12), ctx("12"));
    expect(res.status).toBe(503);
    expect(m.fetch).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ success: false, error: "UNAVAILABLE" });
  });

  it("the bridge secret and URL never appear in any response or header, success or failure", async () => {
    const seen: string[] = [];
    signedIn();
    for (const answer of [() => wpJson(wpProject()), () => wpJson({}, 404), () => wpJson({}, 500)]) {
      m.fetch.mockImplementation(async () => answer());
      const res = await getProject(projectReq(12), ctx("12"));
      seen.push(await res.text(), JSON.stringify([...res.headers.entries()]));
    }
    expect(seen.join("\n")).not.toContain(BRIDGE_SECRET);
    expect(seen.join("\n")).not.toContain("wp.internal");
  });
});

describe("rate limiting", () => {
  it("per member: the limit is allowed, the next call is 429 with Retry-After, and another member is unaffected", async () => {
    for (let i = 0; i < USER_LIMIT.limit; i++) {
      signedIn("7");
      expect((await getProject(projectReq(12), ctx("12"))).status).toBe(200);
    }
    signedIn("7");
    const blocked = await getProject(projectReq(12), ctx("12"));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ success: false, error: "TOO_MANY_REQUESTS" });
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    noStore(blocked);
    m.fetch.mockClear();
    signedIn("8"); // a different member (and a different IP) is fine
    expect((await getProject(projectReq(12), ctx("12"))).status).toBe(200);
  });

  it("per IP: even without a cookie, the limit is enforced before the database is asked", async () => {
    const sameIp = "203.0.113.9";
    for (let i = 0; i < IP_LIMIT.limit; i++) expect((await getProject(projectReq(12, { ip: sameIp }), ctx("12"))).status).toBe(401);
    m.query.mockClear();
    const blocked = await getProject(projectReq(12, { ip: sameIp }), ctx("12"));
    expect(blocked.status).toBe(429);
    expect(m.query).not.toHaveBeenCalled();
    expect((await getProject(projectReq(12, { ip: "203.0.113.10" }), ctx("12"))).status).toBe(401); // another address is unaffected
  });

  it("the subject-filter route is limited too, and shares the member's budget", async () => {
    for (let i = 0; i < USER_LIMIT.limit; i++) { signedIn("7"); m.fetch.mockImplementation(async () => wpJson({ ids: [], total: 0, limit: 1000, truncated: false })); expect((await getSubjects(subjectReq("?subjects=physics"))).status).toBe(200); }
    signedIn("7");
    expect((await getSubjects(subjectReq("?subjects=physics"))).status).toBe(429);
    expect((await getProject(projectReq(12), ctx("12"))).status).toBe(429);
  });

  it("falls back to a shared 'unknown' key when no forwarding header exists (still limited)", async () => {
    const noIp = () => new Request(`https://${HOST}/api/projects/12`, { headers: { host: HOST } });
    for (let i = 0; i < IP_LIMIT.limit; i++) await getProject(noIp(), ctx("12"));
    expect((await getProject(noIp(), ctx("12"))).status).toBe(429);
  });
});

describe("CORS: only origins from ALLOWED_ORIGINS, with credentials; nothing for anyone else", () => {
  it.each(["https://techytree.in", "https://www.techytree.in"])("listed origin %s -> 200 with Allow-Origin (echoed, never *), credentials and Vary: Origin", async (origin) => {
    signedIn();
    const res = await getProject(projectReq(12, { origin }), ctx("12"));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    expect(res.headers.get("vary")).toContain("Origin");
    noStore(res);
  });

  it.each(["https://evil.example", "http://techytree.in", "https://techytree.in.evil.example", "https://sub.techytree.in", "https://techytree.in:8443", "null", "*", "https://TECHYTREE.IN.", "not a url", ""])(
    "unlisted origin %j -> 403, no CORS headers, no data, nothing looked up",
    async (origin) => {
      signedIn();
      const res = await getProject(projectReq(12, { origin: origin || "null" }), ctx("12"));
      expect(res.status).toBe(403);
      expect([...res.headers.keys()].filter((k) => k.startsWith("access-control-"))).toEqual([]);
      expect(res.headers.get("vary")).toContain("Origin");
      expect(await res.json()).toEqual({ success: false, error: "FORBIDDEN" });
      noStore(res);
      expect(m.query).not.toHaveBeenCalled();
      expect(m.fetch).not.toHaveBeenCalled();
    },
  );

  it("the app's own origin (same host) is allowed", async () => {
    signedIn();
    const res = await getProject(projectReq(12, { origin: `https://${HOST}` }), ctx("12"));
    expect(res.status).toBe(200);
  });

  it("the list is exactly ALLOWED_ORIGINS when set (the default list does not widen it)", async () => {
    vi.stubEnv("ALLOWED_ORIGINS", "http://localhost:8080");
    signedIn();
    const ok = await getProject(projectReq(12, { origin: "http://localhost:8080" }), ctx("12"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:8080");
    expect((await getProject(projectReq(12, { origin: "https://techytree.in" }), ctx("12"))).status).toBe(403);
  });

  it("the same rules apply to the subject-filter route", async () => {
    signedIn();
    m.fetch.mockImplementation(async () => wpJson({ ids: [1], total: 1, limit: 1000, truncated: false }));
    const ok = await getSubjects(subjectReq("?subjects=physics", { origin: "https://techytree.in" }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://techytree.in");
    const bad = await getSubjects(subjectReq("?subjects=physics", { origin: "https://evil.example" }));
    expect(bad.status).toBe(403);
    expect([...bad.headers.keys()].filter((k) => k.startsWith("access-control-"))).toEqual([]);
  });

  it.each([["project", optionsProject], ["subject-filter", optionsSubjects]] as const)("OPTIONS preflight on %s", (_n, options) => {
    const pre = (origin: string) => options(new Request(`https://${HOST}/api/projects/12`, { method: "OPTIONS", headers: { host: HOST, origin, "access-control-request-method": "GET" } }));
    const allowed = pre("https://techytree.in");
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://techytree.in");
    expect(allowed.headers.get("access-control-allow-credentials")).toBe("true");
    expect(allowed.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    expect(allowed.headers.get("vary")).toContain("Origin");
    noStore(allowed);
    const denied = pre("https://evil.example");
    expect(denied.status).toBe(403);
    expect([...denied.headers.keys()].filter((k) => k.startsWith("access-control-"))).toEqual([]);
    noStore(denied);
  });
});

describe("GET /api/projects/subject-filter", () => {
  const ids = (over: Record<string, unknown> = {}) => ({ ids: [3, 5, 9], total: 3, limit: 1000, truncated: false, ...over });

  it.each(["", "?", "?subjects=", "?subjects=,,", "?subjects=Physics", "?subjects=phys%20ics", "?subjects=../x", "?subjects=a'b", "?subjects=a;b", "?subjects=" + "a".repeat(61),
    "?subjects=-a", "?subjects=a-", "?subjects=a--b", "?subjects=_a", "?subjects=a_", "?subjects=a__b", "?subjects=A_b", "?subjects=" + Array.from({ length: 13 }, (_v, i) => "s" + i).join(","), "?subject=physics", "?subjects=ph%00ysics", "?subjects=%E2%82%AC"])(
    "input %j -> 400 and no cookie, database or WordPress access",
    async (q) => {
      signedIn();
      const res = await getSubjects(subjectReq(q));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ success: false, error: "BAD_REQUEST" });
      noStore(res);
      expect(m.cookieReads).toBe(0);
      expect(m.fetch).not.toHaveBeenCalled();
    },
  );

  it("no cookie -> 401; tampered cookie -> 401; WordPress is never asked", async () => {
    expect((await getSubjects(subjectReq("?subjects=physics"))).status).toBe(401);
    m.cookie = tokenFor().replace(/.$/, "x");
    const res = await getSubjects(subjectReq("?subjects=physics"));
    expect(res.status).toBe(401);
    noStore(res);
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it("member -> 200 with only the ids and the honest counts; subjects are signed into the bridge query", async () => {
    signedIn();
    m.fetch.mockImplementation(async () => wpJson(ids()));
    const res = await getSubjects(subjectReq("?subjects=physics,computer-science,physics"));
    expect(res.status).toBe(200);
    noStore(res);
    expect(await res.json()).toEqual({ success: true, ids: [3, 5, 9], total: 3, limit: 1000, truncated: false });
    expect(String(m.fetch.mock.calls[0][0])).toBe(`${BRIDGE_URL}/wp-json/rvp-bridge/v1/subject-ids?subjects=physics%2Ccomputer-science`); // de-duplicated
  });

  it("accepts slugs with hyphens and underscores, as WordPress makes them", async () => {
    signedIn();
    m.fetch.mockImplementation(async () => wpJson(ids()));
    expect((await getSubjects(subjectReq("?subjects=computer-science,machine_learning,3d-design"))).status).toBe(200);
    expect(String(m.fetch.mock.calls[0][0])).toContain("subjects=computer-science%2Cmachine_learning%2C3d-design");
  });

  it("a result larger than the cap is reported as truncated, never cut silently", async () => {
    signedIn();
    m.fetch.mockImplementation(async () => wpJson(ids({ ids: [1, 2], total: 1500, limit: 2, truncated: true })));
    const body = await (await getSubjects(subjectReq("?subjects=physics"))).json();
    expect(body).toMatchObject({ success: true, total: 1500, limit: 2, truncated: true });
    expect(body.ids).toHaveLength(2);
  });

  it("returns ids only: nothing about subjects, titles or restricted fields", async () => {
    signedIn();
    m.fetch.mockImplementation(async () => wpJson({ ...ids(), subjects: [{ name: "RESTRICTED-SUBJECT" }], overview: "RESTRICTED-OVERVIEW" }));
    const text = await (await getSubjects(subjectReq("?subjects=physics"))).text();
    expect(text).not.toMatch(RESTRICTED);
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["ids", "limit", "success", "total", "truncated"]);
  });

  it.each([
    ["unreachable", () => { throw new TypeError("ECONNREFUSED"); }], ["503", () => wpJson({}, 503)], ["404 (plugin missing)", () => wpJson({}, 404)], ["wrong shape", () => wpJson({ ids: "x" })], ["500", () => new Response("boom", { status: 500 })],
  ])("bridge %s -> 503 with no data", async (_n, answer) => {
    signedIn();
    m.fetch.mockImplementation(async () => answer());
    const res = await getSubjects(subjectReq("?subjects=physics"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ success: false, error: "UNAVAILABLE" });
    noStore(res);
  });

  it("misconfigured bridge -> 503 without calling WordPress", async () => {
    signedIn(); vi.stubEnv("RVP_BRIDGE_SECRET", "short");
    expect((await getSubjects(subjectReq("?subjects=physics"))).status).toBe(503);
    expect(m.fetch).not.toHaveBeenCalled();
  });
});

describe("every status the routes can produce is no-store", () => {
  it("200, 400, 401, 403, 404, 429 and 503 on both routes", async () => {
    const seen = new Set<number>();
    const check = (r: Response) => { seen.add(r.status); expect(r.headers.get("cache-control"), String(r.status)).toBe("no-store"); };
    signedIn(); m.fetch.mockImplementation(async () => wpJson(wpProject())); check(await getProject(projectReq(12), ctx("12")));
    check(await getProject(projectReq(12), ctx("abc")));
    m.cookie = undefined; check(await getProject(projectReq(12), ctx("12")));
    signedIn(); check(await getProject(projectReq(12, { origin: "https://evil.example" }), ctx("12")));
    m.fetch.mockImplementation(async () => wpJson({}, 404)); check(await getProject(projectReq(12), ctx("12")));
    m.fetch.mockImplementation(async () => wpJson({}, 500)); check(await getProject(projectReq(12), ctx("12")));
    for (let i = 0; i < IP_LIMIT.limit + 1; i++) check(await getProject(projectReq(12, { ip: "198.51.100.1" }), ctx("12")));
    check(await getSubjects(subjectReq("?subjects=physics")));
    check(await getSubjects(subjectReq("")));
    expect([...seen].sort()).toEqual([200, 400, 401, 403, 404, 429, 503]);
  });
});

describe("GET /api/projects/subject-options", () => {
  const { GET: getOptions, OPTIONS: optionsOptions } = optionsRoute;
  const optReq = (o: { origin?: string } = {}) => new Request(`https://${HOST}/api/projects/subject-options`, { headers: { host: HOST, "x-forwarded-for": `10.0.2.${++ip}`, ...(o.origin ? { origin: o.origin } : {}) } });

  it("no cookie -> 401 and WordPress is not asked; tampered cookie -> 401", async () => {
    expect((await getOptions(optReq())).status).toBe(401);
    m.cookie = tokenFor().replace(/.$/, "x");
    const res = await getOptions(optReq());
    expect(res.status).toBe(401);
    noStore(res);
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it("member -> 200 with the list, no-store; the bridge is asked for the subject list only", async () => {
    signedIn();
    m.fetch.mockImplementation(async () => wpJson({ subjects: [{ slug: "physics", name: "Physics" }, { slug: "chemistry", name: "Chemistry" }] }));
    const res = await getOptions(optReq());
    expect(res.status).toBe(200);
    noStore(res);
    expect(await res.json()).toEqual({ success: true, subjects: [{ slug: "physics", name: "Physics" }, { slug: "chemistry", name: "Chemistry" }] });
    expect(String(m.fetch.mock.calls[0][0])).toBe(`${BRIDGE_URL}/wp-json/rvp-bridge/v1/subjects`);
  });

  it.each([["unreachable", () => { throw new TypeError("x"); }], ["503", () => wpJson({}, 503)], ["404", () => wpJson({}, 404)], ["wrong shape", () => wpJson({ subjects: [1] })], ["not a list", () => wpJson({ subjects: "x" })]])(
    "bridge %s -> 503, nothing leaked",
    async (_n, answer) => {
      signedIn();
      m.fetch.mockImplementation(async () => answer());
      const res = await getOptions(optReq());
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ success: false, error: "UNAVAILABLE" });
      noStore(res);
    },
  );

  it("CORS: allowed origin echoed, unlisted origin 403 with no CORS headers; preflight likewise", async () => {
    signedIn();
    expect((await getOptions(optReq({ origin: "https://techytree.in" }))).headers.get("access-control-allow-origin")).toBe("https://techytree.in");
    const bad = await getOptions(optReq({ origin: "https://evil.example" }));
    expect(bad.status).toBe(403);
    expect([...bad.headers.keys()].filter((k) => k.startsWith("access-control-"))).toEqual([]);
    expect(optionsOptions(new Request(`https://${HOST}/x`, { method: "OPTIONS", headers: { host: HOST, origin: "https://techytree.in" } })).status).toBe(204);
  });
});
