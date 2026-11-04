// @vitest-environment jsdom
// Find a Service: English map labels (OpenFreeMap + MapLibre GL, with the standard-tiles fallback), Google Maps directions,
// "Use my location" and the phone scroll fix. Widgets 01, 03 and 05 run together; Leaflet, MapLibre, geolocation and the network are faked.
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
const flush = async (n = 14) => { for (let i = 0; i < n; i++) await settle(); };

const API = "https://app.techytree.in";
const NAMES = ["ATL Labs", "Robotics Labs", "STEM Labs", "3D Printing Facilities", "Robotics Training Centres", "Innovation Centres"];
const SLUGS = ["atl-labs", "robotics-labs", "stem-labs", "3d-printing-facilities", "robotics-training-centres", "innovation-centres"];
const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
const school = (over: Record<string, unknown> = {}) => ({
  id: "1", schoolName: "A School", state: "Delhi", district: "New Delhi", pincode: "110001", udiseCode: "U1", details: { "ATL UID Code": "ATL-001" },
  distanceKm: 0, lat: 28.6139, lng: 77.209, ...over,
});
const near = (results: unknown[]) => ({
  success: true, dataset: { id: "1" }, category: { slug: "atl-labs", name: "ATL Labs", active: true }, total: results.length, page: 1, pageSize: 50, results,
  near: { center: { lat: 28.6139, lng: 77.209 }, pincodeKnown: true, radiusKm: 25, limit: 50 },
});
const NASTY = "A & B School #1 <script>alert(1)</script>";
const TWO = [school({ id: "1", schoolName: NASTY }), school({ id: "2", schoolName: "Second School", pincode: "110002", district: "Central Delhi", distanceKm: 3.6, lat: 28.64, lng: 77.23 })];
const MULTI = [school({ id: "1", schoolName: "First" }), school({ id: "2", schoolName: "Second" }), school({ id: "3", schoolName: "Third" })];
const STYLE = {
  version: 8, sources: {},
  layers: [
    { id: "place_city", type: "symbol", layout: { "text-field": "{name:latin}\n{name:nonlatin}" } },
    { id: "label_village", type: "symbol", layout: { "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]] } },
    { id: "shield", type: "symbol", layout: { "text-field": ["get", "ref"] } },
    { id: "fill", type: "fill", paint: {} },
  ],
};

let added: Array<[string, any, any]> = [];
let calls: Calls;
let opened: Array<{ href: string; target: string; rel: string }> = [];
let fetchMock: ReturnType<typeof vi.fn>;

async function mount(opts: { gl?: boolean; webgl?: boolean; styleStatus?: number; search?: unknown; locate?: (ok: any, err: any) => void; secure?: boolean; noGeo?: boolean } = {}) {
  document.head.querySelectorAll("#rv-fas-leaflet-css,#rv-fas-maplibre-css").forEach((n) => n.remove());
  document.body.innerHTML = markup(PANEL) + markup(RESULTS) + markup(DIRECTORY);
  calls = newCalls();
  fakeLeaflet(calls, opts.gl ?? false);
  (Element.prototype as any).scrollIntoView = vi.fn();
  delete (window as any).RvFasState;
  (window as any).RoboValleyApi = { base: API };
  window.matchMedia = window.matchMedia || ((() => ({ matches: false, addEventListener() {}, addListener() {} })) as any);
  if (opts.webgl) {
    (window as any).WebGLRenderingContext = function () {};
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({})) as any);
  } else {
    delete (window as any).WebGLRenderingContext;
  }
  Object.defineProperty(window, "isSecureContext", { value: opts.secure ?? true, configurable: true });
  Object.defineProperty(navigator, "geolocation", { value: opts.noGeo ? undefined : { getCurrentPosition: vi.fn((s: any, e: any) => (opts.locate ?? (() => {}))(s, e)) }, configurable: true });
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("tiles.openfreemap.org/styles/")) return ok(JSON.parse(JSON.stringify(STYLE)), opts.styleStatus ?? 200);
    if (u.includes("/api/services/categories")) return ok({ success: true, defaultSlug: "atl-labs", categories: SLUGS.map((slug, i) => ({ slug, name: NAMES[i], active: slug === "atl-labs", count: slug === "atl-labs" ? 9716 : 0, uploadedAt: null })) });
    if (u.includes("/api/services/search")) {
      return ok(u.includes("pincode=") ? opts.search ?? near(TWO) : { success: true, dataset: { id: "1" }, category: { slug: "atl-labs", name: "ATL Labs", active: true }, total: 0, page: 1, pageSize: 12, results: [] });
    }
    throw new Error("unexpected " + u);
  });
  (window as any).fetch = fetchMock;
  for (const h of [PANEL, RESULTS, DIRECTORY]) for (const s of scriptsOf(h)) (0, eval)(s);
  await flush();
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  return {
    $,
    cards: () => [...document.querySelectorAll<HTMLElement>("#rv-fas-list > li")],
    locBtn: () => $("rv-fas-loc-btn") as HTMLButtonElement, locMsg: () => $("rv-fas-loc-msg"), note: () => $("rv-fas-map-note"),
    links: () => [...document.querySelectorAll<HTMLAnchorElement>("a.rv-fas-dir-link")],
    search: async (pin = "110001") => {
      ($("rv-fas-pin") as HTMLInputElement).value = pin;
      $("rv-fas-form").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      await flush();
    },
  };
}
const dest = (a: HTMLAnchorElement) => new URL(a.href).searchParams;

