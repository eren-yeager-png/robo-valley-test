// @vitest-environment jsdom
// Find a Service: the Service combobox (widget 01), its sync with the chips, "Choose a service to search", the version marker and the
// layout padding in the page JSON. Widgets 01 and 03 run together; Leaflet and the network are faked. Aliases and counts come from the
// (faked) /api/services/categories answer: the widgets hold no service list of their own.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeLeaflet, newCalls, type Calls } from "./helpers/fakeLeaflet";

const DIR = join(__dirname, "../frontend/elementor/find-a-service-510");
const PANEL = readFileSync(join(DIR, "widgets/01-search-panel.a51f0c7.html"), "utf8");
const RESULTS = readFileSync(join(DIR, "widgets/03-results-map-script.a51f0d3.html"), "utf8");
const JSONTXT = readFileSync(join(DIR, "find-a-service-510.elementor.json"), "utf8");
const scriptsOf = (h: string) => [...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const markup = (h: string) => h.replace(/<script>[\s\S]*?<\/script>/g, "").replace(/<style>[\s\S]*?<\/style>/g, "");
const settle = () => new Promise((r) => setTimeout(r, 0));
const flush = async (n = 12) => { for (let i = 0; i < n; i++) await settle(); };

const API = "https://app.techytree.in";
const SVC: Array<[string, string, string[], number]> = [
  ["atl-labs", "ATL Labs", ["atl", "atal tinkering", "tinkering"], 9699],
  ["robotics-labs", "Robotics Labs", ["robot", "robotics", "lab", "labs"], 1],
  ["stem-labs", "STEM Labs", ["stem", "science", "lab", "labs"], 0],
  ["3d-printing-facilities", "3D Printing Facilities", ["3d", "printing", "printer"], 0],
  ["robotics-training-centres", "Robotics Training Centres", ["robot", "training", "coaching"], 340],
  ["innovation-centres", "Innovation Centres", ["innovation"], 0],
];
const cats = (over: Record<string, Record<string, unknown>> = {}) => ({
  success: true, defaultSlug: "atl-labs",
  categories: SVC.map(([slug, name, aliases, count]) => ({ slug, name, aliases, active: count > 0, count, uploadedAt: null, isDemo: false, ...(over[slug] ?? {}) })),
});
const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
const school = (over: Record<string, unknown> = {}) => ({ id: "1", schoolName: "A School", state: "Delhi", district: "New Delhi", pincode: "110001", udiseCode: "U1", details: {}, distanceKm: 0, lat: 28.6, lng: 77.2, ...over });
const near = (results: unknown[]) => ({ success: true, dataset: { id: "1" }, category: { slug: "atl-labs", name: "ATL Labs", active: true }, total: (results as any[]).length, page: 1, pageSize: 50, results, near: { center: { lat: 28.6, lng: 77.2 }, pincodeKnown: true, radiusKm: 25, limit: 50 } });

let added: Array<[string, any, any]> = [];
let calls: Calls;
let fetchMock: ReturnType<typeof vi.fn>;
let geo: { getCurrentPosition: ReturnType<typeof vi.fn>; watchPosition: ReturnType<typeof vi.fn> };

async function mount(over: Record<string, Record<string, unknown>> = {}, categories: unknown = null) {
  document.body.innerHTML = markup(PANEL) + markup(RESULTS);
  calls = newCalls();
  fakeLeaflet(calls);
  (Element.prototype as any).scrollIntoView = vi.fn();
  delete (window as any).RvFasState;
  (window as any).RoboValleyApi = { base: API };
  geo = { getCurrentPosition: vi.fn(), watchPosition: vi.fn() };
  Object.defineProperty(navigator, "geolocation", { value: geo, configurable: true });
  window.matchMedia = window.matchMedia || ((() => ({ matches: false, addEventListener() {}, addListener() {} })) as any);
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/services/categories")) return ok(categories ?? cats(over));
    if (u.includes("/api/services/search")) return ok(near([school()]));
    throw new Error("unexpected " + u);
  });
  (window as any).fetch = fetchMock;
  for (const h of [PANEL, RESULTS]) for (const s of scriptsOf(h)) (0, eval)(s);
  await flush();
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  const input = $("rv-fas-service") as HTMLInputElement;
  const w = {
    $, input,
    list: () => $("rv-fas-listbox"),
    opts: () => [...document.querySelectorAll<HTMLElement>("#rv-fas-listbox [role=option]")],
    rows: () => [...document.querySelectorAll<HTMLElement>("#rv-fas-listbox [role=option]:not([aria-disabled])")],
    names: () => w.rows().map((o) => o.querySelector(".rv-fas-opt-name")!.textContent),
    type: (v: string) => { input.value = v; input.dispatchEvent(new Event("input", { bubbles: true })); },
    key: (k: string) => input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })),
    chips: () => [...document.querySelectorAll<HTMLButtonElement>(".rv-fas-chip")],
    st: () => (window as any).RvFasState,
    search: async (loc = "110001") => { ($("rv-fas-location") as HTMLInputElement).value = loc; $("rv-fas-form").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true })); await flush(14); },
  };
  return w;
}

