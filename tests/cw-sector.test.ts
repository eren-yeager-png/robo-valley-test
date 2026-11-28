// @vitest-environment jsdom
// The shared sector page (public/cw/js/sector.js): "+ Contribute to this sector" in the header of every sector page and the button on
// every field, the same component on the website (a theme's page: title + content) and in the app (a page it renders itself). The
// GUARDS: a sector page without its header button, or a rendered field without its button, fails here.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as S from "../public/cw/js/sector.js";
import * as F from "../public/cw/js/fields.js";

const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 40)); };
const OPTS = { sector: "agriculture-dairy", sectorName: "Agriculture and Dairy", form: "https://site.example/contribute-now/", off: [] as string[] };
let handle: { stop: () => void } | null = null;
const headerButtons = () => document.querySelectorAll(".rv-contribute-btn--header");
/** THE GUARD for a whole sector page: exactly one header button, and no rendered field without its own button. */
function assertSectorPage(opts = OPTS) {
  expect(headerButtons(), "the header button").toHaveLength(1);
  const h = new URL((headerButtons()[0] as HTMLAnchorElement).href);
  expect(h.searchParams.get("sector")).toBe(opts.sector);
  expect(F.missingButtons(document, opts), "fields without their button").toEqual([]);
}
const WP_PAGE = `<header class="site-header"><nav class="rv-sector-bar"><a class="rv-pill">Agriculture &amp; Dairy</a><a class="rv-pill rv-suggest">+ Suggest a field</a></nav></header>
<main id="primary" class="site-main"><article class="page type-page">
  <header class="entry-header"><h1 class="entry-title">Agriculture and Dairy</h1></header>
  <div class="entry-content"><div class="rv-fields-root" data-rv-sector="agriculture-dairy">
    <div class="rv-rt"><h3>About this sector</h3><p>A rich-text block.</p><p>https://example.com/averyveryveryveryveryveryveryveryveryveryverylongaddresswithoutanyspaceatallinit/more/more/more</p>
      <table><tr><td>one very long cell without wrapping</td><td>two</td><td>three</td><td>four</td><td>five</td><td>six</td></tr></table></div>
    <section><h2>Drone sprayers</h2><p>x</p></section>
  </div></div></article></main><footer class="site-footer"></footer>`;

beforeEach(() => { document.body.innerHTML = ""; });
afterEach(() => { handle?.stop(); handle = null; });

describe("on the website (a theme's page: its own title and content)", () => {
  it("puts ONE header button next to the title, sticky top-right, and a button on every field; tables scroll inside their card", async () => {
    document.body.innerHTML = WP_PAGE;
    handle = S.startSectorPage(OPTS, document);
    await settle();
    assertSectorPage();
    const article = document.querySelector("article")!, rail = article.firstElementChild!;
    expect(rail.classList.contains("rv-sector-rail")).toBe(true); // the first child: the top-right corner of the article
    expect(article.classList.contains("rv-has-sector-rail")).toBe(true);
    expect(document.querySelector(".entry-header")!.classList.contains("rv-sector-head")).toBe(true);
    expect(document.querySelector("table")!.parentElement!.classList.contains("rv-table-scroll")).toBe(true);
    const back = new URL((headerButtons()[0] as HTMLAnchorElement).href).searchParams.get("return_to");
    expect(back).toBe(location.href); // the flow can bring the visitor back here
  });
  it("is persistent: a removed header button or rail comes back; a re-rendered page gets everything again", async () => {
    document.body.innerHTML = WP_PAGE;
    handle = S.startSectorPage(OPTS, document);
    document.querySelector(".rv-sector-rail")!.remove();
    await settle();
    assertSectorPage();
    document.querySelector(".rv-fields-root")!.innerHTML = `<section><h2>Re-rendered field</h2></section>`;
    await settle();
    assertSectorPage();
  });
  it("a field added through \"Suggest a field\" (once approved) and a field from a plugin get their buttons with no code for them", async () => {
    document.body.innerHTML = WP_PAGE;
    handle = S.startSectorPage(OPTS, document);
    const root = document.querySelector(".rv-fields-root")!;
    root.insertAdjacentHTML("beforeend", `<section data-rv-field="greenhouse-robots"><h2>Greenhouse robots</h2><p>Approved.</p></section>`);
    root.insertAdjacentHTML("beforeend", `<div class="e-con e-parent acme-dealers"><h2>Local dealers</h2></div>`);
    await settle();
    assertSectorPage();
    expect(document.querySelectorAll(".rv-contribute-btn--field")).toHaveLength(4);
  });
  it("without a theme title (a page with its title switched off) the button still goes in the top-right of the content", async () => {
    document.body.innerHTML = `<main><article><div class="entry-content"><div class="rv-fields-root"><section><h2>Only field</h2></section></div></div></article></main>`;
    handle = S.startSectorPage(OPTS, document);
    await settle();
    assertSectorPage();
  });
});

