// @vitest-environment jsdom
// Find a Service widget 03: the "too many searches" (HTTP 429) state. The earlier results stay on screen, the notice counts down,
// nothing is sent while waiting, and Try again works when the wait is over. Widgets 01, 03 and 05 run together; Leaflet and the network are faked.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeLeaflet, newCalls } from "./helpers/fakeLeaflet";

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
const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  ({ ok: status < 400, status, headers: { get: (k: string) => headers[k] ?? null }, json: async () => { if (body === undefined) throw new Error("not json"); return body; } }) as unknown as Response;
const school = (over: Record<string, unknown> = {}) => ({
  id: "1", schoolName: "A School", state: "Delhi", district: "New Delhi", pincode: "110001", udiseCode: "U1", details: {}, distanceKm: 0, lat: 28.6139, lng: 77.209, ...over,
});
const near = (results: unknown[]) => ({
  success: true, dataset: { id: "1" }, category: { slug: "atl-labs", name: "ATL Labs", active: true }, total: results.length, page: 1, pageSize: 50, results,
  near: { center: { lat: 28.6139, lng: 77.209 }, pincodeKnown: true, radiusKm: 25, limit: 50 },
});
const TWO = [school({ id: "1", schoolName: "First School" }), school({ id: "2", schoolName: "Second School", pincode: "110002", lat: 28.64, lng: 77.23 })];
const BUSY = (n = 5) => reply({ success: false, error: "RATE_LIMITED", message: `Lots of people are searching right now. Please try again in ${n} seconds.`, retryAfter: n }, 429, { "Retry-After": String(n) });

let added: Array<[string, any, any]> = [];
let queue: Array<() => Response>;
let fetchMock: ReturnType<typeof vi.fn>;
const searchCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/services/search")).length;

async function mount() {
  document.head.querySelectorAll("#rv-fas-leaflet-css,#rv-fas-maplibre-css").forEach((n) => n.remove());
  document.body.innerHTML = markup(PANEL) + markup(RESULTS) + markup(DIRECTORY);
  fakeLeaflet(newCalls(), false);
  (Element.prototype as any).scrollIntoView = vi.fn();
  delete (window as any).RvFasState;
  delete (window as any).WebGLRenderingContext;
  (window as any).RoboValleyApi = { base: API };
  window.matchMedia = window.matchMedia || ((() => ({ matches: false, addEventListener() {}, addListener() {} })) as any);
  Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition: vi.fn(), watchPosition: vi.fn(), clearWatch: vi.fn() }, configurable: true });
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("tiles.openfreemap.org/styles/")) return reply({ version: 8, sources: {}, layers: [] });
    if (u.includes("/api/services/categories")) {
      return reply({ success: true, defaultSlug: "atl-labs", categories: SLUGS.map((slug, i) => ({ slug, name: NAMES[i], active: slug === "atl-labs", count: slug === "atl-labs" ? 2 : 0 })) });
    }
    if (u.includes("/api/services/search")) return (u.includes("pincode=") ? queue.shift() : undefined)?.() ?? reply(near(TWO)); // the queue is for widget 03 PIN searches only (widget 05 also lists schools)
    throw new Error("unexpected " + u);
  });
  (window as any).fetch = fetchMock;
  for (const h of [PANEL, RESULTS, DIRECTORY]) for (const s of scriptsOf(h)) (0, eval)(s);
  await flush();
}
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const cards = () => [...document.querySelectorAll<HTMLElement>("#rv-fas-list > li")];
const alertText = () => ($("rv-fas-alert").hidden ? "" : $("rv-fas-alert").textContent ?? "");
const retryBtn = () => $("rv-fas-alert").querySelector<HTMLButtonElement>("button.rv-fas-limit-retry");
async function search(pin = "110001") {
  const st = (window as any).RvFasState;
  if (st?.ready && st.categories.length && !st.selected) document.dispatchEvent(new CustomEvent("rv-fas-select", { detail: { slug: (st.firstActive ?? st.categories[0]).slug } }));
  ($("rv-fas-location") as HTMLInputElement).value = pin;
  $("rv-fas-form").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await flush();
}
const tick = async (ms: number) => { vi.advanceTimersByTime(ms); await flush(4); };

beforeEach(() => {
  queue = [];
  added = [];
  const orig = document.addEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation(((t: string, l: any, o: any) => { added.push([t, l, o]); orig(t, l, o); }) as any);
});
afterEach(() => {
  vi.useRealTimers();
  const rm = Document.prototype.removeEventListener.bind(document);
  added.forEach(([t, l, o]) => rm(t, l, o));
  document.body.innerHTML = "";
  delete (window as any).L;
  vi.restoreAllMocks();
});

