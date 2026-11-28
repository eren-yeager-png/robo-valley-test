// @vitest-environment jsdom
// "Contribute to this sector" on every field of a Robots by Sector page (public/cw/js/fields.js, the one injector the WordPress plugin
// loads on sector pages and the demo runs). The GUARD: missingButtons() must be empty for every rendered field, whatever added the
// field (the page's own sections, Elementor, Gutenberg, an approved "Suggest a field", a plugin, a re-render), and the button must come
// back when something removes or hides it. Only the administrator's per-field setting turns it off.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as F from "../public/cw/js/fields.js";

const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 40)); };
const OPTS = { sector: "agriculture-dairy", sectorName: "Agriculture & Dairy", form: "https://site.example/contribute-now/", off: [] as string[] };
const buttons = (el: Element) => Array.from(el.querySelectorAll(`.${F.WRAP} > .${F.BTN}`));
const own = (el: Element) => Array.from(el.children).filter((c) => c.classList.contains(F.WRAP));
let handle: { stop: () => void; refresh: () => void } | null = null;

function page(content: string) {
  document.body.innerHTML = `<header class="site-header"><nav class="rv-sector-bar"><section>not a field</section></nav></header>
    <main id="primary"><article><div class="entry-content"><div class="rv-fields-root" data-rv-sector="agriculture-dairy">${content}</div></div></article></main>
    <footer class="site-footer"><section>not a field</section></footer>`;
}
const ELEMENTOR = `<div class="elementor elementor-12">
  <section class="elementor-section elementor-top-section" data-id="a1b2c3"><div class="elementor-container"><h2>Drone sprayers</h2><p>Text</p>
    <section class="elementor-section elementor-inner-section"><h3>Inner</h3></section></div></section>
  <div class="e-con e-parent" data-id="d4e5f6" style="display:flex;flex-direction:row"><div class="e-con e-child"><h2>Milking robots</h2></div><div class="e-con e-child">Photo</div></div>
</div>`;

beforeEach(() => { document.body.innerHTML = ""; });
afterEach(() => { handle?.stop(); handle = null; });

describe("which fields get the button", () => {
  it("every top-level section of the content: Elementor sections and containers (not inner ones), Gutenberg groups, <section>", () => {
    page(`${ELEMENTOR}<div class="wp-block-group"><h2>Weeding robots</h2><div class="wp-block-group"><p>nested</p></div></div><section><h2>Community project challenge</h2></section>`);
    const fields = F.apply(document, OPTS);
    expect(fields.map((f) => f.getAttribute("data-rv-field-id"))).toEqual(["drone-sprayers", "milking-robots", "weeding-robots", "community-project-challenge"]);
    expect(F.missingButtons(document, OPTS)).toEqual([]);
    for (const f of fields) expect(own(f)).toHaveLength(1);
    expect(document.querySelectorAll(`.${F.BTN}`)).toHaveLength(4); // never inside the header, the footer, the bar or an inner section
  });
  it("an element marked data-rv-field (the contract for plugins) is a field wherever it is in the page, and wins over the section around it", () => {
    page(`<section><h2>Outer</h2><div data-rv-field="robot-arms" data-rv-field-label="Robot arms">Arms</div><div data-rv-field="cobots">Cobots</div></section>`);
    document.querySelector("main")!.insertAdjacentHTML("beforeend", `<aside data-rv-field="dealers"><h3>Dealers</h3></aside>`);
    const fields = F.apply(document, OPTS);
    expect(fields.map((f) => f.getAttribute("data-rv-field-id"))).toEqual(["robot-arms", "cobots", "dealers"]);
    expect(F.missingButtons(document, OPTS)).toEqual([]);
  });
  it("plain content without sections is one field; duplicate ids are numbered", () => {
    page(`<h2>About</h2><p>Text only.</p>`);
    expect(F.apply(document, OPTS).map((f) => f.getAttribute("data-rv-field-id"))).toEqual(["about"]);
    page(`<section><h2>Drones</h2></section><section><h2>Drones</h2></section>`);
    expect(F.apply(document, OPTS).map((f) => f.getAttribute("data-rv-field-id"))).toEqual(["drones", "drones-2"]);
  });
  it("selectors added by a plugin (rv_contrib_field_selectors) count too; a broken one is skipped", () => {
    page(`<div class="acme-card"><h3>Acme</h3></div><section><h2>Core</h2></section>`);
    const fields = F.apply(document, { ...OPTS, selectors: [".acme-card", "<<bad"] });
    expect(fields.map((f) => f.getAttribute("data-rv-field-id"))).toEqual(["acme", "core"]);
  });
});

