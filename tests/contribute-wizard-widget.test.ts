// @vitest-environment jsdom
// The Contribute wizard widget: steps, preset sectors, 14 types, validation messages in a live region, focus, the sign-in return,
// save draft / submit calls, one photo with a description, private contact off by default, honeypot, failures. Network is faked.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HTML = readFileSync(join(__dirname, "../frontend/elementor/contribute-wizard/widgets/02-contribute-wizard.html"), "utf8");
const SCRIPT = /<script>([\s\S]*?)<\/script>/.exec(HTML)![1];
const MARKUP = HTML.replace(/<script>[\s\S]*?<\/script>/g, "").replace(/<style>[\s\S]*?<\/style>/g, "");
const flush = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => { if (body === undefined) throw new Error("not json"); return body; } }) as Response;
const SECTORS = [
  { slug: "agriculture-dairy", name: "Agriculture & Dairy" }, { slug: "education", name: "Education" }, { slug: "healthcare", name: "Healthcare" },
];
type Call = { url: string; method: string; body: any; form?: FormData };
let calls: Call[], routes: (c: Call) => Response | undefined, signedIn: boolean;
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const body = () => $("rv-wz-body");
const heading = () => $("rv-wz-h");
const click = (label: string) => { const b = [...body().querySelectorAll("button")].find((x) => x.textContent === label) as HTMLButtonElement; if (!b) throw new Error("no button " + label); b.click(); };
const type = (id: string, v: string) => { const e = $(id) as HTMLInputElement; e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); };

async function mount(opts: { search?: string; signedIn?: boolean; sectorsOk?: boolean } = {}) {
  document.body.innerHTML = MARKUP;
  (window as any).RoboValleyApi = { base: "https://app.example.test" };
  signedIn = opts.signedIn ?? true; calls = [];
  routes = () => undefined;
  history.replaceState(null, "", "/contribute-now/" + (opts.search ?? ""));
  (window as any).fetch = vi.fn(async (url: string, init: any = {}) => {
    const path = String(url).replace("https://app.example.test", "");
    const c: Call = { url: path, method: init.method || "GET", body: typeof init.body === "string" ? JSON.parse(init.body) : undefined, form: init.body instanceof FormData ? init.body : undefined };
    calls.push(c);
    const custom = routes(c); if (custom) return custom;
    if (path === "/api/contributions/sectors") return opts.sectorsOk === false ? reply({ success: false }, 500) : reply({ success: true, sectors: SECTORS });
    if (path === "/api/auth/me") return reply({ role: signedIn ? "user" : null, firstName: signedIn ? "Asha" : null });
    if (path === "/api/contributions" && c.method === "POST") return reply({ success: true, id: 41, status: "draft" }, 201);
    if (/^\/api\/contributions\/41$/.test(path)) return reply({ success: true, id: 41, status: "draft" });
    if (/\/photos$/.test(path)) return reply({ success: true, photoId: 1 }, 201);
    if (/\/contact$/.test(path)) return reply({ success: true, id: 41 });
    if (/\/submit$/.test(path)) return reply({ success: true, id: 41, status: "pending_review" });
    return reply({ success: false }, 404);
  });
  (0, eval)(SCRIPT);
  await flush();
}
const pick = (slugs: string[]) => { const ev = new CustomEvent("rv-contribute-pick", { detail: { sectors: slugs }, cancelable: true }); document.dispatchEvent(ev); return ev; };
async function toDetails() {
  await mount(); pick(["agriculture-dairy"]); await flush();
  click("Continue"); await flush();
  (body().querySelector('input[value="problem"]') as HTMLInputElement).click();
  click("Continue"); await flush();
}
const fill = () => { type("rv-wz-f-title", "Milking by hand takes hours"); type("rv-wz-f-description", "Every morning twenty cows are milked by hand."); };
beforeEach(() => { document.body.innerHTML = ""; });
afterEach(() => { document.body.innerHTML = ""; history.replaceState(null, "", "/"); });

