// @vitest-environment jsdom
// Find a Service: category chips, Coming Soon, directory that follows the category, tooltips, click popups and the range/zoom
// behaviour. Widgets 01 (chips), 03 (results + map) and 05 (directory) run together on a page; Leaflet and the network are faked.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeLeaflet, newCalls, type Calls } from "./helpers/fakeLeaflet";

const DIR = join(__dirname, "../frontend/elementor/find-a-service-510/widgets");
const PANEL = readFileSync(join(DIR, "01-search-panel.a51f0c7.html"), "utf8");
const RESULTS = readFileSync(join(DIR, "03-results-map-script.a51f0d3.html"), "utf8");
const DIRECTORY = readFileSync(join(DIR, "05-school-directory.a51f0e4.html"), "utf8");
const scriptsOf = (h: string) => [...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const markup = (h: string) => h.replace(/<script>[\s\S]*?<\/script>/g, "").replace(/<style>[\s\S]*?<\/style>/g, "");
const settle = () => new Promise((r) => setTimeout(r, 0));
const flush = async (n = 10) => { for (let i = 0; i < n; i++) await settle(); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const API = "https://app.techytree.in";
const NAMES = ["ATL Labs", "Robotics Labs", "STEM Labs", "3D Printing Facilities", "Robotics Training Centres", "Innovation Centres"];
const SLUGS = ["atl-labs", "robotics-labs", "stem-labs", "3d-printing-facilities", "robotics-training-centres", "innovation-centres"];
const cats = (active: string[], count = 9716) => ({
  success: true, defaultSlug: SLUGS.find((s) => active.includes(s)) ?? null,
  categories: SLUGS.map((slug, i) => ({ slug, name: NAMES[i], active: active.includes(slug), count: active.includes(slug) ? count : 0, uploadedAt: null })),
});
const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
const school = (over: Record<string, unknown> = {}) => ({
  id: "1", schoolName: "A School", state: "Delhi", district: "New Delhi", pincode: "110001", udiseCode: "U1", details: { "ATL UID Code": "ATL-001" },
  distanceKm: 0, lat: 28.6139, lng: 77.209, ...over,
});
const CATEGORY = { slug: "atl-labs", name: "ATL Labs", active: true };
const near = (results: unknown[], over: Record<string, unknown> = {}) => ({
  success: true, dataset: { id: "1" }, category: CATEGORY, total: (results as any[]).length, page: 1, pageSize: 50, results,
  near: { center: { lat: 28.6139, lng: 77.209 }, pincodeKnown: true, radiusKm: 25, limit: 50 }, ...over,
});
const FOUR_AT_ONE_POINT = [
  school({ id: "1", schoolName: "A School" }), school({ id: "2", schoolName: "Second School" }),
  school({ id: "3", schoolName: "Third School" }), school({ id: "4", schoolName: "Fourth School" }),
  school({ id: "5", schoolName: "Near School", pincode: "110002", district: "Central Delhi", distanceKm: 3.6, lat: 28.64, lng: 77.23, details: { "ATL UID Code": "ATL-005" } }),
];
const dirPage = (total: number, n = 12, name = "ATL Labs") => ({
  success: true, dataset: { id: "1" }, category: { slug: "x", name, active: true }, total, page: 1, pageSize: 12,
  results: Array.from({ length: n }, (_v, i) => ({ id: String(i), schoolName: `School ${i + 1}`, state: "S", district: "D", pincode: "110001", udiseCode: null, details: {} })),
});

type Handler = (url: string) => unknown | Promise<unknown>;
let added: Array<[string, any, any]> = [];
let calls: Calls;
let fetchMock: ReturnType<typeof vi.fn>;

async function mount(opts: { active?: string[]; search?: Handler; dir?: Handler; categories?: unknown } = {}) {
  document.head.querySelectorAll("#rv-fas-leaflet-css").forEach((n) => n.remove());
  document.body.innerHTML = markup(PANEL) + markup(RESULTS) + markup(DIRECTORY);
  calls = newCalls();
  fakeLeaflet(calls);
  (Element.prototype as any).scrollIntoView = vi.fn();
  delete (window as any).RvFasState;
  (window as any).RoboValleyApi = { base: API };
  window.matchMedia = window.matchMedia || ((() => ({ matches: false, addEventListener() {}, addListener() {} })) as any);
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/services/categories")) return ok(opts.categories ?? cats(opts.active ?? ["atl-labs"]));
    if (u.includes("/api/services/search")) {
      const isNear = u.includes("pincode=");
      return ok(await (isNear ? opts.search?.(u) ?? near(FOUR_AT_ONE_POINT) : opts.dir?.(u) ?? dirPage(9716)));
    }
    throw new Error("unexpected " + u);
  });
  (window as any).fetch = fetchMock;
  for (const h of [PANEL, RESULTS, DIRECTORY]) for (const s of scriptsOf(h)) (0, eval)(s);
  await flush(14);
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  const w = {
    $, chips: () => [...document.querySelectorAll<HTMLButtonElement>(".rv-fas-chip")], chip: (name: string) => w.chips().find((c) => c.textContent === name)!,
    tip: () => $("rv-fas-tip"), tipText: () => ($("rv-fas-tip").hidden ? "" : $("rv-fas-tip").textContent!),
    cards: () => [...document.querySelectorAll<HTMLElement>("#rv-fas-list > li")], summary: () => $("rv-fas-summary").textContent,
    state: () => ($("rv-fas-state").hidden ? "" : $("rv-fas-state").textContent!),
    searchUrls: () => fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("pincode=")),
    dirUrls: () => fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/search") && !u.includes("pincode=")),
    search: async (pin = "110001", km?: string) => {
      ($("rv-fas-pin") as HTMLInputElement).value = pin;
      if (km) { const r = $("rv-fas-radius") as HTMLInputElement; r.value = km; r.dispatchEvent(new Event("input")); }
      $("rv-fas-form").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      await flush(14);
    },
    state$: () => (window as any).RvFasState,
  };
  return w;
}
const pointer = (el: Element, type: string, pointerType = "mouse") => {
  const e = new Event(type, { bubbles: type !== "pointerenter" && type !== "pointerleave" });
  Object.defineProperty(e, "pointerType", { value: pointerType });
  el.dispatchEvent(e);
};

