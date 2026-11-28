// The standalone demo (docs/reference/contribution_demo.html) really runs: it is loaded in a scripted DOM exactly as a browser would open
// the file, then EVERY role (Visitor, Student, Teacher, Parent, Contributor, Moderator, Admin) and every page of its navigation is opened
// in turn. Each page shows sample data (no empty page), "My Contributions" is in every portal except the Admin's, every sector panel
// has its "+ Contribute to this sector" button and a Contribute button on every field, the Moderator's and the Admin's pages sit in the
// one-column "adm rvd-adm" container with the shared sector grid, and the workflow (approve, publish) works from end to end.
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const settle = (w: Window) => new Promise<void>((r) => { let i = 0; const tick = () => (++i > 40 ? r() : w.setTimeout(tick, 0)); tick(); });
const HTML = () => readFileSync("docs/reference/contribution_demo.html", "utf8");
function open() {
  const errors: string[] = [];
  const dom = new JSDOM(HTML(), {
    runScripts: "dangerously", pretendToBeVisual: true, url: "file:///contribution_demo.html",
    beforeParse(w) { w.addEventListener("error", (e) => errors.push(String((e as ErrorEvent).message))); (w as any).console.error = (...a: unknown[]) => errors.push(a.join(" ")); },
  });
  const w = dom.window as unknown as Window, d = w.document;
  const click = async (sel: string) => { const el = d.querySelector(sel) as HTMLElement | null; if (!el) throw new Error(`not found: ${sel}`); el.click(); await settle(w); };
  const go = async (role: string, page: string) => { await click(`[data-role="${role}"]`); await click(`.rvd-nav [data-page="${page}"]`); };
  return { dom, w, d, errors, click, go };
}

