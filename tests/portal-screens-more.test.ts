// @vitest-environment jsdom
// More of the Contribution Portal's shared screens: Moderation's search, category filter, sort, pages of 20 and the current form's CSV;
// the side drawer (focus moves in, Tab stays inside, Escape closes, focus returns); tabs by keyboard; a toast outliving the screen's
// redraw; "View as" (My Contributions read-only); the Contribute links carrying the sector, the field and the way back.
import { beforeEach, describe, expect, it } from "vitest";
import { mount as moderation, PAGE_SIZE } from "../public/cw/js/moderation.js";
import { mount as mine } from "../public/cw/js/mine.js";
import { mount as sectorForms } from "../public/cw/js/sector-forms.js";
import { bindTabs, openDrawer, tabsHtml, toast } from "../public/cw/js/portal-ui.js";

const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
let el: HTMLElement;
const fresh = () => { document.body.innerHTML = '<button id="before">before</button><div class="rv"><div class="adm rvd-adm"><div id="m"></div></div></div>'; el = document.getElementById("m")!; };
beforeEach(fresh);

/** A Moderation adapter with `n` current-form rows in Education (half of them in the "Robotics" category). */
function adapter(n: number) {
  const rows = Array.from({ length: n }, (_, i) => ({
    key: `f-${i + 1}`, source: "form", id: i + 1, code: `C-${i + 1}`, title: `Idea number ${String(i + 1).padStart(2, "0")}`, contributor: i % 2 ? "Asha R." : "Kiran P.", contributorType: "Teacher",
    status: "pending_review", display: "pending", note: "", sentAt: new Date(Date.UTC(2026, 10, 1 + i)).toISOString(), approvedBy: null, sector: "education", sectorName: "Education",
    categories: i % 2 ? ["Robotics"] : ["Kits"], alsoIn: [], actions: [], viewUrl: `/admin/moderation/${i + 1}?from=education`,
  }));
  return {
    formConfig: async () => ({ sectors: [{ slug: "education", name: "Education", robots: [] }] }),
    portal: async () => ({ view: "moderation", sectors: [{ slug: "education", name: "Education", total: n, pending: n, approved: 0, requested: 0, published: 0, rejected: 0, unpublished: 0 }], sector: { slug: "education", name: "Education" }, rows, fields: [], exportUrl: "/api/review/export?sector=education&tab=all" }),
  };
}
const titles = () => Array.from(el.querySelectorAll("tbody tr b")).map((b) => b.textContent);
const typeIn = async (sel: string, v: string, ev = "input") => { const x = el.querySelector(sel) as HTMLInputElement; x.value = v; x.dispatchEvent(new Event(ev)); await settle(); };

describe("Moderation's list", () => {
  it("pages of 20, newest first; search by title or contributor; the category filter; oldest first", async () => {
    await moderation(el, { adapter: adapter(25), form: "#form" });
    await settle();
    expect(PAGE_SIZE).toBe(20);
    expect(titles()).toHaveLength(20);
    expect(titles()[0]).toBe("Idea number 25");
    expect(el.querySelector(".rv-pp-pager span")!.textContent).toBe("Page 1 of 2 · 25 contributions");
    (el.querySelector('[data-page="2"]') as HTMLButtonElement).click(); await settle();
    expect(titles()).toHaveLength(5);
    await typeIn('[data-f="q"]', "Asha");
    expect(titles().length).toBe(12);
    await typeIn('[data-f="q"]', "");
    await typeIn('[data-f="cat"]', "Robotics", "change");
    expect(titles().length).toBe(12);
    await typeIn('[data-f="sort"]', "old", "change");
    expect(titles()[0]).toBe("Idea number 02");
    expect(el.querySelector('a[download]')!.getAttribute("href")).toBe("/api/review/export?sector=education&tab=all");
  });
  it("the search box keeps the focus while typing (only the list is redrawn)", async () => {
    await moderation(el, { adapter: adapter(3), form: "#form" });
    await settle();
    const box = el.querySelector('[data-f="q"]') as HTMLInputElement;
    box.focus();
    box.value = "Idea number 01"; box.dispatchEvent(new Event("input")); await settle();
    expect(document.activeElement).toBe(box);
    expect(titles()).toEqual(["Idea number 01"]);
  });
  it("the panel's Contribute button opens the live form with the sector and the way back", async () => {
    await moderation(el, { adapter: adapter(1), form: "https://site.example/contribute-now/", returnTo: "https://app.example/admin/moderation?sector=education" });
    await settle();
    const u = new URL((el.querySelector(".rv-pp-panel__head .rv-contribute-btn--header") as HTMLAnchorElement).href);
    expect([u.origin + u.pathname, u.searchParams.get("sector"), u.searchParams.get("return_to")]).toEqual(["https://site.example/contribute-now/", "education", "https://app.example/admin/moderation?sector=education"]);
  });
});

