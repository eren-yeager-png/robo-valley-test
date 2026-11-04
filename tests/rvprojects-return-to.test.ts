// returnTo validation (src/lib/projectsReturnTo.ts + resolveReturnTo in src/lib/session.ts). The value is attacker-controlled input
// from a URL, so this is mostly an open-redirect test list: everything must come back null (callers then use SITE_URL).
import { describe, expect, it } from "vitest";
import { validateReturnTo } from "../src/lib/projectsReturnTo";
import { projectsReturnPath, resolveReturnTo, siteUrl } from "../src/lib/session";

const SITE = "https://techytree.in/";
const PATH = "/projects/";
const ok = (raw: unknown) => validateReturnTo(raw, SITE, PATH);

describe("accepted values are rebuilt, never echoed", () => {
  it.each([
    ["https://techytree.in/projects/?project=12", "https://techytree.in/projects/?project=12"],
    ["/projects/?project=12", "https://techytree.in/projects/?project=12"],
    ["https://techytree.in/projects?project=7", "https://techytree.in/projects/?project=7"], // no trailing slash
    ["https://TECHYTREE.IN/projects/?project=7", "https://techytree.in/projects/?project=7"], // host is case-insensitive
    ["https://techytree.in:443/projects/?project=9", "https://techytree.in/projects/?project=9"], // default port
    ["https://techytree.in/projects/?project=2147483647", "https://techytree.in/projects/?project=2147483647"],
    ["https://techytree.in/projects/?project=1", "https://techytree.in/projects/?project=1"],
  ])("%s", (raw, want) => expect(ok(raw)).toBe(want));
});