describe("the standalone demo", () => {
  it("every role and every page of its navigation renders with sample data, with no script error", async () => {
    const { dom, w, d, errors, click } = open();
    await settle(w);
    const roles = Array.from(d.querySelectorAll<HTMLButtonElement>("[data-role]")).map((b) => b.getAttribute("data-role")!);
    expect(roles).toEqual(["visitor", "student", "teacher", "parent", "contributor", "moderator", "admin"]);
    const visited: string[] = [];
    for (const role of roles) {
      await click(`[data-role="${role}"]`);
      const labels = Array.from(d.querySelectorAll(".rvd-nav a")).map((a) => a.textContent!.trim());
      expect(new Set(labels).size, `${role}: one sidebar item per page`).toBe(labels.length);
      if (role === "admin") {
        expect(labels).toEqual(["Overview", "Publish Requests", "Sector Forms", "Sectors", "Users & Roles", "Community Ideas", "Audit Log"]);
      } else expect(labels, role).toContain("My Contributions");
      if (role === "moderator") expect(labels).toEqual(["Moderation", "My Contributions"]);
      if (role === "contributor") expect(labels).toEqual(["Dashboard", "Sectors", "My Contributions"]);
      const pages = Array.from(d.querySelectorAll<HTMLAnchorElement>(".rvd-nav [data-page]")).map((a) => a.getAttribute("data-page")!);
      for (const page of pages) {
        await click(`.rvd-nav [data-page="${page}"]`);
        const main = d.querySelector("[data-main]") as HTMLElement;
        expect(main.textContent!.trim().length, `${role}/${page} is not empty`).toBeGreaterThan(40);
        expect(main.textContent, `${role}/${page}`).not.toMatch(/Nothing here\.$|could not be loaded/);
        expect(d.querySelector(`.rvd-nav [data-page="${page}"]`)!.getAttribute("aria-current"), `${role}/${page} highlighted`).toBe("page");
        if (role === "moderator" || role === "admin") expect(main.querySelector(".adm.rvd-adm"), `${role}/${page} in the one-column container`).not.toBeNull();
        visited.push(`${role}/${page}`);
      }
    }
    expect(visited.length).toBeGreaterThan(35);
    expect(errors).toEqual([]);
    dom.window.close();
  }, 120_000); // about 40 pages, one after the other

  it("the A1 rule, the shared sector grid (rounded buttons, never pills) and the page layout", async () => {
    const html = HTML();
    expect(html).toMatch(/\.adm\.rvd-adm, \.rv \.adm\.rvd-adm \{\s*display: flex;\s*flex-direction: column;\s*gap: 24px;\s*min-width: 0;\s*width: 100%;/);
    expect(html).toMatch(/\.adm\.rvd-adm > \* \{ min-width: 0; \}/);
    expect(html).not.toMatch(/rvd-pill/);
    expect(html).toMatch(/\.rv-sg \{ display: grid; grid-template-columns: repeat\(auto-fill, minmax\(200px, 1fr\)\);[^}]*gap: 16px; align-items: stretch;/);
    expect(html).toMatch(/@media \(max-width: 599\.98px\) \{ \.rv-sg \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \} \}/);
    expect(html).toMatch(/@media \(max-width: 379\.98px\) \{ \.rv-sg \{ grid-template-columns: minmax\(0, 1fr\); \} \}/);
    expect(html).toMatch(/\.rv-sg-card \{[^}]*border-radius: 16px;/);
    const { dom, w, d, go } = open();
    await settle(w);
    for (const [role, page] of [["moderator", "moderation"], ["admin", "requests"], ["admin", "sector-forms"], ["admin", "overview"], ["admin", "sectors-admin"], ["student", "sectors"], ["parent", "sectors"], ["contributor", "sectors"], ["visitor", "sector"]]) {
      await go(role, page);
      const cards = Array.from(d.querySelectorAll("[data-main] .rv-sg .rv-sg-card"));
      expect(cards.length, `${role}/${page}`).toBeGreaterThanOrEqual(5);
      for (const c of cards) { expect(c.tagName).toBe("BUTTON"); expect(["true", "false"]).toContain(c.getAttribute("aria-pressed")); }
      const main = d.querySelector("[data-main] .rv-pp") as HTMLElement;
      const order = Array.from(main.children).map((c) => (c.matches(".rv-pp-head") ? "head" : c.matches(".rv-sg, .rv-pp-block") || c.querySelector(".rv-sg") ? "grid" : c.matches(".rv-pp-panel, .rv-pp-stats") ? "panel" : "other"));
      expect(order.indexOf("head"), `${role}/${page} header first`).toBe(0);
      expect(order.indexOf("grid"), `${role}/${page} grid after the header`).toBeGreaterThan(0);
    }
    dom.window.close();
  }, 60_000);

  it("every sector panel has its header button and a Contribute button on every field (and the website page keeps its own)", async () => {
    const { dom, w, d, go, click } = open();
    await settle(w);
    await go("visitor", "sector");
    expect(d.querySelectorAll("[data-main] .rv-pp-panel .rv-contribute-btn--header")).toHaveLength(1);
    const fieldsWithout = () => Array.from(d.querySelectorAll("[data-main] .rv-pp-fieldcard")).filter((f) => !f.querySelector("a[href], button[data-quick]")).length;
    expect(d.querySelectorAll("[data-main] .rv-pp-fieldcard").length).toBeGreaterThanOrEqual(3);
    expect(fieldsWithout()).toBe(0);
    await click("[data-main] [data-sector-page]"); // the page as the website draws it, with the plugin's buttons
    expect(d.querySelectorAll("[data-main] .rv-contribute-btn--header")).toHaveLength(1);
    const wp = Array.from(d.querySelectorAll("[data-main] [data-rv-field-id]"));
    expect(wp.length).toBeGreaterThanOrEqual(5);
    expect(wp.filter((f) => !f.querySelector(":scope > .rv-contribute-field .rv-contribute-btn--field[href]"))).toHaveLength(0);
    for (const role of ["student", "teacher", "parent", "contributor"]) {
      await go(role, "sectors");
      await click("[data-main] .rv-sg [data-sector]:not([aria-pressed=true])");
      expect(d.querySelectorAll("[data-main] .rv-pp-panel .rv-contribute-btn--header"), role).toHaveLength(1);
      expect(fieldsWithout(), role).toBe(0);
    }
    await go("moderator", "moderation");
    expect(d.querySelectorAll("[data-main] .rv-pp-panel__head .rv-contribute-btn--header")).toHaveLength(1);
    await go("admin", "sector-forms");
    expect(d.querySelectorAll("[data-main] .rv-pp-panel__head .rv-contribute-btn--header")).toHaveLength(1);
    expect(d.querySelectorAll("[data-main] tr[data-field] .rv-field-contribute").length).toBe(d.querySelectorAll("[data-main] tr[data-field]").length);
    dom.window.close();
  }, 60_000);

  it("\"Suggest a field\" approved by the Admin appears on the sector page with its button", async () => {
    const { dom, w, d, go, click } = open();
    await settle(w);
    await go("admin", "sector-forms");
    await click('[data-main] [data-sector="manufacturing"]');
    expect(d.querySelector('[data-main] [data-tab="suggested"] .rv-pp-tab__n--amber')!.textContent).toBe("1");
    await click('[data-main] [data-tab="suggested"]');
    await click("[data-main] [data-approve]"); // "Inspection cameras"
    expect(d.querySelector("[data-main] .rv-pp-empty")!.textContent).toMatch(/No suggestions waiting for this sector/);
    await click('[data-main] [data-tab="fields"]');
    const row = Array.from(d.querySelectorAll("[data-main] tr[data-field]")).find((r) => r.textContent!.includes("Inspection cameras"))!;
    expect(row.querySelector(".rv-pp-src--member")!.textContent).toBe("Suggested by member");
    await go("visitor", "sector");
    await click('[data-main] [data-sector="manufacturing"]');
    const card = Array.from(d.querySelectorAll("[data-main] .rv-pp-fieldcard")).find((c) => c.textContent!.includes("Inspection cameras"));
    expect(card && card.querySelector("a[href]")).toBeTruthy();
    await click("[data-main] [data-sector-page]");
    const f = d.querySelector('[data-main] [data-rv-field-id="inspection-cameras"]');
    expect(f).not.toBeNull();
    expect(f!.querySelector(".rv-contribute-btn--field")).not.toBeNull();
    dom.window.close();
  }, 60_000);

  it("Moderation approves as-is (the idea goes to Publish Requests), Reject needs a reason, and the Admin publishes from the preview", async () => {
    const { dom, w, d, go, click } = open();
    await settle(w);
    await go("moderator", "moderation");
    await click('[data-main] [data-tab="pending"]');
    const approve = d.querySelector('[data-main] [data-act="approve"][data-key^="w-"]') as HTMLButtonElement;
    expect(approve).not.toBeNull();
    const key = approve.getAttribute("data-key")!;
    const title = d.querySelector(`[data-main] tr[data-row="${key}"] b`)!.textContent!;
    approve.click(); await settle(w);
    const drawer = d.querySelector(".rv-pp-drawer");
    if (drawer) { // an idea without a category cannot be sent as it is: the editor opens with the reason; pick one, then approve
      expect(drawer.querySelector("[data-msg]")!.textContent).toMatch(/category/i);
      (drawer.querySelector('input[name="cw-m-cat"]') as HTMLInputElement).click();
      (drawer.querySelector('[data-act="send"]') as HTMLButtonElement).click(); await settle(w);
      expect(d.querySelector(".rv-pp-drawer")).toBeNull();
    }
    expect(d.querySelector(".rv-pp-toast")!.textContent).toMatch(/Approved and sent to an Admin/);
    await click('[data-main] [data-tab="approved"]');
    expect(d.querySelector(`[data-main] tr[data-row="${key}"] .rv-pp-badge`)!.textContent).toBe("Publish requested");
    // Reject: the dialog's button stays disabled until a reason is typed
    await click('[data-main] [data-tab="pending"]');
    await click('[data-main] [data-act="reject"]');
    const ok = d.querySelector('.rv-dlg [data-x="ok"]') as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    (d.querySelector('.rv-dlg [data-x="cancel"]') as HTMLButtonElement).click(); await settle(w);
    // the Admin: the request is waiting; preview, then publish
    await go("admin", "requests");
    const row = Array.from(d.querySelectorAll("[data-main] tr[data-row]")).find((r) => r.textContent!.includes(title))!;
    expect(row).toBeTruthy();
    (row.querySelector('[data-act="preview"]') as HTMLButtonElement).click(); await settle(w);
    expect(d.querySelector(".cw-modal [data-pv-act='publish']")).not.toBeNull();
    (d.querySelector(".cw-modal [data-pv-act='publish']") as HTMLButtonElement).click();
    await new Promise((r) => w.setTimeout(r, 1200)); await settle(w); // the demo's publish takes a moment, like the real one
    await click('[data-main] [data-tab="published"]');
    expect(Array.from(d.querySelectorAll("[data-main] tr[data-row]")).some((r) => r.textContent!.includes(title))).toBe(true);
    await go("visitor", "ideas");
    expect(d.querySelector("[data-main]")!.textContent).toContain(title);
    dom.window.close();
  }, 60_000);
});
