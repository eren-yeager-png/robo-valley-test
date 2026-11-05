// @vitest-environment jsdom
// Elementor widgets 01 (search panel) and 03 (results + map) on /find-a-service/: PIN code + distance search, driven only by
// GET /api/services/search. Leaflet and the network are faked; nothing real is contacted.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeLeaflet, newCalls, type Calls } from "./helpers/fakeLeaflet";

const DIR = join(__dirname, "../frontend/elementor/find-a-service-510/widgets");
const PANEL = readFileSync(join(DIR, "01-search-panel.a51f0c7.html"), "utf8");
const RESULTS = readFileSync(join(DIR, "03-results-map-script.a51f0d3.html"), "utf8");
const scriptOf = (h: string) => /<script>([\s\S]*?)<\/script>/.exec(h)![1];
const markup = (h: string) => h.replace(/<script>[\s\S]*?<\/script>/g, "").replace(/<style>[\s\S]*?<\/style>/g, "");
const settle = () => new Promise((r) => setTimeout(r, 0));
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await settle(); };

const API = "https://app.techytree.in";
const hit = (over: Record<string, unknown> = {}) => ({ id: "1", schoolName: "A School", state: "Delhi", district: "New Delhi", pincode: "110001", udiseCode: "U1", details: {}, distanceKm: 0, lat: 28.6139, lng: 77.209, ...over });
const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
const found = (results: unknown[], over: Record<string, unknown> = {}) => ({ success: true, dataset: { id: "1" }, total: (results as any[]).length, results, near: { center: { lat: 28.6139, lng: 77.209 }, pincodeKnown: true, radiusKm: 25, limit: 50 }, ...over });

async function mount(fetchImpl: (url: string) => Promise<Response>, opts: { api?: string | null } = {}) {
  document.head.querySelectorAll("#rv-fas-leaflet-css").forEach((n) => n.remove());
  document.body.innerHTML = markup(PANEL) + markup(RESULTS);
  const calls: Calls = newCalls();
  fakeLeaflet(calls);
  (Element.prototype as any).scrollIntoView = vi.fn(); // jsdom has none
  if (opts.api !== null) (window as any).RoboValleyApi = { base: opts.api ?? API }; else delete (window as any).RoboValleyApi;
  const fetchMock = vi.fn(async (url: string) => fetchImpl(url));
  (window as any).fetch = fetchMock;
  window.matchMedia = window.matchMedia || ((() => ({ matches: false, addEventListener() {}, addListener() {} })) as any);
  (0, eval)(scriptOf(RESULTS));
  await flush();
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  return {
    calls, fetchMock, $,
    pin: $("rv-fas-location") as HTMLInputElement, radius: $("rv-fas-radius") as HTMLInputElement, form: $("rv-fas-form") as HTMLFormElement,
    search: async (pin: string, radius?: string) => {
      (document.getElementById("rv-fas-location") as HTMLInputElement).value = pin;
      if (radius) { const r = $("rv-fas-radius") as HTMLInputElement; r.value = radius; r.dispatchEvent(new Event("input")); }
      $("rv-fas-form").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      await flush(12);
    },
    cards: () => [...document.querySelectorAll("#rv-fas-list > li")] as HTMLElement[],
    summary: () => $("rv-fas-summary").textContent,
    stateText: () => ($("rv-fas-state").hidden ? "" : $("rv-fas-state").textContent),
    urls: () => fetchMock.mock.calls.map((c) => String(c[0])),
  };
}
afterEach(() => { document.body.innerHTML = ""; delete (window as any).L; vi.restoreAllMocks(); vi.useRealTimers(); });