beforeEach(() => {
  added = [];
  const orig = document.addEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation(((t: string, l: any, o: any) => { added.push([t, l, o]); orig(t, l, o); }) as any);
});
afterEach(() => {
  const rm = Document.prototype.removeEventListener.bind(document);
  added.forEach(([t, l, o]) => rm(t, l, o)); // listeners of earlier mounts must not leak into the next test
  document.body.innerHTML = "";
  delete (window as any).L;
  vi.restoreAllMocks();
});

describe("category chips", () => {
  it("shows the six categories; the first with data is selected as a tag chip with a clear button; the rest are Coming Soon", async () => {
    const w = await mount();
    expect(w.chips().map((c) => c.textContent)).toEqual(NAMES);
    expect(w.chip("ATL Labs").getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector(".rv-fas-chip-x")!.getAttribute("aria-label")).toBe("Clear ATL Labs");
    expect(document.querySelectorAll(".rv-fas-chip-x")).toHaveLength(1);
    expect(w.$("rv-fas-cats").hidden).toBe(false);
  });
  it("a category without an upload has a dark 'Coming Soon!' tooltip, linked with aria-describedby", async () => {
    const w = await mount();
    for (const n of NAMES.slice(1)) {
      const c = w.chip(n);
      const tip = document.getElementById(c.getAttribute("aria-describedby")!)!;
      expect(tip.getAttribute("role")).toBe("tooltip");
      expect(tip.textContent).toBe("Coming Soon!");
    }
    expect(w.chip("ATL Labs").hasAttribute("aria-describedby")).toBe(false); // an active one needs none
    expect(PANEL).toMatch(/\.rv-fas-chiptip\{[^}]*background:#123f33/); // dark
    expect(PANEL).toMatch(/\.rv-fas-chiptip::after/); // with an arrow
    expect(PANEL).toMatch(/\.rv-fas-chipwrap:hover \.rv-fas-chiptip,\.rv-fas-chipwrap:focus-within \.rv-fas-chiptip/); // hover and keyboard focus
  });
  it("touch: a tap opens the tooltip, a tap elsewhere closes it", async () => {
    const w = await mount();
    w.chip("STEM Labs").click();
    const wrap = () => w.chip("STEM Labs").parentElement!;
    expect(wrap().classList.contains("is-open")).toBe(true);
    pointer(document.body, "pointerdown", "touch");
    expect(document.querySelector(".rv-fas-chipwrap.is-open")).toBeNull();
  });
  it("Escape dismisses a visible chip tooltip", async () => {
    const w = await mount();
    w.chip("STEM Labs").click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".rv-fas-chipwrap.is-open")).toBeNull();
  });
  it("the names are shown as text even when a name carries markup", async () => {
    const evil = cats(["atl-labs"]);
    evil.categories[2].name = "<img src=x onerror=alert(1)>STEM";
    const w = await mount({ categories: evil });
    expect(document.querySelector("#rv-fas-chips img")).toBeNull();
    expect(w.chip("<img src=x onerror=alert(1)>STEM")).toBeTruthy();
  });
  it("clearing the selection falls back to the first category that has data", async () => {
    const w = await mount({ active: ["robotics-labs", "stem-labs"] });
    expect(w.state$().effective.slug).toBe("robotics-labs");
    w.chip("STEM Labs").click();
    expect(w.state$().effective.slug).toBe("stem-labs");
    (document.querySelector(".rv-fas-chip-x") as HTMLElement).click();
    expect(w.state$().selected).toBeNull();
    expect(w.state$().effective.slug).toBe("robotics-labs");
  });
});