describe("starting", () => {
  it("stays hidden until the hub hands over the chosen sectors, and claims the event", async () => {
    await mount();
    expect($("rv-wz").hidden).toBe(true);
    const ev = pick(["education"]); await flush();
    expect(ev.defaultPrevented).toBe(true);
    expect($("rv-wz").hidden).toBe(false);
    expect($("rv-wz-steps").textContent).toBe("Step 1 of 4: Scope");
  });
  it("presets the chosen sectors and offers all the others", async () => {
    await mount(); pick(["education"]); await flush();
    const boxes = [...body().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes.map((b) => [b.value, b.checked])).toEqual([["agriculture-dairy", false], ["education", true], ["healthcare", false]]);
  });
  it("opens by itself with the sectors from ?sector= after signing in, ignoring unknown ones", async () => {
    await mount({ search: "?sector=agriculture-dairy,nope" });
    expect($("rv-wz").hidden).toBe(false);
    const boxes = [...body().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes.filter((b) => b.checked).map((b) => b.value)).toEqual(["agriculture-dairy"]);
  });
  it("moves focus to each step's heading", async () => {
    await mount(); pick(["education"]); await flush();
    expect(document.activeElement).toBe(heading());
    click("Continue"); await flush();
    expect(heading().textContent).toMatch(/What do you want to contribute/);
    expect(document.activeElement).toBe(heading());
  });
  it("a failure to load the sectors says so kindly", async () => {
    await mount({ sectorsOk: false }); pick(["education"]); await flush();
    expect(body().textContent).toMatch(/could not be loaded/);
  });
});

