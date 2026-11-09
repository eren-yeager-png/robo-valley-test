// "Return to the Contribute page after sign-in": hostile input must never produce a redirect anywhere else.
import { describe, expect, it } from "vitest";
import { validateContributeReturn } from "../src/lib/contributeReturnTo";
import { contributeReturnPath, resolveReturnTo } from "../src/lib/session";

const SITE = "https://techytree.in/", PATH = "/contribute-now/";
const v = (raw: unknown) => validateContributeReturn(raw, SITE, PATH);

describe("accepted", () => {
  it.each([
    ["https://techytree.in/contribute-now/", "https://techytree.in/contribute-now/"],
    ["https://techytree.in/contribute-now", "https://techytree.in/contribute-now/"],
    ["/contribute-now/", "https://techytree.in/contribute-now/"],
    ["/contribute-now/?sector=agriculture-dairy", "https://techytree.in/contribute-now/?sector=agriculture-dairy"],
    ["https://techytree.in/contribute-now/?sector=agriculture-dairy,education", "https://techytree.in/contribute-now/?sector=agriculture-dairy,education"],
  ])("%s", (raw, want) => expect(v(raw)).toBe(want));
});

describe("rejected (null)", () => {
  it.each([
    "https://evil.example/contribute-now/", "//evil.example/contribute-now/", "/\\evil.example", "https://techytree.in.evil.example/contribute-now/",
    "https://user:pw@techytree.in/contribute-now/", "javascript:alert(1)", "data:text/html,x", "/contribute-now/#x", "/contribute-now/?",
    "/contribute-now/?sector=", "/contribute-now/?sector=A", "/contribute-now/?sector=a--b", "/contribute-now/?sector=-a", "/contribute-now/?sector=a,a",
    "/contribute-now/?sector=a&x=1", "/contribute-now/?x=1", "/contribute-now/?sector=a&sector=b", "/contribute-now/?sector=%61", "/contribute-now/../admin/",
    "/contribute-now/./", "/other/", "/contribute-now/x/", "/contribute-now/?sector=a b", "/contribute-now/\n", "", "x", "http://techytree.in/contribute-now/",
    "/contribute-now/?sector=" + "a".repeat(61), "/contribute-now/?sector=" + Array.from({ length: 21 }, (_, i) => "s" + i).join(","),
    "/contribute-now/?" + "x".repeat(800),
  ])("%j", (raw) => expect(v(raw)).toBeNull());
  it.each([null, undefined, 5, {}, [], ["/contribute-now/"]])("not a string: %j", (raw) => expect(v(raw)).toBeNull());
  it("the result is rebuilt, never the caller's own string", () => {
    expect(v("HTTPS://TECHYTREE.IN/contribute-now/?sector=a")).toBe("https://techytree.in/contribute-now/?sector=a");
  });
});

describe("with the Projects page and the site settings", () => {
  it("resolveReturnTo accepts both pages and nothing else", () => {
    const env = { SITE_URL: "https://techytree.in/" } as unknown as NodeJS.ProcessEnv;
    expect(resolveReturnTo("/contribute-now/?sector=education", env)).toBe("https://techytree.in/contribute-now/?sector=education");
    expect(resolveReturnTo("/projects/", env)).toBe("https://techytree.in/projects/");
    expect(resolveReturnTo("https://evil.example/", env)).toBeNull();
  });
  it("CONTRIBUTE_RETURN_PATH changes the page, a bad value falls back to the default", () => {
    expect(contributeReturnPath({ CONTRIBUTE_RETURN_PATH: "/share/" } as unknown as NodeJS.ProcessEnv)).toBe("/share/");
    expect(contributeReturnPath({ CONTRIBUTE_RETURN_PATH: "//evil" } as unknown as NodeJS.ProcessEnv)).toBe("/contribute-now/");
    expect(contributeReturnPath({} as unknown as NodeJS.ProcessEnv)).toBe("/contribute-now/");
    expect(resolveReturnTo("/share/", { SITE_URL: SITE, CONTRIBUTE_RETURN_PATH: "/share/" } as unknown as NodeJS.ProcessEnv)).toBe("https://techytree.in/share/");
  });
});

describe("returning to the Contribution (v2) plugin pages after sign-in", () => {
  const env = { SITE_URL: "https://techytree.in/" } as unknown as NodeJS.ProcessEnv;
  it("accepts the plugin's two default pages, with or without a sector", () => {
    expect(resolveReturnTo("https://techytree.in/contribution/", env)).toBe("https://techytree.in/contribution/");
    expect(resolveReturnTo("https://techytree.in/contributor", env)).toBe("https://techytree.in/contributor/");
    expect(resolveReturnTo("/contribution/?sector=agriculture-dairy", env)).toBe("https://techytree.in/contribution/?sector=agriculture-dairy");
  });
  it("still rejects everything hostile, other hosts, other pages and the Contact page", () => {
    for (const bad of ["https://evil.example/contribution/", "//evil.example/contribution/", "/contribution/../admin/", "/contribution/x", "/contact-us/", "/contact/", "/contribution/#x", "javascript:alert(1)", "/contribution/?next=http://evil.example"]) expect(resolveReturnTo(bad, env), bad).toBeNull();
  });
  it("CONTRIBUTION_PAGE_PATHS replaces the list; bad entries are ignored and an empty or bad list falls back", async () => {
    const { contributionPagePaths } = await import("../src/lib/session");
    expect(contributionPagePaths({} as never)).toEqual(["/contribution/", "/contributor/"]);
    expect(contributionPagePaths({ CONTRIBUTION_PAGE_PATHS: "/give, /members/ , //evil, /, https://x.test/y" } as never)).toEqual(["/give/", "/members/"]);
    expect(contributionPagePaths({ CONTRIBUTION_PAGE_PATHS: "//evil,/" } as never)).toEqual(["/contribution/", "/contributor/"]);
    expect(resolveReturnTo("/give/", { SITE_URL: "https://techytree.in/", CONTRIBUTION_PAGE_PATHS: "/give" } as never)).toBe("https://techytree.in/give/");
    expect(resolveReturnTo("/contribution/", { SITE_URL: "https://techytree.in/", CONTRIBUTION_PAGE_PATHS: "/give" } as never)).toBeNull();
  });
});