beforeEach(() => {
  added = [];
  const orig = document.addEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation(((t: string, l: any, o: any) => { added.push([t, l, o]); orig(t, l, o); }) as any);
});
afterEach(() => {
  const rm = Document.prototype.removeEventListener.bind(document);
  added.forEach(([t, l, o]) => rm(t, l, o));
  document.body.innerHTML = "";
  delete (window as any).L;
  vi.restoreAllMocks();
});

describe("the list", () => {
  it("opens on focus with all six services in the API's order, each with its unique 'N facilities' or a muted 'Coming Soon!'", async () => {
    const w = await mount();
    expect(w.list().hidden).toBe(true);
    w.input.dispatchEvent(new Event("focus"));
    expect(w.list().hidden).toBe(false);
    expect(w.input.getAttribute("aria-expanded")).toBe("true");
    expect(w.names()).toEqual(["ATL Labs", "Robotics Labs", "STEM Labs", "3D Printing Facilities", "Robotics Training Centres", "Innovation Centres"]);
    const meta = w.rows().map((o) => o.querySelector(".rv-fas-opt-meta")!.textContent);
    expect(meta).toEqual(["9,699 facilities", "1 facility", "Coming Soon!", "Coming Soon!", "340 facilities", "Coming Soon!"]);
    expect(w.rows()[2].classList.contains("rv-fas-opt--soon")).toBe(true);
    expect(w.rows()[0].classList.contains("rv-fas-opt--soon")).toBe(false);
  });
  it("shows 'demo' only for a service the API marks isDemo", async () => {
    const w = await mount({ "atl-labs": { isDemo: true } });
    w.input.dispatchEvent(new Event("focus"));
    const meta = w.rows().map((o) => o.querySelector(".rv-fas-opt-meta")!.textContent);
    expect(meta[0]).toBe("9,699 facilities · demo");
    expect(meta[4]).toBe("340 facilities");
  });
  it("matches the start of a word in the name or an alias, and puts the matched letters in bold", async () => {
    const w = await mount();
    w.type("rob");
    expect(w.names()).toEqual(["Robotics Labs", "Robotics Training Centres"]);
    expect(w.rows()[0].querySelector("strong")!.textContent).toBe("Rob");
    w.type("tinker"); // an alias of ATL Labs
    expect(w.names()).toEqual(["ATL Labs"]);
    w.type("3d");
    expect(w.names()).toEqual(["3D Printing Facilities"]);
    w.type("pri"); // 'Printing' (name word) and 'printer' (alias)
    expect(w.names()).toEqual(["3D Printing Facilities"]);
    expect(w.rows()[0].querySelector("strong")!.textContent).toBe("Pri");
  });
  it("does not match the middle of a word", async () => {
    const w = await mount();
    w.type("otics");
    expect(w.rows().map((o) => o.querySelector(".rv-fas-opt-name")!.textContent)).toEqual(["ATL Labs", "Robotics Labs", "STEM Labs", "3D Printing Facilities", "Robotics Training Centres", "Innovation Centres"]); // fallback: all, after the no-match row
    expect(w.opts()[0].textContent).toContain("No service matches");
  });
  it("ranks every-word matches first: 'robot lab' puts Robotics Labs first and Robotics Training Centres lower, then the Labs", async () => {
    const w = await mount();
    w.type("robot lab");
    expect(w.names()).toEqual(["Robotics Labs", "Robotics Training Centres", "ATL Labs", "STEM Labs"]);
  });
  it("ignores filler words ('labs near me' finds the labs; only filler shows the whole list)", async () => {
    const w = await mount();
    w.type("labs near me");
    expect(w.names()).toEqual(["ATL Labs", "Robotics Labs", "STEM Labs"]);
    w.type("near me");
    expect(w.names()).toHaveLength(6);
    expect(w.opts().some((o) => o.textContent!.includes("No service matches"))).toBe(false);
  });
  it("aliases come from the API: change them there and the list follows (no list in the widget)", async () => {
    const w = await mount({ "innovation-centres": { aliases: ["incubator"] } });
    w.type("incub");
    expect(w.names()).toEqual(["Innovation Centres"]);
    w.type("innov"); // still matches the name
    expect(w.names()).toEqual(["Innovation Centres"]);
    expect(PANEL).not.toMatch(/atal tinkering|coaching|incubator/i);
    expect(RESULTS).not.toMatch(/atal tinkering|coaching/i);
  });
  it("no match: a 'No service matches' row (not selectable) and the full list under it", async () => {
    const w = await mount();
    w.type("zzz");
    const first = w.opts()[0];
    expect(first.textContent).toBe("No service matches “zzz”");
    expect(first.getAttribute("aria-disabled")).toBe("true");
    expect(w.names()).toHaveLength(6);
    w.key("Enter"); // nothing to choose
    expect(w.st().selected).toBeNull();
  });
});