describe("signed out", () => {
  it("asks to sign in first and returns to the same page and sectors", async () => {
    await mount({ signedIn: false }); pick(["agriculture-dairy", "education"]); await flush();
    expect(heading().textContent).toBe("Sign in to contribute");
    const a = body().querySelector("a.rv-wz-btn--primary") as HTMLAnchorElement;
    const href = new URL(a.href);
    expect(href.origin).toBe("https://app.example.test"); expect(href.pathname).toBe("/login");
    expect(href.searchParams.get("returnTo")).toBe("http://localhost:3000/contribute-now/?sector=agriculture-dairy,education".replace("http://localhost:3000", location.origin));
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
  it("a 401 from the server while saving sends you to sign in, keeping what you typed", async () => {
    await toDetails(); fill();
    routes = (c) => (c.method === "POST" && c.url === "/api/contributions" ? reply({ success: false, error: "SIGN_IN_REQUIRED" }, 401) : undefined);
    click("Save draft"); await flush();
    expect(heading().textContent).toBe("Sign in to contribute");
  });
});

describe("steps and validation", () => {
  it("scope needs at least one sector, with the message in the live region", async () => {
    await mount(); pick([]); await flush();
    click("Continue"); await flush();
    expect($("rv-wz-errors").hidden).toBe(false);
    expect($("rv-wz-errors").getAttribute("role")).toBe("alert");
    expect($("rv-wz-errors").textContent).toContain("Choose at least one sector.");
    expect(heading().textContent).toMatch(/Which sectors/);
  });
  it("the 14 types are one radio group, and one must be chosen", async () => {
    await mount(); pick(["education"]); await flush(); click("Continue"); await flush();
    const radios = [...body().querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios).toHaveLength(14);
    expect(new Set(radios.map((r) => r.name)).size).toBe(1);
    expect(body().querySelector('[role="radiogroup"]')).toBeTruthy();
    click("Continue"); await flush();
    expect($("rv-wz-errors").textContent).toContain("Choose what you want to contribute.");
    radios[0].click(); click("Continue"); await flush();
    expect(heading().textContent).toMatch(/Tell us the details/);
  });
  it("details: every error is under its field, in the live region, and the first bad field gets focus", async () => {
    await toDetails();
    click("Preview"); await flush();
    expect(($("rv-wz-f-title") as HTMLElement).getAttribute("aria-invalid")).toBe("true");
    expect($("rv-wz-f-title-err").textContent).toMatch(/at least 5 characters/);
    expect($("rv-wz-f-description-err").textContent).toMatch(/at least 10 characters/);
    expect($("rv-wz-errors").textContent).toMatch(/at least 5 characters/);
    expect(document.activeElement).toBe($("rv-wz-f-title"));
    expect(($("rv-wz-f-title") as HTMLElement).getAttribute("aria-describedby")).toContain("rv-wz-f-title-err");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0); // nothing is sent while the form is wrong
  });
  it("a photo needs a description, and a file that is too big or not JPG/PNG is refused here with the plain message", async () => {
    await toDetails(); fill();
    const file = $("rv-wz-f-photo") as HTMLInputElement;
    const set = (f: File) => { Object.defineProperty(file, "files", { value: [f], configurable: true }); file.dispatchEvent(new Event("change")); };
    set(new File(["x"], "a.jpg", { type: "image/jpeg" })); click("Preview"); await flush();
    expect($("rv-wz-f-alt-err").textContent).toMatch(/Describe the photo/);
    set(new File([new Uint8Array(4 * 1024 * 1024 + 1)], "big.png", { type: "image/png" })); type("rv-wz-f-alt", "A shed"); click("Preview"); await flush();
    expect($("rv-wz-f-photo-err").textContent).toBe("That photo is larger than 4 MB. Choose a smaller one.");
    set(new File(["x"], "a.gif", { type: "image/gif" })); click("Preview"); await flush();
    expect($("rv-wz-f-photo-err").textContent).toBe("Photos must be JPG or PNG.");
  });
  it("contact details are OFF by default and hidden; switching them on asks for a name and a way to reach you", async () => {
    await toDetails(); fill();
    const on = $("rv-wz-contact-on") as HTMLInputElement;
    expect(on.checked).toBe(false);
    expect(($("rv-wz-f-name").parentElement!.parentElement as HTMLElement).hidden).toBe(true);
    on.click(); on.dispatchEvent(new Event("change"));
    expect(($("rv-wz-f-name").parentElement!.parentElement as HTMLElement).hidden).toBe(false);
    click("Preview"); await flush();
    expect($("rv-wz-f-name-err").textContent).toBe("Tell us who to contact.");
    expect($("rv-wz-f-email-err").textContent).toBe("Give an email address or a mobile number.");
  });
  it("the preview shows what will be read, never raw HTML", async () => {
    await toDetails();
    type("rv-wz-f-title", "<b>Bold</b> title here"); type("rv-wz-f-description", "A long enough description <img src=x onerror=alert(1)>");
    click("Preview"); await flush();
    expect(heading().textContent).toMatch(/Check it before/);
    expect(body().querySelector("img")).toBeNull();
    expect(body().querySelector("b")).toBeNull();
    expect(body().textContent).toContain("<b>Bold</b> title here");
    expect(body().textContent).toContain("Agriculture & Dairy");
    expect(body().textContent).toContain("Report a problem");
    expect(body().textContent).toContain("None left");
  });
});

describe("saving and sending", () => {
  it("Save draft creates a draft once, then updates it; the hidden field is sent empty", async () => {
    await toDetails(); fill();
    click("Save draft"); await flush();
    const first = calls.filter((c) => c.url.startsWith("/api/contributions") && c.method !== "GET" && !c.url.includes("sector"));
    expect(first[0]).toMatchObject({ method: "POST", url: "/api/contributions" });
    expect(first[0].body).toMatchObject({ sectors: ["agriculture-dairy"], type: "problem", title: "Milking by hand takes hours", website: "" });
    expect($("rv-wz-status").textContent).toMatch(/draft is saved/);
    click("Save draft"); await flush();
    expect(calls.filter((c) => c.method === "PATCH").map((c) => c.url)).toEqual(["/api/contributions/41"]);
    expect(calls.filter((c) => c.method === "POST" && c.url === "/api/contributions")).toHaveLength(1);
  });
  it("Submit saves, uploads the photo, saves private contact, then submits, in that order, and ends kindly", async () => {
    await toDetails(); fill();
    const file = $("rv-wz-f-photo") as HTMLInputElement;
    Object.defineProperty(file, "files", { value: [new File(["abc"], "shed.jpg", { type: "image/jpeg" })], configurable: true }); file.dispatchEvent(new Event("change"));
    type("rv-wz-f-alt", "A cow shed");
    const on = $("rv-wz-contact-on") as HTMLInputElement; on.click(); on.dispatchEvent(new Event("change"));
    type("rv-wz-f-name", "Asha Rao"); type("rv-wz-f-email", "asha@example.com");
    click("Preview"); await flush(); click("Submit for review"); await flush(20);
    const seq = calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.url}`);
    expect(seq).toEqual(["POST /api/contributions", "POST /api/contributions/41/photos", "PUT /api/contributions/41/contact", "POST /api/contributions/41/submit"]);
    const photo = calls.find((c) => /photos$/.test(c.url))!.form!;
    expect(photo.get("alt")).toBe("A cow shed"); expect((photo.get("photo") as File).name).toBe("shed.jpg");
    expect(calls.find((c) => /contact$/.test(c.url))!.body).toEqual({ name: "Asha Rao", email: "asha@example.com", phone: "", shareWithModerators: false });
    expect(heading().textContent).toMatch(/sent for review/);
    expect(document.activeElement).toBe(heading());
  });
  it("without a photo or contact it makes only the two calls it needs", async () => {
    await toDetails(); fill(); click("Preview"); await flush(); click("Submit for review"); await flush(20);
    expect(calls.filter((c) => c.method !== "GET").map((c) => c.url)).toEqual(["/api/contributions", "/api/contributions/41/submit"]);
  });
  it("server field errors are shown under the right field, even from another step", async () => {
    await toDetails(); fill();
    routes = (c) => (c.method === "POST" && c.url === "/api/contributions" ? reply({ success: false, message: "Please fix the highlighted fields.", fieldErrors: { title: "Give it a title of at least 5 characters." } }, 400) : undefined);
    click("Save draft"); await flush();
    expect($("rv-wz-f-title-err").textContent).toMatch(/title/);
    expect($("rv-wz-errors").textContent).toContain("Please fix the highlighted fields.");
  });
  it("a duplicate, a rate limit and a missing setup each get a plain message", async () => {
    for (const [status, body, want] of [
      [409, { success: false, error: "DUPLICATE", message: "This looks the same as something that was already sent." }, /same as something/],
      [429, { success: false, error: "RATE_LIMITED", retryAfter: 12, message: "x" }, /try again in 12 seconds/],
      [503, { success: false, error: "NOT_SET_UP", message: "x" }, /not open yet/],
      [500, { success: false, message: "Something went wrong. Please try again." }, /Something went wrong/],
    ] as const) {
      await toDetails(); fill();
      routes = (c) => (c.method === "POST" && c.url === "/api/contributions" ? reply(body, status) : undefined);
      click("Save draft"); await flush();
      expect($("rv-wz-errors").textContent).toMatch(want);
      expect($("rv-wz-errors").textContent).not.toMatch(/undefined|\[object/);
    }
  });
  it("a network failure says so and keeps the form", async () => {
    await toDetails(); fill();
    (window as any).fetch = vi.fn(async () => { throw new TypeError("offline"); });
    click("Save draft"); await flush();
    expect($("rv-wz-errors").textContent).toMatch(/could not reach RoboValley/);
    expect(($("rv-wz-f-title") as HTMLInputElement).value).toBe("Milking by hand takes hours");
  });
  it("a filled hidden field is passed to the server, which then pretends success", async () => {
    await toDetails(); fill();
    type("rv-wz-website", "http://spam.example");
    click("Save draft"); await flush();
    expect(calls.find((c) => c.method === "POST")!.body.website).toBe("http://spam.example");
  });
  it("after finishing, 'Contribute in another sector' starts again with nothing carried over", async () => {
    await toDetails(); fill(); click("Preview"); await flush(); click("Submit for review"); await flush(20);
    click("Contribute in another sector"); await flush();
    expect(heading().textContent).toMatch(/Which sectors/);
    expect([...body().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].some((b) => b.checked)).toBe(false);
  });
});

describe("the file itself", () => {
  it("has no markup injection (every dynamic value goes through textContent), no console output and no external addresses", () => {
    expect(SCRIPT).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write|eval\(/);
    expect(SCRIPT).not.toMatch(/console\./);
    expect(SCRIPT).not.toMatch(/https?:\/\/(?!app\.example)/);
  });
  it("every button and control is at least 44 px high in the style sheet", () => {
    expect(HTML).toMatch(/\.rv-wz-btn\{[^}]*min-height:44px/);
    expect(HTML).toMatch(/\.rv-wz-opt\{[^}]*min-height:44px/);
    expect(HTML).toMatch(/\.rv-wz-in,\.rv-wz-ta\{[^}]*min-height:44px/);
  });
  it("the page file is exactly what the widgets produce", () => {
    expect(() => execFileSync("node", ["scripts/build-contribute-wizard.mjs", "--check"], { cwd: join(__dirname, ".."), stdio: "pipe" })).not.toThrow();
  });
});