describe("the page contains no demo or sample data", () => {
  const OTHERS = ["04-upload-button.a51f0e2.html", "05-school-directory.a51f0e4.html"].map((f) => readFileSync(join(DIR, f), "utf8"));
  const JSONTXT = readFileSync(join(DIR, "../find-a-service-510.elementor.json"), "utf8");
  const BAD = /demo|Demonstration data|DEMO DATA|example\.org|rv-fas-data|Demo ATL Lab/i;
  it.each([["search panel", PANEL], ["results widget", RESULTS], ["upload widget", OTHERS[0]], ["directory widget", OTHERS[1]], ["Elementor JSON", JSONTXT]])("%s: no demo markup, no embedded facility list", (_n, html) => {
    // The one allowed use of the word: the label the Service list adds when the API says a service holds sample data (never a built-in list).
    expect(html.replace(/c\.isDemo\s*\?\s*' · demo'\s*:\s*''/g, "")).not.toMatch(BAD);
  });
  it("the school list only ever comes from the API (no JSON blob in the page)", () => {
    for (const h of [PANEL, RESULTS, ...OTHERS]) expect(h).not.toMatch(/<script[^>]*application\/json/i);
    expect(RESULTS).toContain("/api/services/search");
  });
  it("the directory heading is not hard-coded to schools", () => {
    expect(OTHERS[1]).not.toMatch(/School directory/);
  });
});

describe("search panel", () => {
  it("has a Service combobox, a Location box (PIN code, district or state) and a 1-50 km slider (default 25); no PIN-only box (the chips start hidden)", () => {
    document.body.innerHTML = markup(PANEL);
    const svc = document.getElementById("rv-fas-service") as HTMLInputElement;
    expect([svc.getAttribute("role"), svc.getAttribute("aria-autocomplete"), svc.getAttribute("aria-expanded"), svc.getAttribute("aria-controls")]).toEqual(["combobox", "list", "false", "rv-fas-listbox"]);
    expect(svc.placeholder).toBe("Search services, e.g. ATL Labs");
    expect(document.getElementById("rv-fas-listbox")!.getAttribute("role")).toBe("listbox");
    const loc = document.getElementById("rv-fas-location") as HTMLInputElement;
    expect(loc.placeholder).toBe("PIN code, district or state");
    expect(loc.getAttribute("inputmode")).toBeNull(); // text is allowed: it is not a numeric-only box
    const r = document.getElementById("rv-fas-radius") as HTMLInputElement;
    expect([r.min, r.max, r.step, r.value]).toEqual(["1", "50", "1", "25"]);
    expect(document.getElementById("rv-fas-geo")).toBeNull();
    expect(document.querySelector(".rv-fas-field--pin")).toBeNull();
    expect((document.getElementById("rv-fas-cats") as HTMLElement).hidden).toBe(true);
  });
});

describe("searching", () => {
  it("a valid PIN code: calls the API with pincode + radius, lists the schools nearest first, draws the circle with the chosen radius", async () => {
    const w = await mount(async () => ok(found([hit(), hit({ id: "2", schoolName: "B School", pincode: "110002", distanceKm: 3.6, lat: 28.64, lng: 77.23 })])));
    await w.search("110001", "10");
    expect(w.urls()[0]).toBe(`${API}/api/services/search?pincode=110001&radius=10`);
    expect(w.cards().map((c) => c.querySelector("h3")!.textContent)).toEqual(["A School", "B School"]);
    expect(w.cards()[0].querySelector(".rv-fas-dist")!.textContent).toBe("Same PIN code");
    expect(w.cards()[1].querySelector(".rv-fas-dist")!.textContent).toBe("3.6 km");
    expect(w.summary()).toBe("2 schools within 10 km of 110001");
    expect(w.calls.circle[0].o.radius).toBe(10000);
    expect(w.calls.circle[0].c).toEqual([28.6139, 77.209]);
    expect(w.calls.flyToBounds.at(-1)[0]).toBe("bounds"); // a new PIN code: flies to the circle
    expect(w.calls.markers).toHaveLength(2);
  });

  it("schools sharing a PIN code get ONE marker, with the count", async () => {
    const w = await mount(async () => ok(found([hit(), hit({ id: "2", schoolName: "Second" }), hit({ id: "3", schoolName: "Third" })])));
    await w.search("110001");
    expect(w.calls.markers).toHaveLength(1);
    expect((w.calls.markers[0].o.icon.html as HTMLElement).textContent).toBe("1"); // the number of its first school in the list
    expect(w.cards()).toHaveLength(3);
  });

  it("moving the slider searches again with the new distance", async () => {
    const w = await mount(async () => ok(found([hit()])));
    await w.search("110001");
    vi.useFakeTimers();
    w.radius.value = "40"; w.radius.dispatchEvent(new Event("input"));
    expect(w.$("rv-fas-radius-out").textContent).toBe("40 km");
    await vi.advanceTimersByTimeAsync(300);
    vi.useRealTimers();
    await flush();
    expect(w.urls().at(-1)).toBe(`${API}/api/services/search?pincode=110001&radius=40`);
  });

  it("the slider can never ask for more than 50 km", async () => {
    const w = await mount(async () => ok(found([hit()])));
    await w.search("110001", "999");
    expect(w.urls()[0]).toMatch(/radius=(50|25)$/);
  });

  it("only the nearest 50 are shown, and the summary says so", async () => {
    const w = await mount(async () => ok(found([hit()], { total: 130 })));
    await w.search("110001");
    expect(w.summary()).toContain("showing the nearest 1");
  });
});