describe("keyboard and ARIA", () => {
  it("role=combobox with aria-controls, aria-expanded and aria-activedescendant following Up/Down/Home/End (wrapping); options are role=option in a listbox", async () => {
    const w = await mount();
    expect(w.input.getAttribute("role")).toBe("combobox");
    expect(w.input.getAttribute("aria-controls")).toBe("rv-fas-listbox");
    expect(w.list().getAttribute("role")).toBe("listbox");
    w.key("ArrowDown"); // opens and goes to the first
    expect(w.input.getAttribute("aria-expanded")).toBe("true");
    const id = () => w.input.getAttribute("aria-activedescendant");
    expect(id()).toBe(w.rows()[0].id);
    expect(w.rows()[0].getAttribute("aria-selected")).toBe("true");
    w.key("ArrowDown"); expect(id()).toBe(w.rows()[1].id);
    w.key("End"); expect(id()).toBe(w.rows()[5].id);
    w.key("ArrowDown"); expect(id()).toBe(w.rows()[0].id); // wraps
    w.key("ArrowUp"); expect(id()).toBe(w.rows()[5].id);
    w.key("Home"); expect(id()).toBe(w.rows()[0].id);
  });
  it("Enter chooses the highlighted service, fills the box, closes the list and keeps focus", async () => {
    const w = await mount();
    w.input.focus();
    w.key("ArrowDown"); w.key("ArrowDown");
    w.key("Enter");
    expect(w.st().selected).toBe("robotics-labs");
    expect(w.input.value).toBe("Robotics Labs");
    expect(w.list().hidden).toBe(true);
    expect(w.input.getAttribute("aria-expanded")).toBe("false");
    expect(w.input.hasAttribute("aria-activedescendant")).toBe(false);
    expect(document.activeElement).toBe(w.input);
  });
  it("Enter on typed text with nothing highlighted chooses the best match", async () => {
    const w = await mount();
    w.type("innov");
    w.key("Enter");
    expect(w.st().selected).toBe("innovation-centres");
  });
  it("Escape closes the list; Escape again clears the box and the choice", async () => {
    const w = await mount();
    w.type("rob");
    w.key("Escape");
    expect(w.list().hidden).toBe(true);
    expect(w.input.value).toBe("rob");
    w.key("ArrowDown"); w.key("Enter");
    expect(w.st().selected).toBe("robotics-labs");
    w.key("Escape"); // closed already: clears
    expect(w.input.value).toBe("");
    expect(w.st().selected).toBeNull();
  });
  it("a click on an option chooses it; a click outside, or Tab, closes the list", async () => {
    const w = await mount();
    w.input.dispatchEvent(new Event("focus"));
    w.rows()[4].click();
    expect(w.st().selected).toBe("robotics-training-centres");
    expect(w.input.value).toBe("Robotics Training Centres");
    expect(w.list().hidden).toBe(true);
    w.input.dispatchEvent(new Event("click"));
    expect(w.list().hidden).toBe(false);
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(w.list().hidden).toBe(true);
    w.input.dispatchEvent(new Event("click"));
    w.key("Tab");
    expect(w.list().hidden).toBe(true);
  });
  it("announces the number of matches in a polite live region", async () => {
    const w = await mount();
    const live = w.$("rv-fas-service-count");
    expect(live.getAttribute("aria-live")).toBe("polite");
    w.input.dispatchEvent(new Event("focus"));
    expect(live.textContent).toBe("6 services available");
    w.type("rob");
    expect(live.textContent).toBe("2 services match rob");
    w.type("tinker");
    expect(live.textContent).toBe("1 service matches tinker");
    w.type("zzz");
    expect(live.textContent).toBe("No service matches zzz. Showing all 6 services.");
  });
  it("the clear (x) button shows only when there is text, empties the box and the choice, and focuses the box", async () => {
    const w = await mount();
    const x = w.$("rv-fas-service-clear") as HTMLButtonElement;
    expect(x.hidden).toBe(true);
    w.type("rob");
    expect(x.hidden).toBe(false);
    expect(x.getAttribute("aria-label")).toBe("Clear service");
    w.key("ArrowDown"); w.key("Enter");
    x.click();
    expect(w.input.value).toBe("");
    expect(w.st().selected).toBeNull();
    expect(x.hidden).toBe(true);
    expect(document.activeElement).toBe(w.input);
  });
});

