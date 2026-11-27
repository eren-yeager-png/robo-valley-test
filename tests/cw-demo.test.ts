// The standalone demo (docs/reference/contribution_demo.html) really runs: it is loaded in a scripted DOM exactly as a browser would open
// the file, every role tab is shown in turn, and each one renders its screen from the mock data without a script error.
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const settle = (w: Window) => new Promise<void>((r) => { let i = 0; const tick = () => (++i > 30 ? r() : w.setTimeout(tick, 0)); tick(); });

describe("the standalone demo", () => {
  it("every tab renders its screen with the demo data, with no script error", async () => {
    const errors: string[] = [];
    const dom = new JSDOM(readFileSync("docs/reference/contribution_demo.html", "utf8"), {
      runScripts: "dangerously", pretendToBeVisual: true, url: "file:///contribution_demo.html",
      beforeParse(w) { w.addEventListener("error", (e) => errors.push(String((e as ErrorEvent).message))); (w as any).console.error = (...a: unknown[]) => errors.push(a.join(" ")); },
    });
    const w = dom.window as unknown as Window, d = w.document;
    await settle(w);
    const tabs = Array.from(d.querySelectorAll<HTMLButtonElement>("[data-tab]")).map((b) => b.getAttribute("data-tab"));
    expect(tabs[0]).toBe("form");
    const expectText: Record<string, string> = { form: "Share Your Idea", moderator: "Moderator Workspace", admin: "Admin Approval Dashboard", site: "Community Ideas" };
    for (const t of tabs) {
      (d.querySelector(`[data-tab="${t}"]`) as HTMLButtonElement).click();
      await settle(w);
      const view = d.querySelector(`[data-view="${t}"]`) as HTMLElement;
      expect(view.hidden, t!).toBe(false);
      expect(view.textContent, t!).toContain(expectText[t!]);
    }
    if (tabs.includes("moderator")) {
      expect(Number(d.getElementById("c-mod")!.textContent)).toBeGreaterThan(0);
      (d.querySelector('[data-tab="moderator"]') as HTMLButtonElement).click(); await settle(w);
      expect(d.querySelectorAll('[data-view="moderator"] .cw-item').length).toBeGreaterThan(0);
    }
    expect(errors).toEqual([]);
    dom.window.close();
  });
});