describe("invalid input never reaches the API", () => {
  it.each([["5 digits", "11000", "Enter a 6-digit PIN code, district or state"], ["7 digits", "1100012", "Enter a 6-digit PIN code, district or state"], ["leading zero", "010001", "Enter a 6-digit PIN code, district or state"], ["empty", "", "Enter a PIN code, district or state."], ["one letter", "a", "Enter a 6-digit PIN code, district or state"], ["punctuation only", "-- ..", "Enter a 6-digit PIN code, district or state"]])("%s", async (_n, v, msg) => {
    const w = await mount(async () => ok(found([])));
    await w.search(v);
    expect(w.fetchMock).not.toHaveBeenCalled();
    expect((w.$("rv-fas-loc-err")).hidden).toBe(false);
    expect(w.$("rv-fas-loc-err").textContent).toBe(msg);
    expect(w.pin.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(w.pin);
  });
  it("the box keeps what is typed (text is allowed) and the error goes away when typing again", async () => {
    const w = await mount(async () => ok(found([])));
    await w.search("11000");
    expect(w.$("rv-fas-loc-err").hidden).toBe(false);
    w.pin.value = "Chittoor 1"; w.pin.dispatchEvent(new Event("input"));
    expect(w.pin.value).toBe("Chittoor 1");
    expect(w.$("rv-fas-loc-err").hidden).toBe(true);
  });
});

describe("a district or state (text) search", () => {
  const textBody = (n: number, over: Record<string, unknown> = {}) => ({ success: true, dataset: { id: "1" }, total: n, page: 1, pageSize: 50, results: Array.from({ length: Math.min(n, 50) }, (_v, i) => ({ id: String(i), schoolName: "School " + (i + 1), state: "ANDHRA PRADESH", district: "CHITTOOR", pincode: i % 2 ? "517415" : "517416", udiseCode: null, details: {}, lat: 13.6 + i / 100, lng: 79.4 + i / 100 })), ...over });
  it("asks for the first 50 matches by name (location text, pageSize 50), with no pincode, lat, lng or radius", async () => {
    const w = await mount(async () => ok(textBody(3)));
    await w.search("Chittoor");
    const u = new URL(w.urls()[0]);
    expect([...u.searchParams.keys()].sort()).toEqual(["location", "pageSize"]);
    expect(u.searchParams.get("location")).toBe("Chittoor");
    expect(u.searchParams.get("pageSize")).toBe("50");
    expect(w.summary()).toBe("3 schools in Chittoor");
  });
  it("two words go as one location text; no coordinates ever go to the API", async () => {
    const w = await mount(async () => ok(textBody(2)));
    await w.search("Andhra   Pradesh");
    expect(new URL(w.urls()[0]).searchParams.get("location")).toBe("Andhra Pradesh");
    expect(w.urls().join(" ")).not.toMatch(/lat=|lng=|pincode=/);
  });
  it("puts the matches on the map and fits the map to them; no circle; rows show no distance badge", async () => {
    const w = await mount(async () => ok(textBody(4)));
    await w.search("Chittoor");
    expect(w.calls.markers.length).toBeGreaterThan(0);
    expect(w.calls.circle).toHaveLength(0);
    expect(w.calls.fit.length).toBeGreaterThan(0); // fitBounds to the points
    expect(document.querySelectorAll(".rv-fas-dist")).toHaveLength(0);
    expect(w.cards()).toHaveLength(4);
  });
  it("more than 50 matches: the summary says it shows the first 50", async () => {
    const w = await mount(async () => ok(textBody(130)));
    await w.search("Chittoor");
    expect(w.summary()).toBe("130 schools in Chittoor (showing the first 50)");
    expect(w.cards()).toHaveLength(50);
  });
  it("no match: \"We couldn't find that place\" and a hint, no stale rows", async () => {
    const w = await mount(async () => ok(textBody(0)));
    await w.search("Atlantis");
    expect(w.stateText()).toContain("We couldn\u2019t find that place");
    expect(w.stateText()).toContain("Try a PIN code, a district or a state.");
    expect(w.cards()).toHaveLength(0);
  });
  it("the distance slider does not apply to text and is switched off, then back on for a PIN code", async () => {
    const w = await mount(async (u) => ok(u.includes("pincode=") ? found([hit()]) : textBody(2)));
    await w.search("Chittoor");
    expect(w.radius.disabled).toBe(true);
    await w.search("110001");
    expect(w.radius.disabled).toBe(false);
  });
});

describe("a PIN code with no stored position", () => {
  const noCentre = found([hit({ schoolName: "Own School", pincode: "143004", lat: null, lng: null })], { near: { center: null, pincodeKnown: true, radiusKm: 25, limit: 50 } });

  it("asks OpenStreetMap once, then searches again around the found point", async () => {
    const w = await mount(async (u) => (u.includes("nominatim") ? ok([{ lat: "31.66", lon: "74.91" }]) : u.includes("lat=") ? ok(found([hit()], { near: { center: { lat: 31.66, lng: 74.91 }, pincodeKnown: false, radiusKm: 25, limit: 50 } })) : ok(noCentre)));
    await w.search("143004");
    await new Promise((r) => setTimeout(r, 1200));
    await flush();
    const u = w.urls();
    expect(u).toHaveLength(3);
    expect(u[1]).toContain("nominatim.openstreetmap.org/search");
    expect(u[1]).toContain("countrycodes=in");
    expect(u[1]).toContain("postalcode=143004");
    expect(u[2]).toContain("lat=31.660000&lng=74.910000");
    expect(w.calls.circle).toHaveLength(1);
  });

  it("nothing found anywhere: the school in that exact PIN code is still listed, with a notice and no circle", async () => {
    const w = await mount(async (u) => (u.includes("nominatim") ? ok([]) : ok(noCentre)));
    await w.search("143004");
    await new Promise((r) => setTimeout(r, 1200));
    await flush();
    expect(w.cards().map((c) => c.querySelector("h3")!.textContent)).toEqual(["Own School"]);
    expect(w.cards()[0].querySelector(".rv-fas-dist")!.textContent).toBe("Same PIN code");
    expect(w.$("rv-fas-alert").hidden).toBe(false);
    expect(w.$("rv-fas-alert").textContent).toContain("143004");
    expect(w.calls.circle).toHaveLength(0);
    expect(w.calls.markers).toHaveLength(0);
  });

  it("OpenStreetMap unreachable: the same, no crash", async () => {
    const w = await mount(async (u) => { if (u.includes("nominatim")) throw new Error("offline"); return ok(noCentre); });
    await w.search("143004");
    await new Promise((r) => setTimeout(r, 1200));
    await flush();
    expect(w.cards()).toHaveLength(1);
    expect(w.$("rv-fas-alert").hidden).toBe(false);
  });
});

describe("empty and failure states", () => {
  it("no schools in range: friendly message and a button to try 50 km", async () => {
    const w = await mount(async () => ok(found([], { total: 0 })));
    await w.search("110001", "5");
    expect(w.cards()).toHaveLength(0);
    expect(w.stateText()).toContain("No schools within 5 km. Try a larger range.");
    const btn = w.$("rv-fas-state").querySelector("button")!;
    expect(btn.textContent).toBe("Search 50 km");
    btn.click();
    await flush(12);
    expect(w.urls().at(-1)).toContain("radius=50");
    expect(w.radius.value).toBe("50");
  });

  it("empty database (no dataset uploaded yet)", async () => {
    const w = await mount(async () => ok({ success: true, dataset: null, total: 0, results: [], near: { center: null, pincodeKnown: false, radiusKm: 25, limit: 50 } }));
    await w.search("110001");
    await new Promise((r) => setTimeout(r, 1200));
    await flush();
    expect(w.stateText()).toContain("No data uploaded yet");
  });

  it("API failure (network): an error with Try again, the map is not broken, and the form still works afterwards", async () => {
    let fail = true;
    const w = await mount(async () => { if (fail) throw new Error("offline"); return ok(found([hit()])); });
    await w.search("110001");
    expect(w.stateText()).toContain("not available right now");
    expect(w.summary()).toBe("The search could not be completed.");
    expect((document.getElementById("rv-fas-go") as HTMLButtonElement).disabled).toBe(false);
    expect(document.getElementById("rv-fas-map")).not.toBeNull();
    fail = false;
    (w.$("rv-fas-state").querySelector("button") as HTMLButtonElement).click();
    await flush(12);
    expect(w.cards()).toHaveLength(1);
  });

  it("API failure (HTTP 500 / bad JSON): same friendly error", async () => {
    const w = await mount(async () => ({ ok: false, status: 500, json: async () => { throw new Error("not json"); } }) as unknown as Response);
    await w.search("110001");
    expect(w.stateText()).toContain("not available right now");
  });

  it("the API rejects the request (400): its message is shown", async () => {
    const w = await mount(async () => ok({ success: false, message: "radius must be a whole number of km between 1 and 50." }, 400));
    await w.search("110001");
    expect(w.stateText()).toContain("radius must be a whole number");
  });

  it("Leaflet unavailable: the list still works and the map explains itself", async () => {
    delete (window as any).L;
    document.body.innerHTML = markup(PANEL) + markup(RESULTS);
    (window as any).RoboValleyApi = { base: API };
    (window as any).fetch = vi.fn(async () => ok(found([hit()])));
    const realAppend = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, "appendChild").mockImplementation(((n: any) => { if (n.tagName === "SCRIPT") { setTimeout(() => n.onerror?.(), 0); return n; } return realAppend(n); }) as any);
    (0, eval)(scriptOf(RESULTS));
    await flush();
    (document.getElementById("rv-fas-location") as HTMLInputElement).value = "110001";
    document.getElementById("rv-fas-form")!.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await flush(12);
    expect(document.querySelectorAll("#rv-fas-list > li")).toHaveLength(1);
    expect(document.getElementById("rv-fas-map-msg")!.textContent).toContain("map could not load");
  });

  it("no API address configured: a clear message, no request", async () => {
    const w = await mount(async () => ok(found([])), { api: null });
    await w.search("110001");
    expect(w.fetchMock).not.toHaveBeenCalled();
    expect(w.stateText()).toContain("not available");
  });
});