describe("widget 03: too many searches (429)", () => {
  it("normal search behaviour is unchanged: results shown, no notice", async () => {
    await mount();
    await search();
    expect(cards()).toHaveLength(2);
    expect(alertText()).toBe("");
    expect($("rv-fas-summary").textContent).toMatch(/2 schools within 25 km of 110001/);
  });

  it("keeps the earlier results, shows the message with the seconds, and disables Try again", async () => {
    await mount();
    await search();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    queue.push(() => BUSY(5));
    await search("110002");
    expect(cards().map((c) => c.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("First School"), expect.stringContaining("Second School")]));
    expect(alertText()).toContain("Lots of people are searching right now. Please try again in 5 seconds.");
    expect(retryBtn()?.textContent).toBe("Try again");
    expect(retryBtn()?.disabled).toBe(true);
    expect($("rv-fas-summary").textContent).not.toBe("Searching…");
    expect($("rv-fas-summary").textContent).toMatch(/2 schools/);
    expect($("rv-fas-state").hidden).toBe(true); // no "search failed" card
    expect(document.body.textContent).not.toContain("could not be completed");
  });

  it("sends nothing while waiting (Search pressed again, slider moved), and counts down", async () => {
    await mount();
    await search();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    queue.push(() => BUSY(5));
    await search("110002");
    const before = searchCalls();
    for (let i = 0; i < 5; i++) await search("110002");
    const slider = $("rv-fas-radius") as HTMLInputElement;
    for (const v of ["30", "40", "50"]) { slider.value = v; slider.dispatchEvent(new Event("input", { bubbles: true })); }
    await new Promise((r) => setTimeout(r, 450)); // longer than the slider's own 250 ms pause
    expect(searchCalls()).toBe(before);
    await tick(2000);
    expect(alertText()).toMatch(/try again in [123] seconds?\./);
    expect(searchCalls()).toBe(before);
    expect(cards()).toHaveLength(2);
  });

  it("when the wait is over the button wakes up, nothing is sent by itself, and Try again searches once", async () => {
    await mount();
    await search();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    queue.push(() => BUSY(3));
    await search("110002");
    const before = searchCalls();
    await tick(3100);
    expect(alertText()).toContain("You can search again now.");
    expect(retryBtn()?.disabled).toBe(false);
    expect(searchCalls()).toBe(before);
    retryBtn()!.click();
    await flush();
    expect(searchCalls()).toBe(before + 1);
    expect(alertText()).toBe("");
    expect(cards()).toHaveLength(2);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain("pincode=110002");
  });

  it("a fresh search after the wait works without pressing Try again", async () => {
    await mount();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    queue.push(() => BUSY(2));
    await search();
    expect(alertText()).toContain("in 2 seconds");
    await tick(2100);
    await search("110003");
    expect(cards()).toHaveLength(2);
    expect(alertText()).toBe("");
  });

  it("a 429 on the very first search shows the notice over the start card, not a failure", async () => {
    await mount();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    queue.push(() => BUSY(4));
    await search();
    expect(cards()).toHaveLength(0);
    expect(alertText()).toContain("Please try again in 4 seconds.");
    expect($("rv-fas-state").textContent).toContain("Find a service near you");
    expect($("rv-fas-summary").textContent).toBe("Choose a service and a place to see results.");
  });

  it("uses the Retry-After header when the body is not JSON, and a safe default when neither is given", async () => {
    await mount();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    queue.push(() => reply(undefined, 429, { "Retry-After": "7" }));
    await search();
    expect(alertText()).toContain("in 7 seconds");
    await tick(8000);
    queue.push(() => reply(undefined, 429));
    retryBtn()!.click();
    await flush();
    expect(alertText()).toContain("in 30 seconds");
  });

  it("other failures still show the old error card (not the busy notice)", async () => {
    await mount();
    queue.push(() => reply({ success: false, error: "SERVER_ERROR", message: "Search is not available right now." }, 500));
    await search();
    expect(alertText()).toBe("");
    expect($("rv-fas-state").textContent).toContain("The school search is not available right now");
  });

  it("the notice is built with text nodes only (a hostile message cannot inject markup)", async () => {
    await mount();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    queue.push(() => reply({ success: false, message: "<img src=x onerror=alert(1)>", retryAfter: 3 }, 429));
    await search();
    expect($("rv-fas-alert").querySelector("img")).toBeNull();
    expect(alertText()).toContain("Please try again in 3 seconds.");
  });

  it("carries the version marker", () => {
    expect(RESULTS.startsWith("<!-- rv-fas widget 03 PR#")).toBe(true);
  });
});
