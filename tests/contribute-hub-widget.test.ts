// @vitest-environment jsdom
// The Contribute hub widget: sector cards with their numbers, "Be the first to contribute", the hidden contributor count, picking one
// or several sectors, the hand-over event to the form, and every failure state. The network is faked; nothing real is contacted.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HTML = readFileSync(join(__dirname, "../frontend/elementor/contribute-hub/widgets/01-contribute-hub.html"), "utf8");
const SCRIPT = /<script>([\s\S]*?)<\/script>/.exec(HTML)![1];
const MARKUP = HTML.replace(/<script>[\s\S]*?<\/script>/g, "").replace(/<style>[\s\S]*?<\/style>/g, "");
const flush = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => { if (body === undefined) throw new Error("not json"); return body; } }) as Response;
const SECTORS = [
  { slug: "agriculture-dairy", name: "Agriculture & Dairy", contributions: 12, contributors: 7, empty: false },
  { slug: "education", name: "Education", contributions: 3, contributors: null, empty: false },
  { slug: "healthcare", name: "Healthcare", contributions: 0, contributors: null, empty: true },
];
let fetchMock: ReturnType<typeof vi.fn>;
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const cards = () => [...document.querySelectorAll<HTMLElement>(".rv-hub-card")];

async function mount(answer: () => Response | Promise<Response> = () => reply({ success: true, sectors: SECTORS })) {
  document.body.innerHTML = MARKUP;
  (window as any).RoboValleyApi = { base: "https://app.example.test" };
  fetchMock = vi.fn(async () => answer());
  (window as any).fetch = fetchMock;
  (0, eval)(SCRIPT);
  await flush();
}
beforeEach(() => { document.body.innerHTML = ""; });
afterEach(() => { document.body.innerHTML = ""; });

describe("sector cards", () => {
  it("asks only the public counts address, once, and shows one card per sector", async () => {
    await mount();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://app.example.test/api/contributions/sectors");
    expect(cards().map((c) => c.querySelector("h2")!.textContent)).toEqual(["Agriculture & Dairy", "Education", "Healthcare"]);
  });

  it("shows the contribution count, and the contributor count only when the API gives one", async () => {
    await mount();
    const [agri, edu] = cards();
    expect(agri.textContent).toContain("12");
    expect(agri.textContent).toContain("published contributions");
    expect(agri.textContent).toContain("7 contributors");
    expect(edu.textContent).toContain("3");
    expect(edu.textContent).not.toMatch(/contributors?\b(?!.*published)/); // contributors null: no contributor line at all
    expect(edu.textContent).not.toContain("null");
  });

  it("an empty sector says 'Be the first to contribute' instead of 0", async () => {
    await mount();
    const empty = cards()[2];
    expect(empty.textContent).toContain("Be the first to contribute");
    expect(empty.textContent).not.toContain("0");
  });

  it("uses the singular for one contribution and one contributor", async () => {
    await mount(() => reply({ success: true, sectors: [{ slug: "a", name: "A sector", contributions: 1, contributors: 1, empty: false }] }));
    expect(cards()[0].textContent).toContain("published contribution");
    expect(cards()[0].textContent).not.toContain("published contributions");
    expect(cards()[0].textContent).toContain("1 contributor");
  });

  it("shows names as text only (markup in a name cannot run)", async () => {
    await mount(() => reply({ success: true, sectors: [{ slug: "x", name: '<img src=x onerror="alert(1)"> Bad', contributions: 1, contributors: null, empty: false }] }));
    expect(document.querySelector("#rv-hub-grid img")).toBeNull();
    expect(cards()[0].querySelector("h2")!.textContent).toContain("<img");
  });

  it("is built for keyboards and screen readers: a labelled group and a labelled checkbox per sector", async () => {
    await mount();
    expect($("rv-hub-grid").getAttribute("role")).toBe("group");
    expect($("rv-hub-grid").getAttribute("aria-label")).toBe("Sectors");
    expect([...document.querySelectorAll<HTMLInputElement>("#rv-hub-grid input")].map((i) => i.getAttribute("aria-label"))).toEqual(["Pick Agriculture & Dairy", "Pick Education", "Pick Healthcare"]);
  });
});