describe("the drawer, the tabs and the toasts", () => {
  it("the drawer is a dialog: focus moves into it, Tab stays inside, Escape closes it and focus goes back", async () => {
    const opener = document.getElementById("before") as HTMLButtonElement;
    opener.focus();
    let closed = 0;
    const dr = openDrawer({ title: "Edit", body: '<input id="a"><button id="b">B</button>', host: el, onClose: () => { closed++; } });
    expect(dr.el.querySelector('[role="dialog"]')!.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement!.id).toBe("a");
    (document.getElementById("b") as HTMLButtonElement).focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement!.getAttribute("data-x")).toBe("close"); // wrapped to the first control (the close button)
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".rv-pp-drawer")).toBeNull();
    expect(closed).toBe(1);
    expect(document.activeElement).toBe(opener);
  });
  it("tabs: role=tab with aria-selected; the arrow keys and Home/End move between them", async () => {
    el.innerHTML = tabsHtml([["a", "One", 1], ["b", "Two", 2, "amber"], ["c", "Three"]], "a");
    const picked: string[] = [];
    bindTabs(el, (k) => picked.push(k));
    const tabs = Array.from(el.querySelectorAll('[role="tab"]')) as HTMLButtonElement[];
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(tabs[1].querySelector(".rv-pp-tab__n--amber")!.textContent).toBe("2");
    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(picked).toEqual(["b", "c", "c"]);
  });
  it("a toast lives outside the screen, so a redraw does not remove it", () => {
    toast(el, "Saved.");
    el.innerHTML = "";
    expect(document.querySelector(".rv-pp-toasts")!.parentElement).toBe(document.body);
    expect(document.querySelector(".rv-pp-toast")!.textContent).toBe("Saved.");
  });
});

describe("View as and the field buttons", () => {
  it("My Contributions read-only (View as): the given list, no Edit, no contribute link", async () => {
    await mine(el, { data: { items: [{ code: "C-1", source: "form", title: "Pending one", sector: "education", sectorName: "Education", field: "", type: "Share an idea", submittedAt: "2026-11-20T10:00:00Z", status: "pending", statusLabel: "Pending", feedback: "", editUrl: "https://site.example/your-contributions/" }] }, readOnly: true, heading: "Meera's contributions" });
    await settle();
    expect(el.querySelector(".rv-pp-title")!.textContent).toBe("Meera's contributions");
    expect(el.querySelector('a[href*="your-contributions"]')).toBeNull();
    expect(el.querySelector(".rv-mine-new")).toBeNull();
  });
  it("Sector Forms: every field's Contribute link carries the sector and the field", async () => {
    await sectorForms(el, {
      adapter: { sectorForms: async () => ({ sectors: [{ slug: "education", name: "Education", active: true, fields: 1, suggestions: 0 }], sector: { slug: "education", name: "Education", active: true },
        fields: [{ id: 7, slug: "lab-robots", name: "Lab robots", active: true, order: 1, source: "admin", pluginName: "", contributions: 3 }], suggestions: [], questionsOn: 2, robotsReady: true }) },
      form: "https://site.example/contribute-now/", returnTo: "https://app.example/admin/sector-forms", questionsPath: "/admin/sector-forms",
    });
    await settle();
    const u = new URL((el.querySelector("tr[data-field] .rv-field-contribute") as HTMLAnchorElement).href);
    expect([u.searchParams.get("sector"), u.searchParams.get("field")]).toEqual(["education", "lab-robots"]);
    expect((el.querySelector("tr[data-field] .btn.danger") as HTMLButtonElement).title).toBe("Can't delete: 3 contributions use this field. Archive it instead.");
    expect(el.querySelector('a[href="/admin/sector-forms/education"]')!.textContent).toBe("Edit the questions");
  });
});