describe("in the app (a page rendered with the same component)", () => {
  const FIELDS = [
    { id: "about", title: "About this sector", html: "<p>Farms and dairies.</p>" },
    { id: "milking-robots", title: "Milking robots", html: "<p>Robots that milk cows.</p>" },
    { id: "greenhouse-robots", title: "Greenhouse robots", html: "<p>Suggested by a member, approved.</p>", source: "suggested" },
  ];
  it("renders the title, the header button (sticky aside) and the cards; every card gets its field button", async () => {
    document.body.innerHTML = `<main>${S.sectorPageHtml({ sector: { slug: "agriculture-dairy", name: "Agriculture and Dairy" }, fields: FIELDS, href: S.contributeHref(OPTS.form, { sector: "agriculture-dairy", returnTo: "/dashboard/sectors/agriculture-dairy" }), suggestHref: "/x" })}</main>`;
    handle = S.startSectorPage({ ...OPTS, header: false }, document);
    await settle();
    assertSectorPage();
    expect(document.querySelector(".rv-sector-title")!.textContent).toBe("Agriculture and Dairy");
    expect(document.querySelector(".rv-sector-aside .rv-contribute-btn--header")).not.toBeNull();
    expect(Array.from(document.querySelectorAll("[data-rv-field-id]")).map((f) => f.getAttribute("data-rv-field-id"))).toEqual(["about", "milking-robots", "greenhouse-robots"]);
    expect(document.querySelector(".rv-sector-suggest a")!.textContent).toBe("+ Suggest a field");
  });
  it("the reviewer screens' header bar: title on the left, the button on the right", () => {
    document.body.innerHTML = S.sectorHeaderHtml({ title: "Agriculture and Dairy", href: "/contribute-now/?sector=agriculture-dairy" });
    expect(document.querySelector(".rv-sector-headbar .rv-sector-title")!.textContent).toBe("Agriculture and Dairy");
    expect(headerButtons()).toHaveLength(1);
    expect(headerButtons()[0].textContent).toBe(S.HEADER_LABEL);
  });
  it("contributeHref keeps the sector, the field, the resource and the way back; a relative form stays relative", () => {
    expect(S.contributeHref("/contribute-now/", { sector: "agriculture-dairy", field: "milking-robots", returnTo: "/dashboard/sectors/agriculture-dairy" }))
      .toBe("/contribute-now/?sector=agriculture-dairy&field=milking-robots&return_to=%2Fdashboard%2Fsectors%2Fagriculture-dairy");
    expect(S.contributeHref("https://site.example/share-your-idea/", { sector: "x" })).toBe("https://site.example/share-your-idea/?sector=x");
  });
});