describe("the chips and the box stay in step", () => {
  it("nothing is chosen at the start (no silent default) although the API names a defaultSlug", async () => {
    const w = await mount();
    expect(w.input.value).toBe("");
    expect(w.st().selected).toBeNull();
    expect(w.chips().every((c) => c.getAttribute("aria-pressed") === "false")).toBe(true);
  });
  it("choosing in the box presses the chip; clicking a chip fills the box; the chip's x empties both; typing drops the choice", async () => {
    const w = await mount();
    w.type("stem"); w.key("ArrowDown"); w.key("Enter");
    expect(w.chips().find((c) => c.textContent === "STEM Labs")!.getAttribute("aria-pressed")).toBe("true");
    w.chips().find((c) => c.textContent === "ATL Labs")!.click();
    expect(w.input.value).toBe("ATL Labs");
    expect(w.st().selected).toBe("atl-labs");
    w.type("ro");
    expect(w.st().selected).toBeNull();
    expect(w.chips().every((c) => c.getAttribute("aria-pressed") === "false")).toBe(true);
    w.chips().find((c) => c.textContent === "ATL Labs")!.click();
    (document.querySelector(".rv-fas-chip-x") as HTMLButtonElement).click();
    expect(w.input.value).toBe("");
    expect(w.st().selected).toBeNull();
  });
});