describe("Coming Soon", () => {
  it("selecting a category without an upload shows the heading, the card, its pill, text and both buttons, and runs no search", async () => {
    const w = await mount();
    w.chip("STEM Labs").click();
    await flush();
    expect(w.summary()).toBe("Coming Soon! STEM Labs is not available yet.");
    const card = w.$("rv-fas-state");
    expect(card.classList.contains("rv-fas-soon")).toBe(true);
    expect(card.querySelector(".rv-fas-pill")!.textContent).toBe("COMING SOON!");
    expect(card.querySelector("h3")!.textContent).toBe("STEM Labs");
    expect(card.textContent).toContain("This service is not listed on RoboValley yet. Meanwhile, you can search:");
    expect([...card.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["ATL Labs", "Show all services"]);
    // no search runs, even when a PIN code is submitted
    await w.search("110001");
    expect(w.searchUrls()).toHaveLength(0);
    expect(w.summary()).toContain("Coming Soon!");
  });
  it("the 'ATL Labs' button selects the first active category, 'Show all services' clears the selection", async () => {
    const w = await mount();
    w.chip("STEM Labs").click();
    await flush();
    ([...w.$("rv-fas-state").querySelectorAll("button")].find((b) => b.textContent === "ATL Labs") as HTMLButtonElement).click();
    await flush();
    expect(w.state$().selected).toBe("atl-labs");
    expect(w.$("rv-fas-state").classList.contains("rv-fas-soon")).toBe(false);
    w.chip("STEM Labs").click();
    await flush();
    ([...w.$("rv-fas-state").querySelectorAll("button")].find((b) => b.textContent === "Show all services") as HTMLButtonElement).click();
    await flush();
    expect(w.state$().selected).toBeNull();
    expect(w.state$().effective.slug).toBe("atl-labs");
    expect(w.chips().every((c) => c.getAttribute("aria-pressed") === "false")).toBe(true);
  });
  it("shows no count for a category without an upload", async () => {
    const w = await mount();
    expect(w.chip("STEM Labs").textContent).toBe("STEM Labs");
    expect(w.state$().categories.find((c: any) => c.slug === "stem-labs").count).toBe(0);
  });
  it("it turns active by itself once a file is uploaded for it (the next category refresh)", async () => {
    let active = ["atl-labs"];
    const w = await mount();
    (window as any).fetch = vi.fn(async (u: string) => (String(u).includes("categories") ? ok(cats(active)) : ok(dirPage(10, 10, "STEM Labs"))));
    w.chip("STEM Labs").click();
    await flush();
    expect(w.summary()).toContain("Coming Soon!");
    active = ["atl-labs", "stem-labs"];
    document.dispatchEvent(new CustomEvent("rv-dir-refresh"));
    await flush(14);
    expect(w.state$().effective).toMatchObject({ slug: "stem-labs", active: true });
    expect(w.$("rv-fas-state").classList.contains("rv-fas-soon")).toBe(false);
  });
});

describe("directory heading, count and placeholders follow the category", () => {
  it.each(NAMES.map((n, i) => [n, SLUGS[i]]))("%s", async (name, slug) => {
    const w = await mount({ active: [slug], dir: () => dirPage(9716, 12, name) });
    expect(w.$("rv-fas-dir-h").textContent).toBe(`${name} directory`);
    expect(w.$("rv-fas-dir-sub").textContent).toBe(`Search ${name} by name and location`);
    expect((w.$("rv-fas-dir-q") as HTMLInputElement).placeholder).toBe(`Search ${name} by name`);
    expect(w.$("rv-fas-dir-summary").textContent).toBe(`Showing 1–12 of 9,716 ${name}`);
    expect(w.dirUrls()[0]).toContain(`category=${slug}`);
  });
  it("shows the uploaded rows as cards with 'All details' and a pager", async () => {
    const w = await mount({ dir: () => ({ ...dirPage(9716), results: [{ id: "1", schoolName: "Row One", state: "S", district: "D", pincode: "110001", udiseCode: "U1", details: { A: "1", B: "2" } }] }) });
    expect(w.$("rv-fas-dir-list").textContent).toContain("Row One");
    expect(w.$("rv-fas-dir-list").querySelector("summary")!.textContent).toBe("All details");
    expect(w.$("rv-fas-dir-pager").hidden).toBe(false);
    expect(w.$("rv-fas-dir-page").textContent).toBe("Page 1 of 810");
  });
  it("nothing uploaded in any category: heading 'Directory' and 'No data uploaded yet', and no data request", async () => {
    const w = await mount({ active: [] });
    expect(w.$("rv-fas-dir-h").textContent).toBe("Directory");
    expect(w.$("rv-fas-dir-state").textContent).toContain("No data uploaded yet");
    expect(w.dirUrls()).toHaveLength(0);
    expect(DIRECTORY).not.toMatch(/School directory/);
  });
  it("a Coming Soon category: its heading, 'No data uploaded yet', and no data request", async () => {
    const w = await mount();
    const before = w.dirUrls().length;
    w.chip("Innovation Centres").click();
    await flush();
    expect(w.$("rv-fas-dir-h").textContent).toBe("Innovation Centres directory");
    expect(w.$("rv-fas-dir-state").textContent).toContain("No data uploaded yet");
    expect(w.dirUrls()).toHaveLength(before);
  });
  it("switching category updates heading, count and cards without reloading the page", async () => {
    const w = await mount({ active: ["atl-labs", "stem-labs"], dir: (u) => (u.includes("category=stem-labs") ? dirPage(40, 12, "STEM Labs") : dirPage(9716, 12, "ATL Labs")) });
    const list = w.$("rv-fas-dir-list");
    w.chip("STEM Labs").click();
    await flush();
    expect(w.$("rv-fas-dir-h").textContent).toBe("STEM Labs directory");
    expect(w.$("rv-fas-dir-summary").textContent).toBe("Showing 1–12 of 40 STEM Labs");
    expect(w.$("rv-fas-dir-list")).toBe(list); // same element: nothing was reloaded
    expect(w.dirUrls().at(-1)).toContain("category=stem-labs");
  });
  it("search by name and by location use the chosen category, and zero results say so", async () => {
    const w = await mount({ dir: (u) => (u.includes("q=zzz") ? { ...dirPage(0, 0), total: 0 } : dirPage(9716)) });
    (w.$("rv-fas-dir-q") as HTMLInputElement).value = "zzz";
    w.$("rv-fas-dir-form").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await flush();
    expect(w.dirUrls().at(-1)).toMatch(/category=atl-labs&q=zzz&location=&page=1&pageSize=12/);
    expect(w.$("rv-fas-dir-summary").textContent).toBe("0 ATL Labs found");
  });
  it("uploaded text in the cards is plain text", async () => {
    const evil = "<img src=x onerror=alert(1)><script>alert(2)</script>";
    const w = await mount({ dir: () => ({ ...dirPage(1, 0), results: [{ id: "1", schoolName: evil, state: "<b>S</b>", district: "D", pincode: "1", udiseCode: null, details: {} }] }) });
    expect(w.$("rv-fas-dir-list").querySelector("img, script, b")).toBeNull();
    expect(w.$("rv-fas-dir-list").textContent).toContain(evil);
  });
});

describe("search results use the chosen category", () => {
  it("the search request carries the category and the page says which", async () => {
    const w = await mount({ active: ["atl-labs", "stem-labs"] });
    await w.search("110001", "10");
    expect(w.searchUrls()[0]).toBe(`${API}/api/services/search?pincode=110001&radius=10&category=atl-labs`);
    w.chip("STEM Labs").click();
    await flush(14);
    expect(w.searchUrls().at(-1)).toContain("category=stem-labs"); // the same PIN code, searched again for the other category, no reload
    expect(w.searchUrls().at(-1)).toContain("pincode=110001");
  });
  it("with the categories API down the page still works (the server picks its default category)", async () => {
    const w = await mount({ categories: { success: false } });
    await w.search("110001");
    expect(w.searchUrls()[0]).not.toContain("category=");
    expect(w.cards().length).toBeGreaterThan(0);
  });
});

describe("tooltips", () => {
  it("one school at a point: name, district, pincode", async () => {
    const w = await mount({ search: () => near([school()]) });
    await w.search();
    const m = calls.markers[0].el as HTMLElement;
    pointer(m, "pointerenter");
    expect(w.tip().getAttribute("role")).toBe("tooltip");
    expect(w.tipText()).toBe("A SchoolNew Delhi · 110001");
    expect(m.getAttribute("aria-describedby")).toBe("rv-fas-tip");
  });
  it("several schools at one point: area line, how many, a numbered list and '+N more'", async () => {
    const w = await mount();
    await w.search();
    pointer(calls.markers[0].el, "pointerenter");
    const t = w.tipText();
    expect(t).toContain("New Delhi, 110001");
    expect(t).toContain("4 ATL Labs here");
    expect(t).toContain("1. A School");
    expect(t).toContain("2. Second School");
    expect(t).toContain("3. Third School");
    expect(t).not.toContain("Fourth School");
    expect(t).toContain("+1 more");
  });
  it("nearby facilities: 'Near <pincode, district>' then nearest first with distances", async () => {
    const w = await mount();
    await w.search();
    pointer((calls as any).origin.el, "pointerenter");
    const t = w.tipText();
    expect(t.startsWith("Near 110001, New Delhi")).toBe(true);
    expect(t).toContain("1. A School – Same PIN code");
    expect(t.indexOf("1. A School")).toBeLessThan(t.indexOf("2. Second School"));
    expect(t).toContain("+2 more");
    const near2 = await mount({ search: () => near([school({ id: "9", schoolName: "Far One", distanceKm: 12.4, pincode: "110003", district: "North" })]) });
    await near2.search();
    pointer((calls as any).origin.el, "pointerenter");
    expect(near2.tipText()).toContain("1. Far One – 12 km");
  });
  it("a row shows the same tooltip as its marker", async () => {
    const w = await mount();
    await w.search();
    pointer(w.cards()[1], "pointerenter");
    expect(w.tipText()).toContain("4 ATL Labs here");
    const lone = w.cards()[4];
    pointer(lone, "pointerenter");
    expect(w.tipText()).toContain("Near School");
    expect(w.tipText()).toContain("3.6 km away");
  });
  it("marker numbers match the list numbers", async () => {
    const w = await mount();
    await w.search();
    const label = (m: any) => m.el.querySelector(".rv-fas-pin > span").textContent;
    expect(calls.markers.map(label)).toEqual(["1", "5"]);
    expect(w.cards().map((c) => c.querySelector(".rv-fas-rank")!.textContent)).toEqual(["1", "2", "3", "4", "5"]);
    expect(w.cards()[4].querySelector(".rv-fas-rank")!.textContent).toBe(label(calls.markers[1])); // Near School: row 5, marker 5
  });
  it("hovering a marker highlights its rows and scales the marker; hovering a row does the reverse", async () => {
    const w = await mount();
    await w.search();
    const pin0 = calls.markers[0].el.querySelector(".rv-fas-pin") as HTMLElement;
    pointer(calls.markers[0].el, "pointerenter");
    expect(pin0.classList.contains("is-hover")).toBe(true);
    expect(w.cards().slice(0, 4).every((c) => c.classList.contains("is-hover"))).toBe(true);
    expect(w.cards()[4].classList.contains("is-hover")).toBe(false);
    pointer(calls.markers[0].el, "pointerleave");
    expect(pin0.classList.contains("is-hover")).toBe(false);
    pointer(w.cards()[4], "pointerenter");
    expect((calls.markers[1].el.querySelector(".rv-fas-pin") as HTMLElement).classList.contains("is-hover")).toBe(true);
    expect(RESULTS).toMatch(/\.rv-fas-pin\.is-hover\{[^}]*scale\(1\.25\)/);
  });
  it("keyboard: markers and rows are focusable, focus shows the tooltip, Escape closes it", async () => {
    const w = await mount();
    await w.search();
    expect(calls.markers[0].el.tabIndex).toBe(0);
    expect(w.cards().every((c) => c.tabIndex === 0)).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    calls.markers[0].el.dispatchEvent(new Event("focus"));
    expect(w.tipText()).toContain("4 ATL Labs here");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(w.tip().hidden).toBe(true);
    w.cards()[0].dispatchEvent(new Event("focus"));
    expect(w.tip().hidden).toBe(false);
    w.cards()[0].dispatchEvent(new Event("blur"));
    await sleep(130);
    expect(w.tip().hidden).toBe(true);
  });
  it("keyboard: Enter on a marker or a row does the click action", async () => {
    const w = await mount();
    await w.search();
    calls.markers[1].el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(calls.popups).toHaveLength(1);
    w.cards()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(calls.popups).toHaveLength(2);
  });
  it("touch: the first tap shows the tooltip only, the second tap closes it and opens the popup, a tap elsewhere closes it", async () => {
    const w = await mount();
    await w.search();
    const m = calls.markers[1].el as HTMLElement;
    pointer(m, "pointerdown", "touch");
    m.click();
    expect(w.tipText()).toContain("Near School");
    expect(calls.popups).toHaveLength(0);
    pointer(m, "pointerdown", "touch");
    m.click();
    expect(w.tip().hidden).toBe(true);
    expect(calls.popups).toHaveLength(1);
    pointer(m, "pointerdown", "touch");
    m.click();
    expect(w.tip().hidden).toBe(false);
    pointer(document.body, "pointerdown", "touch");
    expect(w.tip().hidden).toBe(true);
    // a row works the same way
    const row = w.cards()[4];
    pointer(row, "pointerdown", "touch");
    row.click();
    expect(w.tip().hidden).toBe(false);
  });
  it("the tooltip never intercepts the pointer, stays inside the viewport and is a single linked element", async () => {
    const w = await mount();
    await w.search();
    pointer(calls.markers[0].el, "pointerenter");
    expect(RESULTS).toMatch(/\.rv-fas\.rv-fas-tip\{[^}]*pointer-events:none/);
    expect(parseFloat(w.tip().style.left)).toBeGreaterThanOrEqual(8);
    expect(document.querySelectorAll("#rv-fas-tip")).toHaveLength(1);
    expect(w.cards()[0].getAttribute("aria-describedby")).toBe("rv-fas-tip");
  });
  it("moving from a marker to its row replaces the tooltip instead of flickering", async () => {
    const w = await mount();
    await w.search();
    pointer(calls.markers[0].el, "pointerenter");
    pointer(calls.markers[0].el, "pointerleave");
    pointer(w.cards()[0], "pointerenter");
    await sleep(130);
    expect(w.tip().hidden).toBe(false);
  });
  it("uploaded text in a tooltip is plain text (a school named with <script>)", async () => {
    const evil = "<img src=x onerror=alert(1)><script>alert(2)</script>";
    const w = await mount({ search: () => near([school({ schoolName: evil, district: "<b>D</b>" })]) });
    await w.search();
    pointer(calls.markers[0].el, "pointerenter");
    expect(w.tip().querySelector("img, script, b")).toBeNull();
    expect(w.tipText()).toContain(evil);
    expect(w.tipText()).toContain("<b>D</b>");
  });
  it("tooltips are built with DOM calls, never innerHTML", () => {
    for (const h of [PANEL, RESULTS, DIRECTORY]) for (const s of scriptsOf(h)) expect(s).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write|bindPopup/);
  });
});