beforeEach(() => {
  added = [];
  opened = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { opened.push({ href: this.href, target: this.target, rel: this.rel }); });
  const orig = document.addEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation(((t: string, l: any, o: any) => { added.push([t, l, o]); orig(t, l, o); }) as any);
});
afterEach(() => {
  const rm = Document.prototype.removeEventListener.bind(document);
  added.forEach(([t, l, o]) => rm(t, l, o));
  document.body.innerHTML = "";
  delete (window as any).L;
  delete (window as any).maplibregl;
  delete (window as any).WebGLRenderingContext;
  vi.restoreAllMocks();
});

describe("base map: English labels", () => {
  it("pins the libraries, loads them with SRI, and uses the OpenFreeMap style with the approved attribution", async () => {
    // Neither library is present: the widget must add the stylesheet and both scripts, exactly as pinned.
    const w = await mount({ webgl: true });
    const injected: HTMLElement[] = [];
    const append = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, "appendChild").mockImplementation(((n: any) => {
      injected.push(n);
      if (n.tagName === "SCRIPT") {
        (window as any).maplibregl = (window as any).maplibregl || {};
        if (/leaflet-maplibre-gl/.test(n.src)) (window as any).L.maplibreGL = (o: any) => { const l: any = { opts: o, addTo: () => l, remove() {}, getMaplibreMap: () => ({ on() {} }) }; calls.gl.push(l); return l; };
        setTimeout(() => n.onload && n.onload(), 0);
        return n;
      }
      return append(n);
    }) as any);
    // Re-run the widget so it loads the libraries (the first run in mount() had none and fell back to raster).
    document.body.innerHTML = markup(PANEL) + markup(RESULTS) + markup(DIRECTORY);
    document.head.querySelectorAll("#rv-fas-maplibre-css,script[src*=maplibre]").forEach((n) => n.remove());
    delete (window as any).maplibregl;
    delete (window as any).L.maplibreGL;
    for (const s of scriptsOf(RESULTS)) (0, eval)(s);
    await flush(30);
    const css = injected.find((n) => n.tagName === "LINK") as HTMLLinkElement;
    const scripts = injected.filter((n) => n.tagName === "SCRIPT") as HTMLScriptElement[];
    expect(css.href).toBe("https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.css");
    expect(css.integrity).toMatch(/^sha384-/);
    expect(scripts.map((s) => s.src)).toEqual([
      "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.js",
      "https://cdn.jsdelivr.net/npm/@maplibre/maplibre-gl-leaflet@0.0.22/leaflet-maplibre-gl.js",
    ]);
    expect(scripts.every((s) => /^sha384-[A-Za-z0-9+/]+=*$/.test(s.integrity) && s.crossOrigin === "anonymous")).toBe(true);
    expect(w.$("rv-fas-map")).toBeTruthy();
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain("https://tiles.openfreemap.org/styles/liberty");
    expect(calls.gl).toHaveLength(1);
    const attr = calls.gl[0].opts.attribution as string;
    expect(attr).toContain(">OpenFreeMap</a>");
    expect(attr).toContain("&copy; OpenMapTiles");
    expect(attr).toContain("Data from");
    expect(attr).toContain('href="https://www.openstreetmap.org/copyright"');
    expect(attr).toContain("GeoNames");
    expect(attr).toContain("CC BY 4.0");
    expect(attr).toContain('rel="noopener noreferrer"');
  });
  it("switches every name label to English first, then the Latin name, then the local name, and leaves other labels alone", async () => {
    await mount({ gl: true, webgl: true });
    await flush(20);
    expect(calls.gl).toHaveLength(1);
    const layers = calls.gl[0].opts.style.layers;
    const chain = ["to-string", ["coalesce", ["get", "name_en"], ["get", "name:latin"], ["get", "name"]]];
    expect(layers[0].layout["text-field"]).toEqual(chain);
    expect(layers[1].layout["text-field"]).toEqual(chain);
    expect(layers[2].layout["text-field"]).toEqual(["get", "ref"]); // road numbers are not names
    expect(layers[3].layout).toBeUndefined();
    expect(JSON.stringify(layers)).not.toContain("filter"); // nothing is hidden: no label is dropped for lacking a Latin name
  });
  it("uses the vector map and no note when the style loads", async () => {
    const w = await mount({ gl: true, webgl: true });
    await flush(20);
    calls.glHandlers.load?.forEach((f) => f());
    calls.glHandlers.error?.forEach((f) => f({ tile: {} })); // one missing tile is not a failure
    expect(calls.tileLayers).toHaveLength(0);
    expect(w.note().hidden).toBe(true);
    expect(calls.glRemoved).toBe(0);
  });
  it("falls back to the standard OSM tiles with the note when WebGL is missing", async () => {
    const w = await mount({ gl: true, webgl: false });
    await flush(20);
    expect(calls.gl).toHaveLength(0);
    expect(calls.tileLayers).toHaveLength(1);
    expect(calls.tileLayers[0].url).toBe("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(calls.tileLayers[0].o.attribution).toContain("OpenStreetMap");
    expect(calls.tileLayers[0].o.attribution).toContain("GeoNames");
    expect(w.note().hidden).toBe(false);
    expect(w.note().textContent).toBe("Labels may be in local languages");
    expect(fetchMock.mock.calls.map((c) => String(c[0])).join(" ")).not.toContain("openfreemap");
  });
  it("falls back, with the note, when the style cannot be fetched", async () => {
    const w = await mount({ gl: true, webgl: true, styleStatus: 503 });
    await flush(20);
    expect(calls.gl).toHaveLength(0);
    expect(calls.tileLayers).toHaveLength(1);
    expect(w.note().textContent).toBe("Labels may be in local languages");
  });
  it("falls back, removing the vector layer, when the style fails before the first draw", async () => {
    const w = await mount({ gl: true, webgl: true });
    await flush(20);
    calls.glHandlers.error?.forEach((f) => f({ error: new Error("style") }));
    expect(calls.glRemoved).toBe(1);
    expect(calls.tileLayers).toHaveLength(1);
    expect(w.note().hidden).toBe(false);
  });
  it("falls back when the vector map never finishes loading", async () => {
    const real = globalThis.setTimeout;
    const waiting: Array<() => void> = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: any, ms?: number, ...a: any[]) => (ms === 15000 ? (waiting.push(fn), 0) : real(fn, ms, ...a))) as any);
    const w = await mount({ gl: true, webgl: true });
    await flush(20);
    expect(waiting).toHaveLength(1); // the 15 s wait for the first draw
    expect(w.note().hidden).toBe(true);
    waiting[0]();
    expect(calls.tileLayers).toHaveLength(1);
    expect(calls.glRemoved).toBe(1);
    expect(w.note().hidden).toBe(false);
  });
});