describe("Search", () => {
  it("with no service: shows 'Choose a service to search', focuses the box and sends no search", async () => {
    const w = await mount();
    await w.search("110001");
    const err = w.$("rv-fas-service-err");
    expect(err.hidden).toBe(false);
    expect(err.textContent).toBe("Choose a service to search");
    expect(w.input.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(w.input);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/search"))).toHaveLength(0);
    w.type("atl"); expect(err.hidden).toBe(true); // the message goes away when the visitor acts
  });
  it("with a service but no location: the Location box shows its message and no search is sent", async () => {
    const w = await mount();
    w.chips()[0].click();
    await w.search("");
    expect(w.$("rv-fas-loc-err").textContent).toBe("Enter a PIN code, district or state.");
    expect(w.$("rv-fas-location")).toBe(document.activeElement);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/search"))).toHaveLength(0);
  });
  it("with a service and a PIN code: the search carries the chosen service", async () => {
    const w = await mount();
    w.type("robot lab"); w.key("ArrowDown"); w.key("Enter");
    await w.search("110001");
    const u = new URL(fetchMock.mock.calls.map((c) => String(c[0])).find((x) => x.includes("/search"))!);
    expect(u.searchParams.get("category")).toBe("robotics-labs");
    expect(u.searchParams.get("pincode")).toBe("110001");
  });
  it("choosing a Coming Soon service shows the friendly empty state and runs no search", async () => {
    const w = await mount();
    w.type("stem"); w.key("ArrowDown"); w.key("Enter");
    await flush();
    expect(w.$("rv-fas-state").textContent).toContain("COMING SOON!");
    expect(w.$("rv-fas-summary").textContent).toContain("Coming Soon!");
    await w.search("110001");
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/search"))).toHaveLength(0);
  });
  it("clearing the service after a search empties the results (no silent default service)", async () => {
    const w = await mount();
    w.chips()[0].click();
    await w.search("110001");
    expect(document.querySelectorAll("#rv-fas-list > li").length).toBeGreaterThan(0);
    (document.querySelector(".rv-fas-chip-x") as HTMLButtonElement).click();
    await flush();
    expect(document.querySelectorAll("#rv-fas-list > li")).toHaveLength(0);
    expect(w.$("rv-fas-summary").textContent).toBe("Choose a service and a place to see results.");
  });
  it("never asks for the visitor's location and sends no coordinates", async () => {
    const w = await mount();
    w.chips()[0].click();
    await w.search("110001");
    await w.search("Chittoor");
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/search")).join(" ")).not.toMatch(/[?&]lat=|[?&]lng=/);
  });
  it("if the services cannot be loaded the page still works: a search is allowed (the server picks its default)", async () => {
    const w = await mount({}, { success: false });
    (window as any).fetch = vi.fn(async (u: string) => (String(u).includes("categories") ? ok({ success: false }, 500) : ok(near([school()]))));
    await w.search("110001");
    expect(w.$("rv-fas-service-err").hidden).toBe(true);
  });
});

describe("the version marker and the layout", () => {
  it("widget 03 and the page JSON carry the version marker comment", () => {
    expect(RESULTS.startsWith("<!-- rv-fas widget 03 PR#")).toBe(true);
    const j = JSON.parse(JSONTXT);
    const html = JSON.stringify(j);
    expect(html).toContain("<!-- rv-fas widget 03 PR#");
  });
  it("the JSON widgets are the same text as the widget files (nothing to forget to paste)", () => {
    const j = JSON.parse(JSONTXT);
    const byId: Record<string, string> = {};
    (function walk(n: any[]) { for (const e of n) { if (e.widgetType === "html") byId[e.id] = e.settings.html; if (e.elements) walk(e.elements); } })(j.content);
    expect(byId["a51f0c7"]).toBe(PANEL);
    expect(byId["a51f0d3"]).toBe(RESULTS);
    expect(byId["a51f0e4"]).toBe(readFileSync(join(DIR, "widgets/05-school-directory.a51f0e4.html"), "utf8"));
  });
  it("no blank gap: the results container has no bottom padding, the Directory container has no padding at all (so it is 0 high while its block is hidden); the Directory block carries its own bottom space", () => {
    const j = JSON.parse(JSONTXT);
    const c = (id: string) => j.content.find((x: any) => x.id === id).settings;
    expect(c("a51f0d1").padding.bottom).toBe("0");
    expect(c("a51f0d1").padding_mobile.bottom).toBe("0");
    expect(c("a51f0e3").padding.top).toBe("0");
    expect(c("a51f0e3").padding.bottom).toBe("0");
    expect(c("a51f0e3").padding_mobile.bottom).toBe("0");
    expect(readFileSync(join(DIR, "widgets/05-school-directory.a51f0e4.html"), "utf8")).toMatch(/\.rv-fas-dir\{margin:0 0 80px\}/);
  });
});