describe("click", () => {
  it("a marker flies to the exact location, opens the popup with the school's details and highlights the row", async () => {
    const w = await mount({ search: () => near([school(), school({ id: "5", schoolName: "Near School", pincode: "110002", district: "Central Delhi", distanceKm: 3.6, lat: 28.64, lng: 77.23, udiseCode: "U5", details: { "ATL UID Code": "ATL-005" } })]) });
    await w.search();
    calls.markers[1].el.click();
    expect(calls.flyTo.at(-1)[0]).toEqual([28.64, 77.23]);
    expect(calls.flyTo.at(-1)[1]).toBeGreaterThanOrEqual(14);
    const pop = calls.popups[0].content as HTMLElement;
    expect(pop.querySelector("h4")!.textContent).toBe("Near School");
    const txt = pop.textContent!;
    for (const part of ["ATL UID", "ATL-005", "UDISE code", "U5", "District", "Central Delhi", "PIN code", "110002", "Distance", "3.6 km"]) expect(txt).toContain(part);
    expect(w.cards()[1].classList.contains("is-selected")).toBe(true);
    expect(w.cards()[0].classList.contains("is-selected")).toBe(false);
  });
  it("a row click does the same (and nothing reloads: same list element)", async () => {
    const w = await mount();
    await w.search();
    const list = w.$("rv-fas-list");
    w.cards()[4].click();
    expect(calls.flyTo.at(-1)[0]).toEqual([28.64, 77.23]);
    expect(calls.popups).toHaveLength(1);
    expect(w.$("rv-fas-list")).toBe(list);
  });
  it("a marker with several schools lists all of them in a scrollable popup, and clicking one focuses it", async () => {
    const w = await mount();
    await w.search();
    calls.markers[0].el.click();
    const pop = calls.popups[0].content as HTMLElement;
    expect(pop.querySelector("h4")!.textContent).toBe("4 schools in PIN code 110001");
    const items = [...pop.querySelectorAll<HTMLButtonElement>(".rv-fas-pop-item")];
    expect(items.map((b) => b.textContent)).toEqual(["1. A School", "2. Second School", "3. Third School", "4. Fourth School"]);
    expect(RESULTS).toMatch(/\.rv-fas-pop-list\{[^}]*overflow:auto/);
    items[2].click();
    expect(pop.querySelector(".rv-fas-pop-detail h4")!.textContent).toBe("Third School");
    expect(items[2].getAttribute("aria-current")).toBe("true");
    expect(w.cards().filter((c) => c.classList.contains("is-selected")).map((c) => c.querySelector("h3")!.textContent)).toEqual(["Third School"]);
  });
  it("the popup pans itself into view, and its list is capped at 130 px on phones", async () => {
    const w = await mount();
    await w.search();
    calls.markers[0].el.click();
    expect(calls.popups[0].o).toMatchObject({ autoPan: true, autoPanPadding: [16, 16] });
    expect(RESULTS).toMatch(/@media \(max-width:640px\)\{\.rv-fas-pop-list\{max-height:130px\}\}/);
  });
  it("the popup opens when the flight lands (a popup opened before flyTo is closed by the move)", async () => {
    const w = await mount();
    await w.search();
    (calls as any).onceMoveEnd = undefined;
    const before = calls.popups.length;
    calls.markers[0].el.click();
    expect(calls.flyTo.length).toBeGreaterThan(0);
    expect(calls.popups.length).toBe(before + 1);
    expect(RESULTS).toContain("map.once( 'moveend', open )");
  });
  it("a popup is plain text too", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    const w = await mount({ search: () => near([school({ schoolName: evil, details: { "ATL UID Code": "<b>x</b>" } })]) });
    await w.search();
    calls.markers[0].el.click();
    const pop = calls.popups[0].content as HTMLElement;
    expect(pop.querySelector("img, b, script")).toBeNull();
    expect(pop.textContent).toContain(evil);
  });
});