describe("directions link", () => {
  it("opens Google Maps in a new tab; the destination is name, district, state, PIN code and India, fully encoded", async () => {
    const w = await mount();
    await w.search();
    const a = w.links()[0];
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.getAttribute("aria-label")).toBe(`Get directions to ${NASTY}`);
    expect(a.textContent).toBe("Directions");
    const url = new URL(a.href);
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("destination")).toBe(`${NASTY}, New Delhi, 110001, India`); // the state "Delhi" is already in "New Delhi"
    expect(url.searchParams.get("travelmode")).toBe("driving");
    expect(url.searchParams.has("origin")).toBe(false);
    expect(a.href).not.toMatch(/[<>#"]/);
    expect(a.href.split("?")[1]).toContain("%26");
    expect(a.href).toContain("%23");
    expect(a.href).toContain("%3Cscript%3E");
    expect([...url.searchParams.keys()].sort()).toEqual(["api", "destination", "travelmode"]); // the & in the name did not add a parameter
  });
  it("inserts the school name as text, never as markup", async () => {
    const w = await mount();
    await w.search();
    expect(w.cards()[0].querySelector("h3")!.textContent).toBe(NASTY);
    expect(document.querySelectorAll("#rv-fas-list script")).toHaveLength(0);
    expect(RESULTS).not.toMatch(/innerHTML/);
  });
  it("has a Directions link on every result row, and one per school in a several-school popup", async () => {
    const w = await mount({ search: near(MULTI) });
    await w.search();
    expect(w.cards().every((c) => c.querySelectorAll("a.rv-fas-dir-link").length === 1)).toBe(true);
    calls.markers[0].el.click();
    const pop = calls.popups[0].content as HTMLElement;
    const links = [...pop.querySelectorAll<HTMLAnchorElement>(".rv-fas-pop-row a.rv-fas-dir-link")];
    expect(links.map((a) => dest(a).get("destination"))).toEqual(["First, New Delhi, 110001, India", "Second, New Delhi, 110001, India", "Third, New Delhi, 110001, India"]);
    expect(links.every((a) => a.rel === "noopener noreferrer" && a.target === "_blank")).toBe(true);
    expect(links.map((a) => a.getAttribute("aria-label"))).toEqual(["Get directions to First", "Get directions to Second", "Get directions to Third"]);
  });
  it("follows the travel-mode choice", async () => {
    const w = await mount();
    await w.search();
    const sel = w.$("rv-fas-mode") as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toEqual(["driving", "walking", "transit"]);
    sel.value = "transit";
    sel.dispatchEvent(new Event("change"));
    expect(w.links().every((a) => dest(a).get("travelmode") === "transit")).toBe(true);
    sel.value = "bogus";
    sel.dispatchEvent(new Event("change"));
    expect(w.links().every((a) => dest(a).get("travelmode") === "driving")).toBe(true);
  });
  it("works with the keyboard and touch: a real focusable link, and a tap or Enter does not also open the school's place page", async () => {
    const w = await mount();
    await w.search();
    const a = w.links()[0];
    expect(a.tagName).toBe("A");
    expect(a.getAttribute("href")).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\//);
    expect(a.tabIndex).toBe(0);
    a.focus();
    expect(document.activeElement).toBe(a);
    const row = w.cards()[0];
    const rowClick = vi.fn();
    row.addEventListener("click", rowClick);
    const touch = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(touch, "pointerType", { value: "touch" });
    a.dispatchEvent(touch);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    a.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false); // the browser follows the link
    expect(rowClick).not.toHaveBeenCalled();
    expect(opened).toHaveLength(0); // no second tab from the row
    expect(calls.flyTo).toHaveLength(0);
    expect(calls.popups).toHaveLength(0);
    expect(document.getElementById("rv-fas-tip")!.hidden).toBe(true);
    a.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(opened).toHaveLength(0);
  });
});