describe("uploaded text is never HTML", () => {
  it("a school name, district and state with markup are shown as plain text (list and map popup)", async () => {
    const evil = "<img src=x onerror=alert(1)><script>alert(2)</script>";
    const w = await mount(async () => ok(found([hit({ schoolName: evil, district: "<b>D</b>", state: "<i>S</i>" }), hit({ id: "2", schoolName: "Other School" })])));
    await w.search("110001");
    expect(document.querySelector("#rv-fas-list img, #rv-fas-list script, #rv-fas-list b, #rv-fas-list i")).toBeNull();
    expect(w.cards()[0].querySelector("h3")!.textContent).toBe(evil);
    expect(w.cards()[0].textContent).toContain("<b>D</b>");
    w.calls.markers[0].el.click(); // two schools at one point: the click opens the list popup
    const popup = w.calls.popups[0].content as HTMLElement;
    expect(popup instanceof HTMLElement).toBe(true);
    expect(popup.querySelector("img, script")).toBeNull();
    expect(popup.textContent).toContain(evil);
  });
  it("the widget code never uses innerHTML", () => {
    expect(scriptOf(RESULTS)).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write/);
  });
});

describe("credits", () => {
  it("the map credits OpenStreetMap and GeoNames (CC BY 4.0) with a link to geonames.org", () => {
    expect(RESULTS).toContain("https://www.openstreetmap.org/copyright");
    expect(RESULTS).toContain("Postal code data: <a href=\"https://www.geonames.org/\"");
    expect(RESULTS).toContain("(CC BY 4.0)");
  });
});