describe("range, circle and zoom", () => {
  it("a new PIN code flies to the circle; the circle has the chosen radius", async () => {
    const w = await mount();
    await w.search("110001", "10");
    expect(calls.circle[0].o.radius).toBe(10000);
    expect(calls.flyToBounds).toHaveLength(1);
    expect(calls.flyToBounds[0][1]).toMatchObject({ padding: [24, 24], maxZoom: 15 });
  });
  it("moving the slider redraws the circle at once, refits the view with padding and zoom limits, and keeps the PIN code and range", async () => {
    const w = await mount();
    await w.search("110001", "10");
    const fits = calls.fit.length;
    const r = w.$("rv-fas-radius") as HTMLInputElement;
    r.value = "40";
    r.dispatchEvent(new Event("input"));
    expect(calls.circle[0].o.radius).toBe(40000);
    expect(calls.fit).toHaveLength(fits + 1);
    expect(calls.fit.at(-1)[1]).toMatchObject({ padding: [24, 24], maxZoom: 15 });
    expect((w.$("rv-fas-pin") as HTMLInputElement).value).toBe("110001");
    await sleep(320);
    await flush();
    expect(w.searchUrls().at(-1)).toContain("radius=40");
    expect(w.$("rv-fas-radius-out").textContent).toBe("40 km");
    expect(RESULTS).toContain("minZoom: 4");
  });
  it("manual zoom is left alone: nothing refits until the range changes or a new search runs", async () => {
    const w = await mount();
    await w.search("110001", "10");
    const total = () => calls.fit.length + calls.flyToBounds.length + calls.views.length;
    const n = total();
    await sleep(400);
    await flush();
    expect(total()).toBe(n);
  });
  it("1 km with nothing in range: 'No schools within 1 km. Try a larger range.' and a button for 50 km; the map shows no markers", async () => {
    const w = await mount({ search: () => near([], { total: 0 }) });
    await w.search("110001", "1");
    expect(w.state()).toContain("No schools within 1 km. Try a larger range.");
    expect(calls.markers).toHaveLength(0);
    expect(calls.circle).toHaveLength(1);
  });
  it("only the current results are on the map (nearest first, at most 50 rows)", async () => {
    const many = Array.from({ length: 50 }, (_v, i) => school({ id: String(i), schoolName: `S${i}`, pincode: String(110100 + i), distanceKm: i, lat: 28 + i / 100, lng: 77 }));
    const w = await mount({ search: () => near(many, { total: 130 }) });
    await w.search("110001", "50");
    expect(w.cards()).toHaveLength(50);
    expect(calls.markers).toHaveLength(50);
    expect(w.summary()).toContain("showing the nearest 50");
    expect(w.cards().map((c) => c.querySelector(".rv-fas-rank")!.textContent)).toEqual(many.map((_v, i) => String(i + 1)));
  });
});