describe("popup size", () => {
  it("is capped to the map height and scrolls inside, so the heading and the first school stay in view", async () => {
    const w = await mount({ search: near(MULTI) });
    Object.defineProperty(w.$("rv-fas-map"), "clientHeight", { value: 320, configurable: true }); // a phone map
    await w.search();
    calls.markers[0].el.click();
    const pop = calls.popups[0].content as HTMLElement;
    expect(pop.style.maxHeight).toBe("190px");
    expect(pop.style.overflowY).toBe("auto");
    expect([...pop.children].map((n) => n.tagName)).toEqual(["H4", "DIV", "P"]); // heading, the list, the note
    const row = pop.querySelector(".rv-fas-pop-row")!;
    expect([...row.children].map((n) => n.tagName)).toEqual(["BUTTON", "A"]); // the school, then its own Directions link
  });
  it("a single-school marker has no popup: it opens Google Maps", async () => {
    const w = await mount();
    await w.search();
    calls.markers[0].el.click();
    expect(calls.popups).toHaveLength(0);
    expect(opened).toHaveLength(1);
  });
});

describe("Google Maps on click", () => {
  const queryOf = (href: string) => new URL(href).searchParams.get("query")!;
  it("the MAU school: place search with name, district, state, PIN code and India, nothing else", async () => {
    const mau = school({ id: "9", schoolName: "DR ABDUL SALAM ANSARI HIGHER SEC SCHOOL KOPAGANJ", district: "MAU", state: "UTTAR PRADESH", pincode: "261401" });
    const w = await mount({ search: near([mau]) });
    await w.search("261401");
    w.cards()[0].click();
    expect(opened).toHaveLength(1);
    const u = new URL(opened[0].href);
    expect(u.origin + u.pathname).toBe("https://www.google.com/maps/search/");
    expect([...u.searchParams.keys()]).toEqual(["api", "query"]);
    expect(u.searchParams.get("api")).toBe("1");
    expect(u.searchParams.get("query")).toBe("DR ABDUL SALAM ANSARI HIGHER SEC SCHOOL KOPAGANJ, MAU, UTTAR PRADESH, 261401, India");
    expect(opened[0]).toMatchObject({ target: "_blank", rel: "noopener noreferrer" });
  });
  it.each([
    ["interface labels in the data are removed", { schoolName: "KOPAGANJ SCHOOL Same PIN code Distance", district: "MAU", state: "UP" }, "KOPAGANJ SCHOOL, MAU, UP, 110001, India"],
    ["double and odd spaces and stray commas collapse", { schoolName: "  A   B  \t School ,", district: " MAU  ", state: "UP" }, "A B School, MAU, UP, 110001, India"],
    ["a district already in the name is not repeated", { schoolName: "GANGADAS INTERMEDIATE COLLEGE MAU", district: "MAU", state: "UTTAR PRADESH" }, "GANGADAS INTERMEDIATE COLLEGE MAU, UTTAR PRADESH, 110001, India"],
    ["accents are kept (and encoded)", { schoolName: "École Saint-Joseph", district: "Pondichéry", state: "PUDUCHERRY" }, "École Saint-Joseph, Pondichéry, PUDUCHERRY, 110001, India"],
    ["a name with &, # and <script> stays text and is encoded", { schoolName: "A & B #1 <script>alert(1)</script>", district: "D", state: "S" }, "A & B #1 <script>alert(1)</script>, D, S, 110001, India"],
    ["control characters are dropped", { schoolName: "Bad\u0000Name\u0007", district: "D", state: "S" }, "Bad Name, D, S, 110001, India"],
  ])("%s", async (_n, over, expected) => {
    const w = await mount({ search: near([school(over)]) });
    await w.search();
    w.cards()[0].click();
    expect(queryOf(opened[0].href)).toBe(expected);
    expect(dest(w.links()[0]).get("destination")).toBe(expected); // the Directions destination is the very same text
    expect(opened[0].href).not.toMatch(/[<>"]|%00/);
    expect(opened[0].href).not.toMatch(/same\+pin|distance|km\+away/i);
  });
  it("the text of the page is never part of the query: the distance badge does not leak in", async () => {
    const w = await mount({ search: near([school({ schoolName: "KOPAGANJ SCHOOL", district: "MAU", state: "UTTAR PRADESH", pincode: "261401", distanceKm: 0 })]) });
    await w.search("261401");
    expect(w.cards()[0].textContent).toContain("Same PIN code"); // the badge is on screen
    w.cards()[0].click();
    for (const href of [opened[0].href, w.links()[0].href]) expect(decodeURIComponent(href.replace(/\+/g, " "))).not.toMatch(/Same PIN code|Distance|District MAU|State UTTAR/);
  });
  it("the place page has no origin, the directions page has one only when the visitor shared a position", async () => {
    const w = await mount({ locate: (s) => s({ coords: { latitude: 12.345678, longitude: 77.654321, accuracy: 40 } }) });
    await w.search();
    w.locBtn().click();
    await flush();
    w.cards()[0].click();
    expect(new URL(opened[0].href).searchParams.has("origin")).toBe(false);
    expect(opened[0].href).not.toContain("12.3456");
    expect(dest(w.links()[0]).get("origin")).toBe("12.345678,77.654321");
    expect(new URL(w.links()[0].href).pathname).toBe("/maps/dir/");
  });
  it("opens the tab inside the click handler itself (no timer, no promise), so pop-up blockers allow it", async () => {
    const w = await mount();
    await w.search();
    w.cards()[0].click();
    expect(opened).toHaveLength(1); // already there, with no await
    expect(RESULTS).not.toMatch(/window\.open/);
    expect(RESULTS).toMatch(/a\.target = '_blank';\s*a\.rel = 'noopener noreferrer';/);
  });
  it("touch: the first tap shows the tooltip, the second tap opens Google Maps", async () => {
    const w = await mount();
    await w.search();
    const m = calls.markers[0].el as HTMLElement;
    const tap = () => { const e = new Event("pointerdown", { bubbles: true }); Object.defineProperty(e, "pointerType", { value: "touch" }); m.dispatchEvent(e); m.click(); };
    tap();
    expect(document.getElementById("rv-fas-tip")!.hidden).toBe(false);
    expect(opened).toHaveLength(0);
    tap();
    expect(opened).toHaveLength(1);
    expect(document.getElementById("rv-fas-tip")!.hidden).toBe(true);
  });
  it("keyboard: Enter and Space on a row open Google Maps", async () => {
    const w = await mount();
    await w.search();
    w.cards()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    w.cards()[1].dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(opened).toHaveLength(2);
    expect(queryOf(opened[1].href)).toBe("Second School, Central Delhi, 110002, India");
  });
  it("a several-school marker: Enter opens the list popup; each school in it opens its own Google Maps tab", async () => {
    const w = await mount({ search: near(MULTI) });
    await w.search();
    calls.markers[0].el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(opened).toHaveLength(0);
    const items = [...(calls.popups[0].content as HTMLElement).querySelectorAll<HTMLButtonElement>(".rv-fas-pop-item")];
    items[1].click();
    expect(queryOf(opened[0].href)).toBe("Second, New Delhi, 110001, India");
    expect(items[1].getAttribute("aria-label")).toBe("Open Second in Google Maps (new tab)");
  });
  it("says what a click does and that Google may show a similarly named school (page and popup)", async () => {
    const w = await mount({ search: near(MULTI) });
    expect(w.$("rv-fas-dir-note").textContent).toContain("Google Maps may show a similarly named school. Please check the address.");
    expect(w.$("rv-fas-dir-note").textContent).toContain("Click or tap a school to open it in Google Maps");
    await w.search();
    calls.markers[0].el.click();
    expect((calls.popups[0].content as HTMLElement).querySelector(".rv-fas-pop-note")!.textContent).toBe("Google Maps may show a similarly named school. Please check the address.");
  });
  it("a click only opens a tab: no request to our API (or anywhere) carries a location or a school's text", async () => {
    const w = await mount({ locate: (s) => s({ coords: { latitude: 12.345678, longitude: 77.654321, accuracy: 40 } }) });
    await w.search();
    w.locBtn().click();
    await flush();
    const before = fetchMock.mock.calls.length;
    w.cards()[0].click();
    expect(fetchMock.mock.calls.length).toBe(before);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/12\.3456|77\.6543/);
  });
});

describe("Use my location", () => {
  const position = { coords: { latitude: 12.345678, longitude: 77.654321, accuracy: 40 } };
  it("explains privacy under the control", async () => {
    const w = await mount();
    expect(w.$("rv-fas-loc-help").textContent).toContain("stays in your browser");
    expect(w.$("rv-fas-loc-help").textContent).toContain("never sent to RoboValley");
    expect(w.locBtn().textContent).toBe("Use my location");
  });
  it("asking: shows that it is asking and disables the button while waiting", async () => {
    const w = await mount({ locate: () => {} }); // never answers
    w.locBtn().click();
    expect(w.locMsg().hidden).toBe(false);
    expect(w.locMsg().textContent).toBe("Asking for your location…");
    expect(w.locBtn().disabled).toBe(true);
    expect(w.locBtn().getAttribute("aria-busy")).toBe("true");
    expect((navigator.geolocation.getCurrentPosition as any).mock.calls).toHaveLength(1);
  });
  it("granted: shows a 'your location' marker with an accuracy circle and starts directions from there", async () => {
    const w = await mount({ locate: (s) => s(position) });
    await w.search();
    w.locBtn().click();
    await flush();
    expect(w.locMsg().textContent).toContain("Your location is shown on the map");
    expect(calls.me).toHaveLength(1);
    expect(calls.me[0].c).toEqual([12.345678, 77.654321]);
    expect(calls.acc).toHaveLength(1);
    expect(calls.acc[0].o.radius).toBe(40);
    expect(calls.markers).toHaveLength(2); // the two search markers (two PIN codes) are untouched
    expect(w.links().every((a) => dest(a).get("origin") === "12.345678,77.654321")).toBe(true);
    expect(w.locBtn().disabled).toBe(false);
    expect(w.locBtn().textContent).toBe("Update my location");
    expect((w.$("rv-fas-loc-clear") as HTMLElement).hidden).toBe(false);
  });
  it("granted before any search: moves the map to the visitor", async () => {
    const w = await mount({ locate: (s) => s(position) });
    w.locBtn().click();
    await flush();
    expect(calls.flyTo[0].slice(0, 2)).toEqual([[12.345678, 77.654321], 13]);
  });
  it("forget: removes the marker and the origin from the links", async () => {
    const w = await mount({ locate: (s) => s(position) });
    await w.search();
    w.locBtn().click();
    await flush();
    (w.$("rv-fas-loc-clear") as HTMLButtonElement).click();
    expect(calls.me).toHaveLength(0);
    expect(w.links().every((a) => !dest(a).has("origin"))).toBe(true);
    expect(w.locMsg().hidden).toBe(true);
  });
  it.each([
    ["denied", { code: 1 }, "Location access was blocked. Allow it in your browser settings, or enter a PIN code."],
    ["unavailable", { code: 2 }, "Your location is not available right now. You can still open directions; Google Maps will ask where to start."],
    ["timeout", { code: 3 }, "Finding your location took too long. Try again, or open directions and let Google Maps ask where to start."],
  ])("%s: shows its message, and directions still open with no origin", async (_n, err, text) => {
    const w = await mount({ locate: (_s, e) => e(err) });
    await w.search();
    w.locBtn().click();
    await flush();
    expect(w.locMsg().textContent).toBe(text);
    expect(w.locBtn().disabled).toBe(false);
    expect(calls.me).toHaveLength(0);
    const a = w.links()[0];
    expect(dest(a).has("origin")).toBe(false);
    expect(dest(a).get("destination")).toContain("110001");
  });
  it("insecure page: says so and never asks the browser", async () => {
    const w = await mount({ secure: false, locate: (s) => s(position) });
    w.locBtn().click();
    expect(w.locMsg().textContent).toContain("secure (HTTPS) page");
    expect((navigator.geolocation.getCurrentPosition as any).mock.calls).toHaveLength(0);
  });
  it("a browser without geolocation: unavailable", async () => {
    const w = await mount({ noGeo: true });
    w.locBtn().click();
    expect(w.locMsg().textContent).toContain("not available right now");
  });
  it("sends no coordinates to our API or to any other service", async () => {
    const w = await mount({ locate: (s) => s(position) });
    await w.search();
    w.locBtn().click();
    await flush();
    calls.markers[0].el.click();
    (w.$("rv-fas-mode") as HTMLSelectElement).value = "walking";
    w.$("rv-fas-mode").dispatchEvent(new Event("change"));
    await w.search("110002");
    const wire = JSON.stringify(fetchMock.mock.calls);
    for (const needle of ["12.3456", "77.6543", "12.345678", "77.654321", "12.35", "77.65"]) expect(wire).not.toContain(needle);
    expect(RESULTS).not.toMatch(/localStorage|sessionStorage|sendBeacon|XMLHttpRequest/);
  });
});

describe("phone scroll fix", () => {
  const layout = (stacked: boolean) => {
    const box = (l: number, r: number) => () => ({ left: l, right: r, top: 0, bottom: 10, width: r - l, height: 10, x: l, y: 0, toJSON() {} }) as DOMRect;
    (document.querySelector(".rv-fas-list-col") as HTMLElement).getBoundingClientRect = box(0, stacked ? 390 : 400);
    (document.querySelector(".rv-fas-map-col") as HTMLElement).getBoundingClientRect = box(stacked ? 0 : 420, stacked ? 390 : 820);
  };
  it("stacked list and map: a several-school marker click highlights its rows but does not scroll the page", async () => {
    const w = await mount({ search: near(MULTI) });
    await w.search();
    layout(true);
    (Element.prototype.scrollIntoView as any).mockClear();
    calls.markers[0].el.click();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(w.cards()[0].classList.contains("is-selected")).toBe(true);
    expect(calls.flyTo).toHaveLength(1);
    expect(calls.popups).toHaveLength(1);
  });
  it("choosing a school in the popup opens Google Maps and does not scroll a stacked page either", async () => {
    const w = await mount({ search: near(MULTI) });
    await w.search();
    layout(true);
    calls.markers[0].el.click();
    (Element.prototype.scrollIntoView as any).mockClear();
    ((calls.popups[0].content as HTMLElement).querySelectorAll(".rv-fas-pop-item")[2] as HTMLElement).click();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(opened).toHaveLength(1);
    expect(w.cards()[2].classList.contains("is-selected")).toBe(true);
  });
  it("side by side (desktop): a several-school marker still scrolls its rows into view", async () => {
    const w = await mount({ search: near(MULTI) });
    await w.search();
    layout(false);
    (Element.prototype.scrollIntoView as any).mockClear();
    calls.markers[0].el.click();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(w.cards()[0].classList.contains("is-selected")).toBe(true);
  });
});
