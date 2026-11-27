// @vitest-environment jsdom
// The "My Contributions" screen (public/cw/js/mine.js), the same module in every portal and in the demo: the columns, filters by status
// and sector, the empty state with a way to contribute, View for every item, and NO Edit for a new-workflow idea (only the note).
import { beforeEach, describe, expect, it } from "vitest";
import { mount, NEW_IDEA_NOTE } from "../public/cw/js/mine.js";

const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
const ITEMS = [
  { code: "RV-1025", source: "workflow", title: "Milking robot alert", description: "Texts the farmer.", sector: "agriculture-dairy", sectorName: "Agriculture & Dairy", field: "Milking robots", type: "New idea", submittedAt: "2026-11-20T10:00:00Z", publishedAt: null, status: "pending", statusLabel: "Pending", feedback: "", editUrl: "" },
  { code: "RV-1026", source: "workflow", title: "Homework robot", description: "Writes homework.", sector: "education", sectorName: "Education", field: "", type: "New idea", submittedAt: "2026-11-19T10:00:00Z", publishedAt: null, status: "rejected", statusLabel: "Rejected", feedback: "Not a contribution.", editUrl: "" },
  { code: "C-301", source: "form", title: "Kit lending library", description: "Borrow kits.", sector: "education", sectorName: "Education", field: "", type: "Share an idea", submittedAt: "2026-11-18T10:00:00Z", publishedAt: null, status: "pending", statusLabel: "Pending", feedback: "Please add the kit names.", editUrl: "https://site.example/your-contributions/" },
];
let el: HTMLElement;
const open = async (items = ITEMS) => {
  document.body.innerHTML = '<div id="m"></div>';
  el = document.getElementById("m")!;
  await mount(el, { adapter: { mine: async () => ({ items, contributeUrl: "https://site.example/contribute-now/" }) } });
  await settle();
};
const rows = () => Array.from(el.querySelectorAll(".rv-mine-table tbody tr:not(.rv-mine-detail)"));
const select = async (f: string, v: string) => { const s = el.querySelector(`[data-f="${f}"]`) as HTMLSelectElement; s.value = v; s.dispatchEvent(new Event("change")); await settle(); };

beforeEach(() => { document.body.innerHTML = ""; });

describe("My Contributions", () => {
  it("lists my items with the columns asked for: Title, Sector, Field, Type, Submitted, Status, Moderator feedback, Actions", async () => {
    await open();
    expect(Array.from(el.querySelectorAll("thead th")).map((t) => t.textContent)).toEqual(["Title", "Sector", "Field", "Type", "Submitted", "Status", "Moderator feedback", "Actions"]);
    expect(rows()).toHaveLength(3);
    expect(el.textContent).toContain("Not a contribution.");
  });
  it("a new-workflow idea: View only, with the note; a pending item from the current form keeps its Edit", async () => {
    await open();
    const [wf, , form] = rows();
    expect(wf.querySelector('a[href]')).toBeNull(); // no Edit for a submitted idea
    expect(wf.textContent).toContain(NEW_IDEA_NOTE);
    expect(NEW_IDEA_NOTE).toBe("Submitted ideas can't be edited. A Moderator may refine it during review.");
    expect((form.querySelector("a") as HTMLAnchorElement).textContent).toBe("Edit");
    expect((form.querySelector("a") as HTMLAnchorElement).getAttribute("href")).toBe("https://site.example/your-contributions/");
    (wf.querySelector("[data-view]") as HTMLButtonElement).click(); await settle();
    expect(el.querySelector(".rv-mine-detail")!.textContent).toContain("Texts the farmer.");
  });
  it("filters by status and by sector, and says when nothing matches", async () => {
    await open();
    await select("status", "rejected");
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining("Homework robot")]);
    await select("status", "");
    await select("sector", "education");
    expect(rows()).toHaveLength(2);
    await select("status", "published");
    expect(el.textContent).toContain("Nothing matches these filters.");
    (el.querySelector("[data-clear]") as HTMLButtonElement).click(); await settle();
    expect(rows()).toHaveLength(3);
  });
  it("empty: says so, with a link to contribute", async () => {
    await open([]);
    expect(el.textContent).toContain("You have not contributed anything yet.");
    expect((el.querySelector(".cw-notice a") as HTMLAnchorElement).getAttribute("href")).toBe("https://site.example/contribute-now/");
  });
});
