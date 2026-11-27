// Moderation moved to /admin/moderation (A3). Old addresses lead to the same page there; who may open it has not changed.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error("REDIRECT:" + to); } }));
import OldModerationAddress from "../src/app/moderation/[[...path]]/page";
import { ADMIN_NAV, MODERATOR_NAV, titleFor } from "../src/app/admin/_components/nav";

const to = async (path?: string[], query: Record<string, string | string[] | undefined> = {}) => {
  try { await OldModerationAddress({ params: Promise.resolve({ path }), searchParams: Promise.resolve(query) }); } catch (e) { return String((e as Error).message).replace("REDIRECT:", ""); }
  return null;
};

describe("old addresses", () => {
  it("every old page leads to the same page at the new address, with its query", async () => {
    expect(await to()).toBe("/admin/moderation");
    expect(await to([], { item: "12" })).toBe("/admin/moderation?item=12");
    expect(await to(["12"], { from: "agriculture-dairy", tab: "new" })).toBe("/admin/moderation/12?from=agriculture-dairy&tab=new");
    expect(await to(["sector", "agriculture-dairy"], { tab: "all", verified: "1" })).toBe("/admin/moderation/sector/agriculture-dairy?tab=all&verified=1");
    expect(await to(["change-password"])).toBe("/admin/moderation/change-password");
    expect(await to(["sector", "x"], { q: ["a b", "c&d"], empty: undefined })).toBe("/admin/moderation/sector/x?q=a+b&q=c%26d");
  });
  it("never leaves /admin/moderation, whatever the old address holds", async () => {
    for (const path of [["..", "..", "login"], ["%2e%2e", "users"], ["//evil.example"], ["%2F%2Fevil.example"], ["https:", "", "evil.example"], ["a\\b"], ["%E0%A4%A"]]) {
      const target = await to(path);
      expect(target, path.join("/")).toMatch(/^\/admin\/moderation(\/|$)/);
      expect(new URL(target!, "https://app.example/").pathname, path.join("/")).toMatch(/^\/admin\/moderation(\/|$)/);
      expect(new URL(target!, "https://app.example/").origin).toBe("https://app.example");
    }
  });
});

describe("the new address", () => {
  it("is in the sidebar, titled Moderation; a moderator's sidebar holds Moderation and the Moderator Workspace only", () => {
    expect(ADMIN_NAV.find((n) => n.label === "Moderation")?.href).toBe("/admin/moderation");
    expect(ADMIN_NAV.some((n) => n.href.startsWith("/moderation"))).toBe(false);
    expect(titleFor("/admin/moderation/sector/agriculture-dairy")).toBe("Moderation");
    expect(MODERATOR_NAV.map((n) => n.href)).toEqual(["/admin/moderation", "/admin/workspace", "/my-contributions"]);
  });
  it("is outside src/app/admin (administrators only), and every page still runs the unchanged reviewer guard", () => {
    const dir = "src/app/(reviewer)/admin/moderation";
    expect(existsSync("src/app/admin/moderation")).toBe(false);
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
    const pages = walk(dir).filter((f) => /(page|layout)\.tsx$/.test(f));
    expect(pages).toHaveLength(5);
    for (const f of pages) expect(readFileSync(f, "utf8"), f).toMatch(/await requireReviewerPage\(/);
    expect(readFileSync("src/lib/reviewerPage.ts", "utf8")).toContain('if (!r.ok) redirect("/dashboard");');
  });
  it("no page of the app links to the old address any more", () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
    for (const f of walk("src/app").filter((x) => /\.tsx?$/.test(x))) expect(readFileSync(f, "utf8"), f).not.toMatch(/(href|action)=(\{`|")\/moderation|redirect\([`"]\/moderation|replace\("\/moderation/);
  });
});
