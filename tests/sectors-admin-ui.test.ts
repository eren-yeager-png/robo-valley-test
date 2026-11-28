// @vitest-environment jsdom
// Admin > Sectors (public/cw/js/sectors-admin.js), drawn from the same answer /api/admin/sector-counts gives: the sector grid, the
// selected sector's numbers, every sector's table with the two total rows, which numbers are links (to that sector's panel in
// Moderation, on the matching tab), zeros and totals as plain numbers, "No contributions yet", and the actions that wait for Phase B.
import { beforeEach, describe, expect, it } from "vitest";
import { mount, LATER } from "../public/cw/js/sectors-admin.js";

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
const zero = { submitted: 0, verified: 0, changesRequested: 0, published: 0, rejected: 0, unpublished: 0, total: 0 };
const COUNTS = {
  sectors: [
    { slug: "agriculture-dairy", name: "Agriculture & Dairy", active: true, ...zero, submitted: 1, verified: 1, published: 1, total: 3 },
    { slug: "education", name: "Education", active: true, ...zero, submitted: 1, verified: 1, published: 1, rejected: 1, total: 4 },
    { slug: "healthcare", name: "Healthcare", active: false, ...zero, changesRequested: 1, unpublished: 1, total: 2 },
  ],
  sum: { ...zero, submitted: 2, verified: 2, changesRequested: 1, published: 2, rejected: 1, unpublished: 1, total: 9 },
  unique: { ...zero, submitted: 2, verified: 1, changesRequested: 1, published: 1, rejected: 1, unpublished: 1, total: 7 },
};
const SECTORS = [{ slug: "agriculture-dairy", name: "Agriculture & Dairy", robots: [{ slug: "a", name: "A" }, { slug: "b", name: "B" }] }, { slug: "education", name: "Education", robots: [] }, { slug: "healthcare", name: "Healthcare", robots: [] }];
let el: HTMLElement;
const open = async (counts: any = COUNTS, sector = "") => {
  document.body.innerHTML = '<div id="m"></div>';
  el = document.getElementById("m")!;
  await mount(el, { adapter: { sectorCounts: async () => counts, formConfig: async () => ({ sectors: SECTORS }) }, sector, moderationPath: "/admin/moderation" });
  await settle();
};
beforeEach(() => { document.body.innerHTML = ""; });

describe("Sectors", () => {
  it("the grid (n fields · m contributions; not offered marked), the first sector selected, its panel", async () => {
    await open();
    expect(Array.from(el.querySelectorAll(".rv-sg-card .rv-sg-meta")).map((m) => m.textContent)).toEqual(["2 fields · 3 contributions", "0 fields · 4 contributions", "0 fields · 2 contributions"]);
    expect(el.querySelector('.rv-sg-card[data-sector="healthcare"] .rv-sg-chip')!.textContent).toBe("Not on the form");
    expect(el.querySelector(".rv-pp-panel__title")!.textContent).toBe("Sector: Agriculture & Dairy");
    (el.querySelector('.rv-sg-card[data-sector="education"]') as HTMLButtonElement).click(); await settle();
    expect(el.querySelector(".rv-pp-panel__title")!.textContent).toBe("Sector: Education");
    expect(el.querySelector(".rv-pp-panel a[href='/admin/moderation?sector=education&tab=rejected']")!.textContent).toBe("1");
  });
  it("every sector's table: the columns, the two total rows, links only for non-zero sector numbers", async () => {
    await open();
    const table = el.querySelectorAll(".rv-pp-table")[1] as HTMLTableElement;
    expect(Array.from(table.querySelectorAll("thead th")).map((t) => t.textContent)).toEqual(["Sector", "Submitted", "Verified", "Changes requested", "Approved / published", "Rejected", "Unpublished", "Total"]);
    const links = Array.from(table.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(links).toContain("/admin/moderation?sector=education&tab=published");
    expect(links).toContain("/admin/moderation?sector=agriculture-dairy&tab=approved"); // verified -> Moderation's Approved tab
    expect(links).toContain("/admin/moderation?sector=education&tab=pending");
    expect(links).not.toContain("/admin/moderation?sector=agriculture-dairy&tab=rejected"); // a 0 is a plain number
    const totals = Array.from(table.querySelectorAll("tr.rv-pp-sum"));
    expect(totals.map((r) => r.querySelector("th")!.textContent)).toEqual(["Total of the sector rows", "Unique contributions"]);
    expect(totals.every((r) => !r.querySelector("a"))).toBe(true);
    expect(el.textContent).toContain("counted once in each of them");
    expect(el.textContent).toContain("drafts are private to their authors, so they are never counted");
  });
  it("no contributions at all: says so (not an error) and still lists every sector at 0", async () => {
    await open({ sectors: COUNTS.sectors.map((s) => ({ ...s, ...zero })), sum: zero, unique: zero });
    expect(el.textContent).toContain("No contributions yet.");
    expect(el.querySelectorAll(".rv-sg-card")).toHaveLength(3);
    expect(el.querySelectorAll(".rv-pp-table a")).toHaveLength(0);
  });
  it("adding, renaming, reordering and archiving a sector wait for the data update, and say so", async () => {
    await open();
    const buttons = Array.from(el.querySelectorAll(".rv-pp-head .btn, .rv-pp-panel__head .btn")) as HTMLButtonElement[];
    expect(buttons.map((b) => b.textContent)).toEqual(["+ Add sector", "Rename", "Move up", "Move down", "Archive"]);
    expect(buttons.every((b) => b.disabled && b.title === LATER)).toBe(true);
  });
  it("an answer with a message (not set up, not answering) shows that message", async () => {
    document.body.innerHTML = '<div id="m"></div>';
    el = document.getElementById("m")!;
    await mount(el, { adapter: { sectorCounts: async () => { throw Object.assign(new Error("Contributions are not set up on this database yet: the contribution tables come from migrations 012 to 019."), { status: 503 }); }, formConfig: async () => ({ sectors: [] }) } });
    await settle();
    expect(el.querySelector(".cw-n-err")!.textContent).toContain("migrations 012 to 019");
  });
});