describe("picking sectors", () => {
  const box = (i: number) => document.querySelectorAll<HTMLInputElement>("#rv-hub-grid input")[i];
  const tick = (i: number) => { box(i).checked = !box(i).checked; box(i).dispatchEvent(new Event("change", { bubbles: true })); };

  it("starts with nothing picked and a disabled button", async () => {
    await mount();
    expect(($("rv-hub-go") as HTMLButtonElement).disabled).toBe(true);
    expect($("rv-hub-go").textContent).toBe("Pick a sector to begin");
  });

  it("one or several sectors can be picked, and the button says how many", async () => {
    await mount();
    tick(0);
    expect($("rv-hub-go").textContent).toBe("Contribute in 1 sector");
    expect(cards()[0].className).toContain("is-picked");
    tick(1);
    expect($("rv-hub-go").textContent).toBe("Contribute in 2 sectors");
    tick(0);
    expect($("rv-hub-go").textContent).toBe("Contribute in 1 sector");
    expect(cards()[0].className).not.toContain("is-picked");
    tick(1);
    expect(($("rv-hub-go") as HTMLButtonElement).disabled).toBe(true);
  });

  it("hands the picked sectors to the form through an event", async () => {
    await mount();
    const seen: string[][] = [];
    document.addEventListener("rv-contribute-pick", ((e: CustomEvent) => { seen.push(e.detail.sectors); e.preventDefault(); }) as EventListener, { once: true });
    tick(2); tick(0);
    $("rv-hub-go").click();
    expect(seen).toEqual([["healthcare", "agriculture-dairy"]]);
    expect($("rv-hub-note").hidden).toBe(true);
  });

  it("says so politely when no form is listening yet (and never navigates away)", async () => {
    await mount();
    tick(0);
    $("rv-hub-go").click();
    expect($("rv-hub-note").hidden).toBe(false);
    expect($("rv-hub-note").textContent).toContain("Sharing opens soon");
  });
});

describe("when something is wrong", () => {
  it("shows a friendly message and a Try again button when the numbers are not available, and Try again works", async () => {
    let ok = false;
    await mount(() => (ok ? reply({ success: true, sectors: SECTORS }) : reply({ success: false, error: "SERVER_ERROR" }, 500)));
    expect($("rv-hub-state").textContent).toContain("The sectors are not available right now. Please try again.");
    expect(cards()).toHaveLength(0);
    ok = true;
    ($("rv-hub-state").querySelector("button") as HTMLButtonElement).click();
    await flush();
    expect(cards()).toHaveLength(3);
  });

  it("503 (not set up yet) is the same friendly message, not a crash", async () => {
    await mount(() => reply({ success: false, error: "NOT_SET_UP" }, 503));
    expect($("rv-hub-state").textContent).toContain("not available right now");
  });

  it("429 says how long to wait", async () => {
    await mount(() => reply({ success: false, error: "RATE_LIMITED", retryAfter: 12 }, 429));
    expect($("rv-hub-state").textContent).toContain("Please try again in 12 seconds.");
  });

  it("a network failure or an answer that is not JSON is handled", async () => {
    await mount(() => { throw new Error("offline"); });
    expect($("rv-hub-state").textContent).toContain("could not be loaded");
    await mount(() => reply(undefined));
    expect($("rv-hub-state").textContent).toContain("not available right now");
  });

  it("an empty list says there is nothing yet, and an unexpected shape is ignored safely", async () => {
    await mount(() => reply({ success: true, sectors: [] }));
    expect($("rv-hub-state").textContent).toContain("no sectors to show yet");
    await mount(() => reply({ success: true, sectors: [null, { slug: 5 }, { slug: "ok", name: "Ok sector", contributions: 2, contributors: null, empty: false }] }));
    expect(cards()).toHaveLength(1);
  });

  it("without an API address it says the page is not connected, and asks nothing", async () => {
    document.body.innerHTML = MARKUP;
    (window as any).RoboValleyApi = undefined;
    fetchMock = vi.fn();
    (window as any).fetch = fetchMock;
    (0, eval)(SCRIPT);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect($("rv-hub-state").textContent).toContain("not connected");
  });
});

describe("the page file", () => {
  it("is built from the widget file (node scripts/build-contribute-hub.mjs --check)", () => {
    const out = execFileSync(process.execPath, [join(__dirname, "../scripts/build-contribute-hub.mjs"), "--check"], { encoding: "utf8" });
    expect(out).toContain("up to date");
    const j = JSON.parse(readFileSync(join(__dirname, "../frontend/elementor/contribute-hub/contribute-hub.elementor.json"), "utf8"));
    expect(j.content[0].elements[0].settings.html).toBe(HTML);
    expect(j.title).toContain("DRAFT");
  });
  it("has no internal words, no storage and no cookies, and asks only for the sector counts", () => {
    expect(HTML).not.toMatch(/localStorage|sessionStorage|document\.cookie|navigator\.geolocation|XMLHttpRequest/);
    expect(HTML.match(/fetch\(/g)).toHaveLength(1);
    expect(HTML).toContain("/api/contributions/sectors");
  });
});