describe("open redirects and look-alikes are rejected", () => {
  const P = "/projects/?project=1";
  // each entry: [the value under test, (unused label)]
  const rejected: Array<[string, string]> = [
    // other hosts
    ["https://evil.com", "https://evil.com"],
    ["https://evil.com/projects/?project=1", "https://evil.com" + P],
    ["http://evil.com/projects/?project=1", "http://evil.com" + P],
    // protocol-relative
    ["//evil.com", "//evil.com"],
    ["//evil.com/projects/?project=1", "//evil.com" + P],
    ["///evil.com", "///evil.com"],
    ["////evil.com/projects/", "////evil.com/projects/"],
    // backslashes (browsers treat them as slashes)
    ["\\/\\/evil.com", "\\/\\/evil.com"],
    ["/\\evil.com", "/\\evil.com"],
    ["/\\/evil.com", "/\\/evil.com"],
    ["\\\\evil.com", "\\\\evil.com"],
    ["https:\\\\evil.com\\projects\\?project=1", "https:\\\\evil.com\\projects\\?project=1"],
    ["https://techytree.in\\@evil.com/projects/?project=1", "https://techytree.in\\@evil.com/projects/?project=1"],
    ["/projects\\?project=1", "/projects\\?project=1"],
    // percent-encoded and double-encoded
    ["%2F%2Fevil.com", "%2F%2Fevil.com"],
    ["/%2Fevil.com", "/%2Fevil.com"],
    ["%5C%5Cevil.com", "%5C%5Cevil.com"],
    ["/%5Cevil.com", "/%5Cevil.com"],
    ["%252F%252Fevil.com", "%252F%252Fevil.com"],
    ["https%3A%2F%2Fevil.com", "https%3A%2F%2Fevil.com"],
    ["https://techytree.in/projects/%2e%2e/?project=1", "https://techytree.in/projects/%2e%2e/?project=1"],
    ["https://techytree.in/projects/?project=%31", "https://techytree.in/projects/?project=%31"],
    ["https://techytree.in/projects/?project=1%00", "https://techytree.in/projects/?project=1%00"],
    // dangerous schemes
    ["javascript:alert(1)", "javascript:alert(1)"],
    ["JaVaScRiPt:alert(1)", "JaVaScRiPt:alert(1)"],
    ["javascript://techytree.in/projects/?project=1%0aalert(1)", "javascript://techytree.in/projects/?project=1%0aalert(1)"],
    ["data:text/html,<script>alert(1)</script>", "data:text/html,<script>alert(1)</script>"],
    ["vbscript:msgbox(1)", "vbscript:msgbox(1)"],
    ["file:///etc/passwd", "file:///etc/passwd"],
    ["ftp://techytree.in/projects/?project=1", "ftp://techytree.in/projects/?project=1"],
    ["https:evil.com", "https:evil.com"],
    ["https:/evil.com", "https:/evil.com"],
    // user-info tricks
    ["https://techytree.in@evil.com/projects/?project=1", "https://techytree.in@evil.com/projects/?project=1"],
    ["https://techytree.in:pass@evil.com/projects/?project=1", "https://techytree.in:pass@evil.com/projects/?project=1"],
    ["https://user:pw@techytree.in/projects/?project=1", "https://user:pw@techytree.in/projects/?project=1"], // right host, but user-info
    ["https://techytree.in%40evil.com/projects/?project=1", "https://techytree.in%40evil.com/projects/?project=1"],
    // look-alike hosts
    ["https://techytree.in.evil.com/projects/?project=1", "https://techytree.in.evil.com/projects/?project=1"],
    ["https://evil.com/techytree.in/projects/?project=1", "https://evil.com/techytree.in/projects/?project=1"],
    ["https://eviltechytree.in/projects/?project=1", "https://eviltechytree.in/projects/?project=1"],
    ["https://techytree.in.evil.com", "https://techytree.in.evil.com"],
    ["https://www.techytree.in/projects/?project=1", "https://www.techytree.in/projects/?project=1"], // only the configured origin
    ["https://app.techytree.in/projects/?project=1", "https://app.techytree.in/projects/?project=1"],
    ["https://techytree.in:8443/projects/?project=1", "https://techytree.in:8443/projects/?project=1"],
    ["http://techytree.in/projects/?project=1", "http://techytree.in/projects/?project=1"], // wrong scheme
    ["https://techytree.in./projects/?project=1", "https://techytree.in./projects/?project=1"],
    ["https://xn--techytree-b8k.in/projects/?project=1", "https://xn--techytree-b8k.in/projects/?project=1"],
    ["https://techуtree.in/projects/?project=1", "https://techуtree.in/projects/?project=1"], // Cyrillic "у"
    ["https://techytree。in/projects/?project=1", ""], // ideographic full stop (U+3002) instead of a dot
    // whitespace and control characters
    [" https://techytree.in/projects/?project=1", " https://techytree.in/projects/?project=1"],
    ["https://techytree.in/projects/?project=1 ", "https://techytree.in/projects/?project=1 "],
    ["\thttps://techytree.in/projects/?project=1", "\thttps://techytree.in/projects/?project=1"],
    ["https://tech\nytree.in/projects/?project=1", "https://tech\nytree.in/projects/?project=1"],
    ["https://techytree.in/proj\tects/?project=1", "https://techytree.in/proj\tects/?project=1"],
    ["https://techytree.in/projects/?project=1\r\nSet-Cookie: a=b", "x"],
    ["https://techytree.in/projects/?project=1\0", "https://techytree.in/projects/?project=1\0"],
    ["/\t/evil.com", "/\t/evil.com"],
    ["/\n/evil.com", "/\n/evil.com"],
    ["\u0001https://techytree.in/projects/?project=1", "\u0001https://techytree.in/projects/?project=1"],
    [" /projects/?project=1", " /projects/?project=1"],
    [" /projects/?project=1", " /projects/?project=1"],
    ["​https://techytree.in/projects/?project=1", "​https://techytree.in/projects/?project=1"],
    // a fragment
    ["https://techytree.in/projects/?project=1#evil", "x"],
    ["https://techytree.in/projects/?project=1#", "x"],
  ];
  it.each(rejected.map(([raw]) => raw))("rejects %j", (raw) => expect(ok(raw)).toBeNull());

  it("rejects non-strings and absurd lengths", () => {
    for (const v of [undefined, null, 123, true, {}, [], ["/projects/?project=1"], () => "x", Symbol("x")]) expect(ok(v)).toBeNull();
    expect(ok("")).toBeNull();
    expect(ok("https://techytree.in/projects/?project=1&" + "a=".repeat(200))).toBeNull();
    expect(ok("/projects/?project=" + "1".repeat(300))).toBeNull();
  });
});

