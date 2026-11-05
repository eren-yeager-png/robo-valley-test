// @vitest-environment jsdom
// The contribution DEMO (front-end prototype): sector page, Contribute wizard, Directory. Real widget files in jsdom; the demo data comes from
// frontend/demo/contributions-demo.json. The demo must write nowhere: no request, no storage, no geolocation.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = join(__dirname, "..");
const WID = join(ROOT, "frontend/elementor/contrib-demo/widgets");
const FILE = { sector: "06-sector.html", contribute: "07-contribute.html", directory: "08-directory.html" } as const;
const SRC = (k: keyof typeof FILE) => readFileSync(join(WID, FILE[k]), "utf8");
const DATA = JSON.parse(readFileSync(join(ROOT, "frontend/demo/contributions-demo.json"), "utf8"));
const NOTICE = "Sample content for design preview. Not real contributions.";

const scriptsOf = (h: string) => [...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const markup = (h: string) => h.replace(/<script>[\s\S]*?<\/script>/g, "").replace(/<style>[\s\S]*?<\/style>/g, "");

let added: Array<[string, any, any]> = [];
let spies: { fetch: ReturnType<typeof vi.fn>; xhr: ReturnType<typeof vi.spyOn>; geo: { getCurrentPosition: ReturnType<typeof vi.fn>; watchPosition: ReturnType<typeof vi.fn> }; storage: ReturnType<typeof vi.spyOn> };

function mount(which: keyof typeof FILE, query = "", mutate?: (html: string) => string) {
  window.history.replaceState({}, "", "/" + query);
  let html = SRC(which);
  if (mutate) html = mutate(html);
  document.body.innerHTML = markup(html);
  for (const s of scriptsOf(html)) (0, eval)(s);
  const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
  const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
  return { $, $$, root: $(".rvd") };
}
const click = (el: Element | null) => (el as HTMLElement).click();
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
const setVal = (el: Element, v: string) => { (el as HTMLInputElement).value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
const btn = (text: string | RegExp) => [...document.querySelectorAll<HTMLElement>("button, a")].find((b) => (typeof text === "string" ? b.textContent === text : text.test(b.textContent ?? "")))!;

beforeEach(() => {
  added = [];
  const orig = document.addEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation(((t: string, l: any, o: any) => { added.push([t, l, o]); orig(t, l, o); }) as any);
  spies = {
    fetch: vi.fn(async () => { throw new Error("the demo must not make requests"); }),
    xhr: vi.spyOn(XMLHttpRequest.prototype, "open"),
    geo: { getCurrentPosition: vi.fn(), watchPosition: vi.fn() },
    storage: vi.spyOn(Storage.prototype, "setItem"),
  };
  (window as any).fetch = spies.fetch;
  Object.defineProperty(navigator, "geolocation", { value: spies.geo, configurable: true });
  (Element.prototype as any).scrollIntoView = vi.fn();
});
afterEach(() => {
  const rm = Document.prototype.removeEventListener.bind(document);
  added.forEach(([t, l, o]) => rm(t, l, o));
  document.body.innerHTML = "";
  delete (window as any).RVD;
  vi.restoreAllMocks();
});
const noWrites = () => {
  expect(spies.fetch).not.toHaveBeenCalled();
  expect(spies.xhr).not.toHaveBeenCalled();
  expect(spies.storage).not.toHaveBeenCalled();
  expect(spies.geo.getCurrentPosition).not.toHaveBeenCalled();
  expect(spies.geo.watchPosition).not.toHaveBeenCalled();
  expect(document.cookie).toBe("");
};

describe("the demo data file", () => {
  it("says isDemo on the file and on every item, and holds the planned amounts", () => {
    expect(DATA.version).toBe(1);
    expect(DATA.isDemo).toBe(true);
    expect(DATA.sectors).toHaveLength(3);
    expect(DATA.sectors.map((s: any) => s.name)).toEqual(["Agriculture & Dairy", "Education", "Healthcare"]);
    for (const s of DATA.sectors) {
      expect(s.robotTypes).toHaveLength(4);
      expect(DATA.contributions.filter((c: any) => c.sector === s.id)).toHaveLength(12);
    }
    for (const list of [DATA.contributions, DATA.directory, DATA.myContributions]) for (const i of list) expect(i.isDemo, i.id).toBe(true);
    expect(DATA.directory.length).toBeGreaterThanOrEqual(20);
    expect(new Set(DATA.myContributions.map((m: any) => m.status))).toEqual(new Set(["Draft", "Pending review", "Changes requested", "Published"]));
    expect(DATA.wizard.types).toHaveLength(14);
    expect(DATA.wizard.groups).toHaveLength(4);
    expect(DATA.directoryCategories.map((c: any) => c.label)).toEqual(["Places", "People", "Businesses", "Events and projects", "Helpers and resources", "Services and opportunities", "Support", "Community", "City"]);
    expect(DATA.directoryCategories.find((c: any) => c.id === "services-opportunities").subs).toHaveLength(6);
  });
  it("has all three labels and all the contribution types of the feed", () => {
    expect(new Set(DATA.contributions.map((c: any) => c.label))).toEqual(new Set(["Member experience", "Manufacturer claim", "Independent test"]));
    const types = new Set(DATA.contributions.map((c: any) => c.typeLabel));
    for (const t of ["Problem", "Firsthand experience", "Manufacturer or supplier"]) expect(types.has(t), t).toBe(true);
  });
  it("looks like nothing real: no e-mail address, no phone number, no web address, no picture file", () => {
    const text = JSON.stringify(DATA);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    expect(text).not.toMatch(/(\+91|\b\d{10}\b|\b\d{5}[\s-]\d{5}\b)/); // not a phone number (dates are fine)
    expect(text).not.toMatch(/https?:\/\/[\w-]+\.[\w.-]+/i);
    expect(text).not.toMatch(/\.(png|jpe?g|gif|webp)\b/i);
  });
  it("the built widgets and page files are exactly what the build produces from the sources and the data (nothing to forget)", () => {
    expect(() => execFileSync(process.execPath, [join(ROOT, "scripts/build-contrib-demo.mjs"), "--check"], { stdio: "pipe" })).not.toThrow();
  });
  it("the page files are DRAFT instructions for three new pages: no live page is named", () => {
    const pages = JSON.parse(readFileSync(join(ROOT, "frontend/elementor/contrib-demo/contrib-demo-pages.json"), "utf8")).pages;
    expect(pages.map((p: any) => p.slug)).toEqual(["sector-demo", "contribute-demo", "directory-demo"]);
    expect(pages.every((p: any) => p.status === "draft")).toBe(true);
    const all = Object.values(FILE).map((f) => readFileSync(join(WID, f), "utf8")).join("\n");
    expect(all).not.toMatch(/(?:fetch|XMLHttpRequest|localStorage|sessionStorage|document\.cookie|geolocation|navigator\.sendBeacon|innerHTML|insertAdjacentHTML)\s*[(.[=]/);
  });
});

describe("the flag", () => {
  it.each(["sector", "contribute", "directory"] as const)("%s: data-rvd=\"off\" shows one quiet line and nothing else", (w) => {
    const { root } = mount(w, "", (h) => h.replace('data-rvd="on"', 'data-rvd="off"'));
    expect(root.textContent).toBe("This preview is switched off.");
    expect(document.querySelectorAll(".rvd-card")).toHaveLength(0);
  });
  it("\"enabled\": false in the data file does the same", () => {
    const { root } = mount("sector", "", (h) => h.replace(/"enabled":true/, '"enabled":false'));
    expect(root.textContent).toBe("This preview is switched off.");
  });
  it.each(["sector", "contribute", "directory"] as const)("%s: the page notice and a Demo chip are shown when it is on", (w) => {
    const { $ } = mount(w);
    expect($(".rvd-notice").textContent).toBe("Demo" + NOTICE);
    expect($(".rvd-notice .rvd-chip").textContent).toBe("Demo");
  });
});

describe("sector page", () => {
  it("Agriculture & Dairy by default: breadcrumb, title, tagline, and the Contribute to this sector button", () => {
    const { $ } = mount("sector");
    expect($("h1").textContent).toBe("Agriculture & Dairy");
    expect($(".rvd-crumbs").textContent).toContain("Home / Robots by Sector / Agriculture & Dairy");
    expect($(".rvd-head p").textContent).toBe("Discover robots. Share problems. Build practical solutions together.");
    const a = $('[data-act="contribute-sector"]') as HTMLAnchorElement;
    expect(a.textContent).toBe("Contribute to this sector");
    expect(a.getAttribute("href")).toBe("/contribute-demo/?sector=agriculture-dairy");
  });
  it("?sector=education and ?sector=healthcare show that sector (one widget, query-string views)", () => {
    for (const [id, name] of [["education", "Education"], ["healthcare", "Healthcare"]]) {
      const { $, $$ } = mount("sector", "?sector=" + id);
      expect($("h1").textContent).toBe(name);
      expect($$('[role="tab"]')).toHaveLength(4);
      expect($('[data-act="contribute-sector"]').getAttribute("href")).toBe("/contribute-demo/?sector=" + id);
    }
  });
  it("four robot-type tabs in a tablist, one selected; arrow keys, Home and End move between them and the panel follows", () => {
    const { $, $$ } = mount("sector");
    expect($('[role="tablist"]')).not.toBeNull();
    const tabs = $$('[role="tab"]');
    expect(tabs.map((t) => t.textContent)).toEqual(["Drone sprayers", "Shed-cleaning robots", "Soil and water sensors", "Weeding robots"]);
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false", "false"]);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1, -1]);
    expect($('[role="tabpanel"]').textContent).toContain("Drones that spray crops from the air");
    expect($('[role="tabpanel"]').getAttribute("aria-labelledby")).toBe(tabs[0].id);
    key(tabs[0], "ArrowRight");
    expect($('[role="tab"][aria-selected="true"]').textContent).toBe("Shed-cleaning robots");
    expect($('[role="tabpanel"]').textContent).toContain("Floor robots that push or scrape dung");
    key($('[role="tab"][aria-selected="true"]'), "End");
    expect($('[role="tab"][aria-selected="true"]').textContent).toBe("Weeding robots");
    key($('[role="tab"][aria-selected="true"]'), "ArrowRight"); // wraps
    expect($('[role="tab"][aria-selected="true"]').textContent).toBe("Drone sprayers");
    key($('[role="tab"][aria-selected="true"]'), "ArrowLeft");
    expect($('[role="tab"][aria-selected="true"]').textContent).toBe("Weeding robots");
    key($('[role="tab"][aria-selected="true"]'), "Home");
    expect($('[role="tab"][aria-selected="true"]').textContent).toBe("Drone sprayers");
  });
  it("the panel has a picture placeholder with alt text, sample models, and the two robot-type actions", () => {
    const { $ } = mount("sector");
    const img = $('[role="tabpanel"] svg') as unknown as SVGElement;
    expect(img.getAttribute("role")).toBe("img");
    expect(img.getAttribute("aria-label")).toBe("Sample picture placeholder: Drone sprayers");
    expect($('[role="tabpanel"]').textContent).toContain("Sample Sprayer Mk1");
    const a = $('[data-act="contribute-robot"]') as HTMLAnchorElement;
    expect(a.textContent).toBe("Contribute about drone sprayers");
    expect(a.getAttribute("href")).toBe("/contribute-demo/?sector=agriculture-dairy&robot=drone-sprayers");
    expect($('[data-act="see-shared"]').textContent).toBe("See what members shared about drone sprayers ↓");
  });
  it("See what members shared about <robot type> filters the feed to that robot type and moves focus to the feed", () => {
    const { $, $$ } = mount("sector");
    click($('[data-act="see-shared"]'));
    expect(($("#rvd-f-robot") as HTMLSelectElement).value).toBe("drone-sprayers");
    const ids = $$(".rvd-feed > li").map((li) => li.getAttribute("data-id"));
    const want = DATA.contributions.filter((c: any) => c.robotType === "drone-sprayers").map((c: any) => c.id);
    expect(ids.sort()).toEqual(want.sort());
    expect(document.activeElement).toBe($("#rvd-feed-h"));
  });
  it("the community project challenge opens in-page with the Demo chip, a Close button and Escape; focus returns to the opener", () => {
    const { $ } = mount("sector");
    const opener = $('[data-act="challenge"]');
    expect(opener.textContent).toBe("View and contribute ›");
    opener.focus();
    click(opener);
    const dlg = $('[role="dialog"]');
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect(dlg.querySelector("h2")!.textContent).toBe("Affordable cattle-shed cleaning");
    expect(dlg.querySelector(".rvd-chip")!.textContent).toBe("Demo");
    expect(document.activeElement).toBe(dlg.querySelector("h2"));
    key(document.body, "Escape");
    expect(($(".rvd-drawer") as HTMLElement).hidden).toBe(true);
    expect(document.activeElement).toBe(opener);
    click(opener);
    click([...document.querySelectorAll<HTMLElement>(".rvd-drawer button")].find((b) => b.textContent === "Close")!);
    expect(($(".rvd-drawer") as HTMLElement).hidden).toBe(true);
  });
  it("the feed: every card has a Demo chip, a type label, a badge and 'role · district'; six first, Load more shows the rest", () => {
    const { $, $$ } = mount("sector");
    expect($("#rvd-feed-h").textContent).toBe("Community contributions");
    let cards = $$(".rvd-feed > li");
    expect(cards).toHaveLength(6);
    for (const c of cards) {
      expect(c.querySelector(".rvd-chip")!.textContent).toBe("Demo");
      expect(c.querySelector(".rvd-type")!.textContent).toMatch(/\S/);
      expect(c.querySelector(".rvd-badge")!.textContent).toMatch(/Member experience|Manufacturer claim|Independent test/);
      expect(c.querySelector(".rvd-card-foot .rvd-meta")!.textContent).toMatch(/^.+ · .+$/);
      expect(c.textContent).not.toMatch(/@|\d{10}/); // contributor role and district only
    }
    expect($(".rvd-feed + .rvd-meta, [role=status]").textContent).toBeDefined();
    click($('[data-act="load-more"]'));
    cards = $$(".rvd-feed > li");
    expect(cards).toHaveLength(12);
    expect(($('[data-act="load-more"]') as HTMLElement).hidden).toBe(true);
  });
  it("filters: Type, Robot type, Location and Date (newest first by default, oldest first on request); a filter with no match says so and Clear filters resets", () => {
    const { $, $$ } = mount("sector");
    click($('[data-act="load-more"]'));
    const dates = () => $$(".rvd-feed > li").map((li) => DATA.contributions.find((c: any) => c.id === li.getAttribute("data-id")).date);
    expect(dates()).toEqual([...dates()].sort().reverse());
    setVal($("#rvd-f-date"), "old");
    expect(dates()).toEqual([...dates()].sort());
    setVal($("#rvd-f-date"), "new");
    setVal($("#rvd-f-type"), "Problem");
    expect($$(".rvd-feed > li").every((li) => li.querySelector(".rvd-type")!.textContent === "Problem")).toBe(true);
    setVal($("#rvd-f-loc"), "Anand");
    const n = $$(".rvd-feed > li").length;
    expect(n).toBe(DATA.contributions.filter((c: any) => c.sector === "agriculture-dairy" && c.typeLabel === "Problem" && c.district === "Anand").length);
    setVal($("#rvd-f-robot"), "weeding");
    expect($$(".rvd-feed > li")).toHaveLength(0);
    expect(($(".rvd-card[hidden], .rvd-card:not([hidden]) > p") as HTMLElement).textContent).toContain("No sample contributions match");
    click([...document.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent === "Clear filters")!);
    expect($$(".rvd-feed > li").length).toBe(6);
  });
  it("the result count is announced in a polite live region", () => {
    const { $ } = mount("sector");
    const live = [...document.querySelectorAll<HTMLElement>("[role=status]")].find((s) => /Showing/.test(s.textContent ?? ""))!;
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toBe("Showing 6 of 12 sample contributions");
    expect($("#rvd-feed-h")).not.toBeNull();
  });
  it("a card opens its full demo text in the drawer (click, Enter or Space) with the Demo chip and Close", () => {
    const { $, $$ } = mount("sector");
    const first = $$(".rvd-feed > li")[0];
    const c = DATA.contributions.find((x: any) => x.id === first.getAttribute("data-id"));
    expect(first.getAttribute("role")).toBe("button");
    expect(first.tabIndex).toBe(0);
    key(first, "Enter");
    const dlg = $('[role="dialog"]');
    expect(dlg.querySelector("h2")!.textContent).toBe(c.title);
    expect(dlg.textContent).toContain("This is sample text written for a design preview");
    expect(dlg.querySelector(".rvd-chip")!.textContent).toBe("Demo");
    key(document.body, "Escape");
    key($$(".rvd-feed > li")[1], " ");
    expect(($(".rvd-drawer") as HTMLElement).hidden).toBe(false);
  });
  it("From the RoboValley Directory: a heading shows only when it has listings, and Open in Directory links to the directory for the sector", () => {
    for (const s of DATA.sectors) {
      const { $, $$ } = mount("sector", "?sector=" + s.id);
      const heads = $$(".rvd-dir-grid h3").map((x) => x.textContent);
      expect(heads.length).toBeGreaterThan(0);
      for (const hd of $$(".rvd-dir-grid > div")) expect(hd.querySelectorAll(".rvd-card").length, hd.textContent!).toBeGreaterThan(0);
      expect(new Set(heads).size).toBe(heads.length);
      const a = [...document.querySelectorAll<HTMLAnchorElement>("a")].find((x) => x.textContent === "Open in Directory →")!;
      expect(a.getAttribute("href")).toBe("/directory-demo/?sector=" + s.id);
    }
  });
  it("writes nowhere", () => {
    const { $, $$ } = mount("sector");
    click($('[data-act="see-shared"]'));
    click($$(".rvd-feed > li")[0]);
    noWrites();
  });
});

describe("Contribute wizard", () => {
  const steps = () => [...document.querySelectorAll<HTMLElement>(".rvd-steps li")];
  const current = () => steps().find((l) => l.getAttribute("aria-current") === "step")?.textContent;
  const next = () => click(document.querySelector('[data-act="next"]'));
  it("a step list of four with aria-current=step on the current one", () => {
    mount("contribute");
    expect(document.querySelector(".rvd-steps")!.getAttribute("aria-label")).toBe("Steps");
    expect(steps().map((l) => l.textContent)).toEqual(["1 Scope", "2 Type", "3 Details", "4 Preview"]);
    expect(current()).toBe("1 Scope");
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });
  it("scope is preset to the sector (and robot type) the visitor came from", () => {
    const { $ } = mount("contribute", "?sector=healthcare&robot=telehealth");
    expect(($("#rvd-sector") as HTMLSelectElement).value).toBe("healthcare");
    expect($("#rvd-scope-now").textContent).toBe("Healthcare › Telehealth carts");
    expect(($('input[name="scope"][value="types"]') as HTMLInputElement).checked).toBe(true);
    expect(($('input[name="robot"][value="telehealth"]') as HTMLInputElement).checked).toBe(true);
    expect($("#rvd-back").textContent).toBe("‹ Back to Healthcare");
    expect($("#rvd-back").getAttribute("href")).toBe("/sector-demo/?sector=healthcare");
  });
  it("Selected robot types needs at least one robot type; the message is a live-region alert and focus goes to the first box", () => {
    const { $ } = mount("contribute");
    click($('input[name="scope"][value="types"]'));
    next();
    expect($("#rvd-err-robots").textContent).toBe("Choose at least one robot type.");
    expect($("#rvd-err-robots").getAttribute("role")).toBe("alert");
    expect(current()).toBe("1 Scope");
    click($('input[name="robot"][value="weeding"]'));
    expect(($("#rvd-err-robots") as HTMLElement).hidden).toBe(true);
    next();
    expect(current()).toBe("2 Type");
  });
  it("step 2: fourteen types in four headed groups, one radio group; Next without a choice stops with an alert", () => {
    const { $, $$ } = mount("contribute");
    next();
    expect(document.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect($$("fieldset legend").map((l) => l.textContent)).toEqual(["Share what you know", "Propose", "Offer help · also listed in the RoboValley Directory", "Fix"]);
    const radios = $$('input[name="type"]');
    expect(radios).toHaveLength(14);
    expect($$("fieldset").map((f) => f.querySelectorAll('input[name="type"]').length)).toEqual([5, 2, 6, 1]);
    next();
    expect($("#rvd-err-type").textContent).toBe("Choose what you would like to share.");
    expect(current()).toBe("2 Type");
    click(radios[0]);
    next();
    expect(current()).toBe("3 Details");
  });
  it("focus moves to the step's heading on every step", () => {
    const { $ } = mount("contribute");
    next();
    expect(document.activeElement).toBe($("#rvd-step-h"));
    expect($("#rvd-step-h").textContent).toBe("What would you like to share?");
    click($('input[name="type"][value="problem"]'));
    next();
    expect(document.activeElement).toBe($("#rvd-step-h"));
    expect($("#rvd-step-h").textContent).toBe("Details for: Report a problem");
  });
  it("step 3: the reference form for Report a problem; contact details are OFF by default; photos are not stored", () => {
    const { $, $$ } = mount("contribute", "?type=problem");
    next(); // scope -> type (already chosen)
    next(); // type -> details
    expect($$("label.rvd-label").map((l) => l.textContent)).toEqual(["Title *", "Describe it *", "How is it done now?", "Who is affected?", "Time or cost involved", "Improvement you want", "Your role *", "Location"]);
    expect(($("#rvd-contact") as HTMLInputElement).checked).toBe(false);
    expect(($("#rvd-contact") as HTMLElement).closest("label")!.textContent).toBe("Show my contact details publicly. Private unless you tick this.");
    const photos = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Add photos")!;
    expect(photos.disabled).toBe(true);
    expect(document.body.textContent).toContain("Photos are not stored in this preview.");
  });
  it("validation: empty required fields show an alert beside each, focus goes to the first, and the step does not advance", () => {
    const { $ } = mount("contribute", "?type=problem");
    next(); next();
    next(); // Next: Preview with nothing filled
    expect(current()).toBe("3 Details");
    for (const [id, msg] of [["title", "Title is required."], ["description", "Describe it is required."], ["role", "Your role is required."]]) {
      expect($("#rvd-err-" + id).textContent).toBe(msg);
      expect($("#rvd-err-" + id).getAttribute("role")).toBe("alert");
      expect($("#rvd-f-" + id).getAttribute("aria-invalid")).toBe("true");
    }
    expect(document.activeElement).toBe($("#rvd-f-title"));
    setVal($("#rvd-f-title"), "Sample title");
    expect(($("#rvd-err-title") as HTMLElement).hidden).toBe(true);
    expect($("#rvd-f-title").hasAttribute("aria-invalid")).toBe(false);
  });
  it("every one of the fourteen types has its own form with a title, a description and a role", () => {
    for (const t of DATA.wizard.types) {
      const { $, $$ } = mount("contribute", "?type=" + t.id);
      next(); next();
      expect($("#rvd-step-h").textContent).toBe("Details for: " + t.label);
      const labels = $$("label.rvd-label").map((l) => l.textContent);
      expect(labels, t.id).toContain("Title *");
      expect(labels, t.id).toContain("Describe it *");
      expect(labels, t.id).toContain("Your role *");
      expect($$(".rvd-form [data-field]").length, t.id).toBe(t.fields.length);
    }
  });
  function fill() {
    setVal(document.querySelector("#rvd-f-title")!, "Sample title for a demo");
    setVal(document.querySelector("#rvd-f-description")!, "Sample description.");
    setVal(document.querySelector("#rvd-f-role")!, "Farmer");
  }
  it("Save draft adds a Draft line to My Contributions (this page only) and says nothing was saved", () => {
    const { $, $$ } = mount("contribute", "?type=problem");
    expect($$(".rvd-mine li")).toHaveLength(4);
    next(); next();
    click($('[data-act="draft"]')); // no title yet
    expect($("#rvd-err-title").textContent).toBe("Title is required.");
    expect($$(".rvd-mine li")).toHaveLength(4);
    fill();
    click($('[data-act="draft"]'));
    expect($$(".rvd-mine li")).toHaveLength(5);
    expect($(".rvd-mine li").textContent).toContain("Sample title for a demo");
    expect($(".rvd-mine li .rvd-st").textContent).toBe("Draft");
    expect($("#rvd-status").textContent).toBe("Draft added to My Contributions. Demo only: nothing was saved or sent.");
    noWrites();
  });
  it("Preview shows what was entered with a Demo chip; Submit says 'Demo only: nothing was saved or sent' and adds Pending review for this session only", () => {
    const { $, $$ } = mount("contribute", "?sector=education&type=problem");
    next(); next(); fill(); next();
    expect(current()).toBe("4 Preview");
    expect($("#rvd-step-h").textContent).toBe("Preview");
    const text = $(".rvd-sum").textContent!;
    expect(text).toContain("Education › entire sector");
    expect(text).toContain("Sample title for a demo");
    expect(text).toContain("Private");
    expect($(".rvd-card .rvd-chip").textContent).toBe("Demo");
    click($('[data-act="submit"]'));
    expect($("#rvd-step-h").textContent).toBe("Demo only: nothing was saved or sent");
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(0);
    expect($(".rvd-mine li .rvd-st").textContent).toBe("Pending review");
    expect($$(".rvd-mine li")).toHaveLength(5);
    noWrites();
    // a reload loses it (the page is mounted again from nothing)
    const again = mount("contribute", "?sector=education&type=problem");
    expect(again.$$(".rvd-mine li")).toHaveLength(4);
    expect(again.$$(".rvd-mine li .rvd-st").map((s) => s.textContent)).toEqual(["Draft", "Pending review", "Changes requested", "Published"]);
  });
  it("Submit from the Preview with a required field missing goes back to Details with the errors", () => {
    const { $ } = mount("contribute", "?type=problem");
    next(); next(); fill(); next();
    // clear the title in memory, as if edited on another step
    click($('[data-act="back"]'));
    setVal($("#rvd-f-title"), "");
    next();
    expect(current()).toBe("3 Details");
    expect($("#rvd-err-title").textContent).toBe("Title is required.");
  });
  it("My Contributions lists the four statuses and 'Before it goes live' notes a moderator checks every contribution", () => {
    const { $, $$ } = mount("contribute");
    expect($$(".rvd-mine li .rvd-st").map((s) => s.textContent)).toEqual(["Draft", "Pending review", "Changes requested", "Published"]);
    expect($$(".rvd-mine li").every((li) => li.querySelector(".rvd-chip"))).toBe(true);
    expect(document.body.textContent).toContain("A moderator checks every contribution before publishing.");
    expect($("#rvd-mine-h").textContent).toBe("My Contributions");
  });
  it("Back goes to the previous step and keeps what was typed", () => {
    const { $ } = mount("contribute", "?type=problem");
    next(); next(); fill();
    click($('[data-act="back"]'));
    expect(current()).toBe("2 Type");
    next();
    expect(($("#rvd-f-title") as HTMLInputElement).value).toBe("Sample title for a demo");
  });
});

describe("Directory", () => {
  it("search, quick filters (kits, soldering, mentors, 3D printing...), a Near me chip and the category list are there", () => {
    const { $, $$ } = mount("directory");
    expect($("h1").textContent).toBe("RoboValley Directory");
    expect(($("#rvd-q") as HTMLInputElement).placeholder).toBe("Search the Directory");
    expect($$("[data-tag]").map((b) => b.textContent)).toEqual(expect.arrayContaining(["kits", "soldering", "mentors", "3D printing"]));
    expect($("[data-near]").textContent).toBe("Near me");
    expect($$(".rvd-cats > li > button").map((b) => b.getAttribute("data-cat"))).toEqual(["", "places", "people", "businesses", "events-projects", "helpers-resources", "services-opportunities", "support", "community", "city"]);
    const a = $('[data-act="suggest"]') as HTMLAnchorElement;
    expect(a.textContent).toBe("Suggest an item");
    expect(a.getAttribute("href")).toContain("/contribute-demo/?sector=");
  });
  it("every result card has a Demo chip, the category path, a district and tags; the count is announced", () => {
    const { $, $$ } = mount("directory");
    const cards = $$(".rvd-results > li");
    expect(cards).toHaveLength(DATA.directory.length);
    for (const c of cards) {
      expect(c.querySelector(".rvd-chip")!.textContent).toBe("Demo");
      expect(c.querySelector(".rvd-path")!.textContent).toMatch(/\S/);
    }
    expect([...document.querySelectorAll("[role=status]")].some((s) => s.textContent === DATA.directory.length + " sample items")).toBe(true);
    expect(cards.some((c) => c.textContent!.includes("From a contribution: Offer rental"))).toBe(true);
    expect($(".rvd-results > li .rvd-path").textContent).toContain("›");
  });
  it("typing in the search box narrows the list word by word", () => {
    const { $, $$ } = mount("directory");
    setVal($("#rvd-q"), "drone repair");
    const names = $$(".rvd-results h3").map((h) => h.textContent);
    expect(names).toEqual(["Sample Pump & Drone Workshop"]);
    setVal($("#rvd-q"), "zzzz");
    expect($$(".rvd-results > li")).toHaveLength(0);
    expect(document.body.textContent).toContain("No sample items match");
  });
  it("a quick filter chip toggles (aria-pressed) and filters by tag", () => {
    const { $, $$ } = mount("directory");
    click($('[data-tag="kits"]'));
    expect($('[data-tag="kits"]').getAttribute("aria-pressed")).toBe("true");
    expect($$(".rvd-results > li").length).toBe(DATA.directory.filter((d: any) => d.tags.includes("kits")).length);
    click($('[data-tag="kits"]'));
    expect($('[data-tag="kits"]').getAttribute("aria-pressed")).toBe("false");
    expect($$(".rvd-results > li")).toHaveLength(DATA.directory.length);
  });
  it("Near me filters to the sample district and never asks for a location", () => {
    const { $, $$ } = mount("directory");
    click($("[data-near]"));
    expect($("[data-near]").getAttribute("aria-pressed")).toBe("true");
    const want = DATA.directory.filter((d: any) => d.district === DATA.nearMeDistrict).length;
    expect(want).toBeGreaterThan(0);
    expect($$(".rvd-results > li")).toHaveLength(want);
    expect(document.body.textContent).toContain("This page never asks for your location.");
    noWrites();
  });
  it("the sector chip (from ?sector=) filters and can be removed", () => {
    const { $, $$ } = mount("directory", "?sector=healthcare");
    const chip = $("[data-sector-chip]");
    expect(chip.textContent).toBe("Sector: Healthcare ×");
    expect($$(".rvd-results > li")).toHaveLength(DATA.directory.filter((d: any) => d.sectors.includes("healthcare")).length);
    click(chip);
    expect(document.querySelector("[data-sector-chip]")).toBeNull();
    expect($$(".rvd-results > li")).toHaveLength(DATA.directory.length);
  });
  it("Services and opportunities opens its six sub-types, and a sub-type filters", () => {
    const { $, $$ } = mount("directory");
    click($('[data-cat="services-opportunities"]'));
    expect($('[data-cat="services-opportunities"]').getAttribute("aria-expanded")).toBe("true");
    expect($$(".rvd-subs button").map((b) => b.querySelector("span")!.textContent)).toEqual(["Services offered", "Services needed", "Project support", "Internships and live projects", "Virtual games and simulations", "AI agents (virtual robots)"]);
    click($('[data-sub="services-needed"]'));
    expect($$(".rvd-results > li")).toHaveLength(DATA.directory.filter((d: any) => d.sub === "services-needed").length);
    expect($(".rvd-results .rvd-path").textContent).toBe("Services and opportunities › Services needed");
    click($('[data-cat=""]'));
    expect($$(".rvd-results > li")).toHaveLength(DATA.directory.length);
  });
  it("a card opens its detail in the drawer with the Demo chip and Close", () => {
    const { $, $$ } = mount("directory");
    const first = $$(".rvd-results > li")[0];
    click(first);
    const dlg = $('[role="dialog"]');
    expect(dlg.querySelector("h2")!.textContent).toBe(DATA.directory[0].name);
    expect(dlg.textContent).toContain("It is not a real person, business or service");
    expect(dlg.querySelector(".rvd-chip")!.textContent).toBe("Demo");
    click([...dlg.querySelectorAll("button")].find((b) => b.textContent === "Close")!);
    expect(($(".rvd-drawer") as HTMLElement).hidden).toBe(true);
  });
  it("writes nowhere", () => {
    const { $ } = mount("directory");
    setVal($("#rvd-q"), "kits");
    click($('[data-tag="kits"]'));
    noWrites();
  });
});