describe("the button", () => {
  it("opens the contribute flow with the sector and the field filled in, says which field it is for, and is the field's last child", () => {
    page(`<section id="drone-sprayers"><h2>Drone sprayers</h2><p>x</p></section>`);
    F.apply(document, OPTS);
    const f = document.querySelector(".rv-fields-root section")!, a = buttons(f)[0] as HTMLAnchorElement;
    expect(f.lastElementChild!.classList.contains(F.WRAP)).toBe(true);
    const u = new URL(a.getAttribute("href")!);
    expect(u.origin + u.pathname).toBe("https://site.example/contribute-now/");
    expect(u.searchParams.get("sector")).toBe("agriculture-dairy");
    expect(u.searchParams.get("field")).toBe("drone-sprayers");
    expect(u.searchParams.get("resource_path")).toBe("Robots by Sector › Agriculture & Dairy › Drone sprayers");
    expect(a.textContent).toBe(F.LABEL);
    expect(a.getAttribute("aria-label")).toBe("Contribute to this sector: Drone sprayers");
    expect(a.className).toBe("rv-contribute-btn rv-contribute-btn--field");
  });
  it("is sticky INSIDE its field (not fixed to the page), namespaced, protected against theme rules, and full width on phones", () => {
    const css = readFileSync("public/cw/sector.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = (sel: string) => (css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}")) || [])[1] || "";
    expect(rule(".rv-contribute-field")).toMatch(/position:\s*sticky !important/);
    expect(rule(".rv-contribute-field")).toMatch(/bottom:\s*12px !important/);
    expect(css).not.toMatch(/position:\s*fixed/);
    for (const prop of ["display", "visibility", "opacity"]) expect(rule(".rv-contribute-field .rv-contribute-btn.rv-contribute-btn--field")).toMatch(new RegExp(`${prop}:[^;]*!important`));
    expect(css).toMatch(/@media \(max-width: 921px\)\s*\{[\s\S]*\.rv-contribute-field \.rv-contribute-btn\.rv-contribute-btn--field \{ width: 100% !important/);
  });
  it("in a row of columns (flex row) the button takes its own line instead of becoming a column", () => {
    page(`<div class="e-con e-parent" style="display:flex;flex-direction:row"><div><h2>Left</h2></div><div>Right</div></div>`);
    F.apply(document, OPTS);
    expect(document.querySelector(".e-con")!.classList.contains("rv-has-contribute-field--row")).toBe(true);
  });
});

describe("persistent: nothing removes or hides it", () => {
  it("a field added later (an approved \"Suggest a field\", a plugin, a re-render) gets the button by itself", async () => {
    page(`<section><h2>Drone sprayers</h2></section>`);
    handle = F.start(OPTS, document);
    const s = document.createElement("section");
    s.setAttribute("data-rv-field", "Greenhouse robots"); s.innerHTML = "<h2>Greenhouse robots</h2><p>Approved a moment ago.</p>";
    document.querySelector(".rv-fields-root")!.appendChild(s); // approved suggestion
    document.querySelector(".rv-fields-root")!.insertAdjacentHTML("beforeend", `<section class="acme-dealers"><h2>Local dealers</h2></section>`); // a plugin
    await settle();
    expect(F.missingButtons(document, OPTS)).toEqual([]);
    expect(s.getAttribute("data-rv-field-id")).toBe("greenhouse-robots");
    document.querySelector(".rv-fields-root")!.innerHTML = `<section><h2>Re-rendered</h2></section>`; // a builder re-renders everything
    await settle();
    expect(F.missingButtons(document, OPTS)).toEqual([]);
  });
  it("a removed button comes back; a hidden one is shown again", async () => {
    page(`<section><h2>Drone sprayers</h2></section>`);
    handle = F.start(OPTS, document);
    const f = document.querySelector(".rv-fields-root section")!;
    own(f)[0].remove();
    await settle();
    expect(buttons(f)).toHaveLength(1);
    const wrap = own(f)[0] as HTMLElement, a = buttons(f)[0] as HTMLElement;
    wrap.style.display = "none"; a.setAttribute("hidden", ""); wrap.className = "something-else";
    await settle();
    expect(wrap.getAttribute("style")).toBeNull();
    expect(a.hasAttribute("hidden")).toBe(false);
    expect(wrap.className).toBe(F.WRAP);
    f.appendChild(document.createElement("p")); // something added after it: the button moves back to the end
    await settle();
    expect(f.lastElementChild).toBe(wrap);
  });
  it("only the administrator's per-field setting turns it off (for that field, in every sector or in one)", () => {
    page(`<section><h2>Drone sprayers</h2></section><section><h2>Milking robots</h2></section><section><h2>Weeding robots</h2></section>`);
    const opts = { ...OPTS, off: ["milking-robots", "agriculture-dairy/weeding-robots", "healthcare/drone-sprayers"] };
    const fields = F.apply(document, opts);
    expect(fields.map((f) => buttons(f).length)).toEqual([1, 0, 0]);
    expect(F.missingButtons(document, opts)).toEqual([]);
    F.apply(document, OPTS); // the setting cleared: back on
    expect(fields.map((f) => buttons(f).length)).toEqual([1, 1, 1]);
  });
  it("THE GUARD fails when a rendered field has no button", () => {
    page(`<section><h2>Drone sprayers</h2></section>`);
    expect(F.missingButtons(document, OPTS)).toHaveLength(1); // nothing injected yet: the guard reports it
  });
  it("an ancestor with overflow: hidden (which stops sticky) is clipped with overflow: clip instead; html and body are left alone", () => {
    page(`<div class="wrapper" style="overflow-x:hidden"><section><h2>Drone sprayers</h2></section></div>`);
    document.body.style.overflow = "hidden";
    F.apply(document, OPTS);
    expect(document.querySelector(".wrapper")!.className).toContain("rv-cf-clip-x");
    expect(document.body.className).not.toContain("rv-cf-clip");
  });
});
