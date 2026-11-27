// @vitest-environment jsdom
// Every Member portal's "Sectors" (public/cw/js/sectors.js): a card for every sector, and one sector drawn with the SAME shared sector
// page component as the website (sector.js). The GUARD: for EVERY sector the page has its header button and no rendered field is without
// its button; a sector or field added later appears by itself.
import { beforeEach, describe, expect, it } from "vitest";
import { mount, fieldsOf } from "../public/cw/js/sectors.js";
import { missingButtons } from "../public/cw/js/fields.js";
import { DEMO_SECTORS } from "../scripts/build-contribution-workflow.mjs";

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 30)); };
let el: HTMLElement, handle: any = null;
const open = async (sectors: any[], slug = "") => {
  handle?.stop?.();
  document.body.innerHTML = '<main><div id="s"></div></main>';
  el = document.getElementById("s")!;
  handle = await mount(el, { adapter: { formConfig: async () => ({ sectors }) }, form: "https://site.example/contribute-now/", slug, returnTo: "https://app.example/dashboard/sectors/x" });
  await settle();
};

beforeEach(() => { handle?.stop?.(); handle = null; document.body.innerHTML = ""; });

describe("the Sectors list", () => {
  it("a card for every sector with a short description and View sector; a new sector appears by itself", async () => {
    await open([...DEMO_SECTORS, { slug: "space-robots", name: "Space robots", robots: [{ slug: "rovers", name: "Rovers" }] }]);
    const cards = Array.from(el.querySelectorAll(".rv-sector-tile"));
    expect(cards.map((c) => c.querySelector("h2")!.textContent)).toEqual([...DEMO_SECTORS.map((s: any) => s.name), "Space robots"]);
    expect((cards[0].querySelector("a") as HTMLAnchorElement).getAttribute("href")).toBe("/dashboard/sectors/agriculture-dairy");
    expect(cards.at(-1)!.textContent).toContain("Robots at work in Space robots");
  });
});

describe("one sector (the same component as the website)", () => {
  it("EVERY sector: the header button with the sector filled in, a button on every field, and + Suggest a field", async () => {
    for (const s of DEMO_SECTORS as any[]) {
      await open(DEMO_SECTORS as any[], s.slug);
      const header = el.querySelectorAll(".rv-contribute-btn--header");
      expect(header, s.slug).toHaveLength(1);
      expect(new URL((header[0] as HTMLAnchorElement).href).searchParams.get("sector")).toBe(s.slug);
      expect(missingButtons(document, { sector: s.slug, root: el }), s.slug).toEqual([]);
      expect(el.querySelectorAll(".rv-contribute-btn--field").length, s.slug).toBe(fieldsOf(s).length);
      expect(el.querySelector(".rv-sector-suggest a")!.textContent).toBe("+ Suggest a field");
      expect(new URL((el.querySelector(".rv-sector-suggest a") as HTMLAnchorElement).href).searchParams.get("kind")).toBe("Suggestion");
    }
  });
  it("the demo's suggested and plugin-added fields, a long address and a wide table (scrolling inside its card)", async () => {
    await open(DEMO_SECTORS as any[], "agriculture-dairy");
    expect(el.querySelector('[data-rv-field-source="suggested"] .rv-contribute-btn--field')).not.toBeNull();
    expect(el.querySelector('[data-rv-field-source="plugin"] .rv-contribute-btn--field')).not.toBeNull();
    expect(el.querySelector("table")!.parentElement!.classList.contains("rv-table-scroll")).toBe(true);
  });
  it("the app's data (no ready-made fields): an About card and one field per robot type from Sector Forms, each with its button", async () => {
    const s = { slug: "healthcare", name: "Healthcare", robots: [{ slug: "pharmacy-robots", name: "Pharmacy robots" }, { slug: "delivery-robots", name: "Delivery robots" }] };
    await open([s], "healthcare");
    expect(Array.from(el.querySelectorAll("[data-rv-field-id]")).map((f) => f.getAttribute("data-rv-field-id"))).toEqual(["about-this-sector", "pharmacy-robots", "delivery-robots"]);
    expect(missingButtons(document, { sector: "healthcare", root: el })).toEqual([]);
    const f = new URL((el.querySelector('[data-rv-field-id="pharmacy-robots"] .rv-contribute-btn--field') as HTMLAnchorElement).href);
    expect([f.searchParams.get("sector"), f.searchParams.get("field")]).toEqual(["healthcare", "pharmacy-robots"]);
  });
  it("an unknown sector says so", async () => {
    await open(DEMO_SECTORS as any[], "no-such-sector");
    expect(el.textContent).toContain("We could not find that sector.");
  });
});