describe("empty and error states keep the map working", () => {
  it("no data at all: the map renders over India with no markers", async () => {
    const w = await mount({ active: [], search: () => ({ success: true, dataset: null, category: null, total: 0, page: 1, pageSize: 50, results: [] }) });
    expect(w.summary()).toBe("No data uploaded yet.");
    expect(calls.markers).toHaveLength(0);
    await w.search("110001");
    expect(w.state()).toContain("No data uploaded yet");
  });
  it("an invalid PIN code never reaches the API", async () => {
    const w = await mount();
    await w.search("12345");
    expect(w.searchUrls()).toHaveLength(0);
    expect(w.$("rv-fas-pin-err").hidden).toBe(false);
  });
  it("an unknown PIN code: a clear message and no circle", async () => {
    const w = await mount({ search: () => near([], { total: 0, near: { center: null, pincodeKnown: false, radiusKm: 25, limit: 50 } }) });
    (window as any).fetch = vi.fn(async (u: string) => (String(u).includes("nominatim") ? ok([]) : String(u).includes("categories") ? ok(cats(["atl-labs"])) : ok(near([], { total: 0, near: { center: null, pincodeKnown: false, radiusKm: 25, limit: 50 } }))));
    await w.search("100001");
    await sleep(1250);
    await flush();
    expect(w.state()).toContain("We could not find PIN code 100001");
    expect(calls.circle).toHaveLength(0);
  });
  it("the API fails: an error with Try again, no stale results, the map is still there", async () => {
    const w = await mount({ search: () => { throw new Error("down"); } });
    await w.search("110001");
    expect(w.state()).toContain("not available right now");
    expect(w.cards()).toHaveLength(0);
    expect(w.$("rv-fas-map")).not.toBeNull();
  });
});