describe("only the Projects page, only with a positive integer project", () => {
  const base = "https://techytree.in/projects/";
  it.each(["abc", "-1", "+1", "0", "00", "012", "1.5", "1e3", "0x10", "1 2", "", " ", "NaN", "null", "undefined", "99999999999", "2147483648", "１２", "١٢", "1,2", "1;2", "true"])(
    "project=%j is rejected",
    (v) => expect(ok(`${base}?project=${v}`)).toBeNull(),
  );
  it.each([
    [base, "no query at all"],
    [base + "?", "empty query"],
    [base + "?x=1", "no project parameter"],
    [base + "?Project=1", "wrong case"],
    [base + "?project=1&project=2", "repeated project"],
    [base + "?project=1&x=2", "extra parameter"],
    [base + "?x=2&project=1", "extra parameter first"],
    [base + "?project[]=1", "array syntax"],
    [base + "?project", "no value"],
    ["https://techytree.in/?project=1", "site root"],
    ["https://techytree.in/projects/x/?project=1", "deeper path"],
    ["https://techytree.in/projects/../admin/?project=1", "dot segments"],
    ["https://techytree.in/projectsx/?project=1", "longer first segment"],
    ["https://techytree.in/other/?project=1", "another page"],
    ["https://techytree.in/wp-admin/?project=1", "wp-admin"],
    ["https://techytree.in/Projects/?project=1", "wrong case path"],
    ["/projects/?project=1&redirect=https://evil.com", "redirect smuggled in the query"],
    ["/?project=1", "root"],
    ["projects/?project=1", "relative path"],
    ["./projects/?project=1", "dot-relative path"],
    ["?project=1", "query only"],
  ])("%s (%s) is rejected", (raw) => expect(ok(raw)).toBeNull());

  it("the result is always built from site origin + fixed path + digits, whatever went in", () => {
    const inputs = ["/projects/?project=5", "https://techytree.in/projects?project=5", "https://TechyTree.IN:443/projects/?project=5"];
    for (const i of inputs) expect(ok(i)).toMatch(/^https:\/\/techytree\.in\/projects\/\?project=[1-9][0-9]*$/);
  });
});

describe("configuration (SITE_URL / PROJECTS_RETURN_PATH)", () => {
  const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

  it("defaults to the live site and /projects/", () => {
    expect(projectsReturnPath(env({}))).toBe("/projects/");
    expect(resolveReturnTo("/projects/?project=3", env({}))).toBe("https://techytree.in/projects/?project=3");
  });

  it("follows SITE_URL and PROJECTS_RETURN_PATH, and accepts nothing from the default site then", () => {
    const e = env({ SITE_URL: "http://localhost:8080/", PROJECTS_RETURN_PATH: "/explore-projects" });
    expect(projectsReturnPath(e)).toBe("/explore-projects/");
    expect(resolveReturnTo("http://localhost:8080/explore-projects/?project=4", e)).toBe("http://localhost:8080/explore-projects/?project=4");
    expect(resolveReturnTo("/explore-projects?project=4", e)).toBe("http://localhost:8080/explore-projects/?project=4");
    expect(resolveReturnTo("https://techytree.in/explore-projects/?project=4", e)).toBeNull();
    expect(resolveReturnTo("http://localhost:8080/projects/?project=4", e)).toBeNull();
    expect(resolveReturnTo("http://localhost:3000/explore-projects/?project=4", e)).toBeNull(); // the app's own origin is not the site
  });

  it.each(["//evil.com", "http://evil.com/x", "/a b", "/..", "/a//b", "projects", "/projects?x", "/p#x", "/pro\\jects", "javascript:1", "/%2e%2e/", ""])(
    "an invalid PROJECTS_RETURN_PATH (%j) falls back to /projects/",
    (p) => expect(projectsReturnPath(env({ PROJECTS_RETURN_PATH: p }))).toBe("/projects/"),
  );

  it("an unusable SITE_URL falls back to the live site (so nothing is accepted for another host)", () => {
    for (const s of ["javascript:alert(1)", "not a url", "ftp://x.example/", "  "]) {
      expect(siteUrl(env({ SITE_URL: s }))).toBe("https://techytree.in/");
      expect(resolveReturnTo("https://evil.com/projects/?project=1", env({ SITE_URL: s }))).toBeNull();
    }
  });

  it("is deterministic and never throws on hostile input", () => {
    const hostile = ["\u0000", "%", "%%%", "\uD800", "a".repeat(5000), "https://[::1", "https://techytree.in:99999/projects/?project=1", "http://[evil]/", "https://techytree.in/projects/?project=1\u0085"];
    for (const h of hostile) expect(() => resolveReturnTo(h)).not.toThrow();
    for (const h of hostile) expect(resolveReturnTo(h)).toBeNull();
  });

  it("every non-null result is on the configured origin and path, for a large pile of generated inputs", () => {
    const parts = ["https://techytree.in", "https://evil.com", "//evil.com", "", "/", "\\", "%2F", "@", ".", "..", ":", "projects", "projects/", "?project=1", "?project=a", "&", "#", "x", " ", "\t", "/projects/"];
    let accepted = 0;
    for (const a of parts) for (const b of parts) for (const c of parts) {
      const r = ok(a + b + c);
      if (r !== null) { accepted++; expect(r).toMatch(/^https:\/\/techytree\.in\/projects\/\?project=[1-9][0-9]{0,9}$/); }
    }
    expect(accepted).toBeGreaterThan(0); // the generator does hit valid shapes, so the assertion above is not vacuous
  });
});
