// The standalone demo (docs/reference/contribution_demo.html) really runs: it is loaded in a scripted DOM exactly as a browser would open
// the file, then EVERY role (Visitor, Student, Teacher, Parent, Contributor, Moderator, Admin) and every page of its navigation is opened
// in turn. Each page shows sample data (no empty page), "My Contributions" is in every portal's navigation, every sector page has its
// header button and a button on every field, and nothing throws.
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const settle = (w: Window) => new Promise<void>((r) => { let i = 0; const tick = () => (++i > 40 ? r() : w.setTimeout(tick, 0)); tick(); });

describe("the standalone demo", () => {
  it("every role and every page of its navigation renders with sample data, with no script error", async () => {
    const errors: string[] = [];
    const dom = new JSDOM(readFileSync("docs/reference/contribution_demo.html", "utf8"), {
      runScripts: "dangerously", pretendToBeVisual: true, url: "file:///contribution_demo.html",
      beforeParse(w) { w.addEventListener("error", (e) => errors.push(String((e as ErrorEvent).message))); (w as any).console.error = (...a: unknown[]) => errors.push(a.join(" ")); },
    });
    const w = dom.window as unknown as Window, d = w.document;
    await settle(w);
    const roles = Array.from(d.querySelectorAll<HTMLButtonElement>("[data-role]")).map((b) => b.getAttribute("data-role")!);
    expect(roles).toEqual(["visitor", "student", "teacher", "parent", "contributor", "moderator", "admin"]);
    const visited: string[] = [];
    for (const role of roles) {
      (d.querySelector(`[data-role="${role}"]`) as HTMLButtonElement).click();
      await settle(w);
      const pages = Array.from(d.querySelectorAll<HTMLAnchorElement>(".rvd-nav [data-page]")).map((a) => a.getAttribute("data-page")!);
      expect(Array.from(d.querySelectorAll(".rvd-nav a")).map((a) => a.textContent), role).toContain("My Contributions"); // every portal
      for (const page of pages) {
        (d.querySelector(`.rvd-nav [data-page="${page}"]`) as HTMLAnchorElement).click();
        await settle(w);
        const main = d.querySelector("[data-main]") as HTMLElement;
        expect(main.textContent!.trim().length, `${role}/${page} is not empty`).toBeGreaterThan(40);
        expect(main.textContent, `${role}/${page}`).not.toMatch(/Nothing here\.$|could not be loaded/);
        expect(d.querySelector(`.rvd-nav [data-page="${page}"]`)!.getAttribute("aria-current"), `${role}/${page} highlighted`).toBe("page");
        visited.push(`${role}/${page}`);
      }
    }
    expect(visited.length).toBeGreaterThan(35);
    expect(errors).toEqual([]);
    dom.window.close();
  }, 120_000); // about 40 pages, one after the other
  it("the sector page in each role: the header button and a button on every field (website, Member portals, reviewer screens)", async () => {
    const dom = new JSDOM(readFileSync("docs/reference/contribution_demo.html", "utf8"), { runScripts: "dangerously", pretendToBeVisual: true, url: "file:///contribution_demo.html" });
    const w = dom.window as unknown as Window, d = w.document;
    await settle(w);
    const go = async (role: string, page: string) => { (d.querySelector(`[data-role="${role}"]`) as HTMLButtonElement).click(); await settle(w); (d.querySelector(`.rvd-nav [data-page="${page}"]`) as HTMLAnchorElement).click(); await settle(w); };
    const fieldsWithout = () => Array.from(d.querySelectorAll("[data-main] [data-rv-field-id]")).filter((f) => !f.querySelector(":scope > .rv-contribute-field .rv-contribute-btn--field[href]")).length;
    await go("visitor", "sector");
    expect(d.querySelectorAll("[data-main] .rv-contribute-btn--header")).toHaveLength(1);
    expect(d.querySelectorAll("[data-main] [data-rv-field-id]").length).toBeGreaterThanOrEqual(5);
    expect(fieldsWithout()).toBe(0);
    for (const role of ["student", "teacher", "parent", "contributor"]) {
      await go(role, "sectors");
      (d.querySelector("[data-main] [data-sector]") as HTMLAnchorElement).click(); await settle(w); // the first sector
      expect(d.querySelectorAll("[data-main] .rv-contribute-btn--header"), role).toHaveLength(1);
      expect(fieldsWithout(), role).toBe(0);
    }
    await go("moderator", "moderation");
    expect(d.querySelectorAll("[data-main] .rv-sector-headbar .rv-contribute-btn--header")).toHaveLength(1);
    await go("admin", "sector-forms");
    expect(d.querySelectorAll("[data-main] .rv-sector-headbar .rv-contribute-btn--header")).toHaveLength(1);
    dom.window.close();
  });
  it("\"Suggest a field\" approved by the Admin appears on the sector page with its button", async () => {
    const dom = new JSDOM(readFileSync("docs/reference/contribution_demo.html", "utf8"), { runScripts: "dangerously", pretendToBeVisual: true, url: "file:///contribution_demo.html" });
    const w = dom.window as unknown as Window, d = w.document;
    await settle(w);
    (d.querySelector('[data-role="admin"]') as HTMLButtonElement).click(); await settle(w);
    (d.querySelector('.rvd-nav [data-page="sector-forms"]') as HTMLAnchorElement).click(); await settle(w);
    (d.querySelector('[data-main] [data-sector="manufacturing"]') as HTMLButtonElement).click(); await settle(w);
    (d.querySelector("[data-main] [data-approve]") as HTMLButtonElement).click(); await settle(w); // "Inspection cameras"
    (d.querySelector('[data-role="visitor"]') as HTMLButtonElement).click(); await settle(w);
    (d.querySelector('.rvd-nav [data-page="sector"]') as HTMLAnchorElement).click(); await settle(w);
    (d.querySelector('[data-main] [data-sector="manufacturing"]') as HTMLButtonElement).click(); await settle(w);
    const f = d.querySelector('[data-main] [data-rv-field-id="inspection-cameras"]');
    expect(f).not.toBeNull();
    expect(f!.querySelector(".rv-contribute-btn--field")).not.toBeNull();
    dom.window.close();
  });
});