describe("the shared stylesheet (public/cw/sector.css)", () => {
  const css = readFileSync("public/cw/sector.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (sel: string) => (css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}")) || [])[1] || "";
  it("the header button matches the reference: white, green border, green bold text, 8px corners, light green on hover", () => {
    const b = rule(".rv-contribute-field .rv-contribute-btn.rv-contribute-btn--field");
    for (const d of ["background: #FFFFFF !important", "border: 1.5px solid #237A33 !important", "color: #237A33 !important", "font-weight: 700 !important", "border-radius: 8px !important"]) expect(b).toContain(d);
    expect(rule(".rv-contribute-field .rv-contribute-btn.rv-contribute-btn--field:hover")).toContain("background: #F1F8F2 !important");
  });
  it("sticky: the header rail and aside stick to the top, each field's button to the bottom of its field; never position: fixed", () => {
    expect(rule(".rv-sector-aside")).toMatch(/position: sticky/);
    expect(rule(".rv-has-sector-rail > .rv-sector-rail")).toMatch(/position: sticky !important/);
    expect(rule(".rv-contribute-field")).toMatch(/position: sticky !important;[\s\S]*bottom: 12px !important/);
    expect(css).not.toMatch(/position:\s*fixed/);
  });
  it("phones and tablets: the header button below the title at full width; long words wrap; wide tables scroll in their card", () => {
    expect(css).toMatch(/@media \(max-width: 921px\)\s*\{[\s\S]*\.rv-sector-aside \.rv-contribute-btn\.rv-contribute-btn--header[\s\S]*width: 100% !important/);
    expect(rule(".rv-fields-root, .rv-sector-card")).toContain("overflow-wrap: anywhere");
    expect(rule(".rv-table-scroll")).toContain("overflow-x: auto");
  });
  it("follows the page's light or dark theme: the cards, the page text, the intro and \"Suggest a field\" use the page's colour tokens (white cards as the fallback)", () => {
    expect(rule(".rv-sector-card")).toMatch(/background: var\(--surface, #FFFFFF\);[\s\S]*border: 1px solid var\(--line, #E1E4EA\);[\s\S]*color: var\(--fg, #1B1F3B\)/);
    expect(rule(".rv-sector-page")).toContain("color: var(--fg, #1F2937)");
    expect(rule(".rv-sector-sub")).toContain("color: var(--muted, #4B5563)");
    expect(rule(".rv-sector-suggest")).toContain("color: var(--muted, #4B5563)");
    expect(rule(".rv-sector-suggest__link")).toContain("color: var(--navy, #237A33)"); // on the page background, not a card
  });
  it("every selector is namespaced (it cannot restyle the theme)", () => {
    const selectors = (css.match(/(^|[};])\s*([^{}@;]+)\{/g) || []).map((m) => m.replace(/^[};]?\s*/, "").replace(/\{$/, "").trim()).filter(Boolean);
    for (const sel of selectors) for (const one of sel.split(",")) expect(one.trim(), one).toMatch(/^\.(rv-contribute-|rv-sector-|rv-has-|rv-cf-|rv-fields-root|rv-table-scroll)/);
  });
});

describe("the portal screens' stylesheet (public/cw/portal.css)", () => {
  const css = readFileSync("public/cw/portal.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (sel: string) => (css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}")) || [])[1] || "";
  it("follows the page's light or dark theme (its tokens, with the demo's light colours as fallbacks), so no text is dark on dark or light on white", () => {
    expect(rule(".rv-sector-tile")).toMatch(/border: 1px solid var\(--line, #E1E4EA\);[\s\S]*background: var\(--surface, #FFFFFF\);[\s\S]*color: var\(--fg, inherit\)/);
    expect(rule(".rv-mine-note")).toContain("color: var(--muted, #475569)");
    expect(rule(".rv-mine-detail td")).toContain("background: var(--bg, #F8FAFC)");
    expect(rule(".rv-sector-tile__link")).toContain("color: var(--teal, #237A33)"); // on the tile (a card)
    expect(rule(".rv-mine-clear")).toContain("color: var(--navy, #237A33)"); // on the page background
  });
  it("table cells wrap a long address without squeezing a column until ordinary words break in the middle", () => {
    expect(rule(".rv-mine-table th, .rv-mine-table td")).toContain("overflow-wrap: break-word");
    expect(rule(".rv-mine-table th, .rv-mine-table td")).not.toContain("anywhere");
  });
});
