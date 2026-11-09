// @vitest-environment jsdom
// "Your contributions" widget, the hub's signed-in strip, and the wizard's edit mode. The network is faked; nothing real is contacted.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveReturnTo } from "../src/lib/session";

const load = (p: string) => { const h = readFileSync(join(__dirname, "..", p), "utf8"); return { h, script: /<script>([\s\S]*?)<\/script>/.exec(h)![1], markup: h.replace(/<script>[\s\S]*?<\/script>/g, "").replace(/<style>[\s\S]*?<\/style>/g, "") }; };
const MINE = load("frontend/elementor/contribute-mine/widgets/03-your-contributions.html");
const HUB = load("frontend/elementor/contribute-hub/widgets/01-contribute-hub.html");
const WIZ = load("frontend/elementor/contribute-wizard/widgets/02-contribute-wizard.html");
const flush = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => { if (body === undefined) throw new Error("not json"); return body; } }) as Response;
const $ = (id: string) => document.getElementById(id) as HTMLElement;
let calls: string[];
const item = (o: Record<string, unknown>) => ({ id: 1, title: "A title", type: "problem", typeLabel: "Report a problem", status: "draft", statusLabel: "Draft", sectors: [{ slug: "agriculture-dairy", name: "Agriculture & Dairy" }], note: null, canEdit: true, updatedAt: "2026-11-09T10:00:00.000Z", ...o });
const MINE_DATA = {
  success: true, contributor: true,
  counts: { draft: 1, changes_requested: 1, pending_review: 1, published: 1, unpublished: 0, rejected: 1 },
  items: [
    item({ id: 5, title: "Draft one", status: "draft" }),
    item({ id: 6, title: "Needs work", status: "changes_requested", note: "Please add the district. <b>x</b>" }),
    item({ id: 7, title: "Waiting", status: "pending_review" }),
    item({ id: 8, title: "Live one", status: "published" }),
    item({ id: 9, title: "Not this time", status: "rejected", note: "This is an advert.", canEdit: false }),
  ],
};
function run(m: { script: string; markup: string }, routes: (path: string) => Response | undefined, search = "") {
  document.body.innerHTML = m.markup;
  (window as any).RoboValleyApi = { base: "https://app.example.test" };
  history.replaceState(null, "", "/page/" + search);
  calls = [];
  (window as any).fetch = vi.fn(async (u: string) => { const p = String(u).replace("https://app.example.test", ""); calls.push(p); return routes(p) ?? reply({ success: false }, 404); });
  (0, eval)(m.script);
  return flush();
}
const signedIn = (extra: (p: string) => Response | undefined = () => undefined) => (p: string) => extra(p) ?? (p === "/api/auth/me" ? reply({ role: "user", firstName: "Asha" }) : p === "/api/contributions/mine" ? reply(MINE_DATA) : undefined);
beforeEach(() => { document.body.innerHTML = ""; });
afterEach(() => { document.body.innerHTML = ""; history.replaceState(null, "", "/"); });

describe("Your contributions widget", () => {
  it("groups by status in a fixed order with counts, and shows the Contributor badge", async () => {
    await run(MINE, signedIn());
    expect(calls).toEqual(["/api/auth/me", "/api/contributions/mine"]);
    expect([...document.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(["Drafts (1)", "Changes requested (1)", "Pending review (1)", "Published (1)", "Not accepted (1)"]);
    expect($("rv-my-badge").hidden).toBe(false);
    expect(document.querySelector(".rv-my-counts")!.textContent).toContain("Published: 1");
  });
  it("no badge when the API says you are not a contributor yet", async () => {
    await run(MINE, signedIn((p) => (p === "/api/contributions/mine" ? reply({ ...MINE_DATA, contributor: false, items: [MINE_DATA.items[0]], counts: { draft: 1 } }) : undefined)));
    expect($("rv-my-badge").hidden).toBe(true);
  });
  it("shows the moderator's note as text (never markup), and a kind message for a rejected item", async () => {
    await run(MINE, signedIn());
    const notes = [...document.querySelectorAll(".rv-my-note")].map((n) => n.textContent);
    expect(notes[0]).toContain("Note from the moderator"); expect(notes[0]).toContain("Please add the district. <b>x</b>");
    expect(document.querySelector(".rv-my-note b")).toBeNull();
    expect(document.body.textContent).toContain("Thank you for taking the time to share this. It was not accepted this time.");
    expect(document.body.textContent).not.toMatch(/rejected/i);
  });
  it("edit links only where editing is allowed, labelled with the title for screen readers, pointing at the form", async () => {
    await run(MINE, signedIn());
    const links = [...document.querySelectorAll<HTMLAnchorElement>(".rv-my-actions a")].filter((a) => /edit=/.test(a.href));
    expect(links.map((a) => new URL(a.href).searchParams.get("edit"))).toEqual(["5", "6", "7", "8"]); // none for the rejected item 9
    expect(links[0].getAttribute("aria-label")).toBe("Continue editing: Draft one");
    expect(links[3].textContent).toBe("Edit (goes back for review)");
    expect(new URL(links[0].href).pathname).toBe("/contribute-now/");
  });
  it("offers 'Pick another sector and contribute again'", async () => {
    await run(MINE, signedIn());
    const a = [...document.querySelectorAll<HTMLAnchorElement>("a")].find((x) => /another sector/.test(x.textContent || ""))!;
    expect(new URL(a.href).pathname).toBe("/contribute-now/");
  });
  it("the contribute address is configurable on the widget", async () => {
    document.body.innerHTML = MINE.markup.replace('data-contribute-url="/contribute-now/"', 'data-contribute-url="/share/"');
    (window as any).RoboValleyApi = { base: "https://app.example.test" };
    (window as any).fetch = vi.fn(async (u: string) => signedIn()(String(u).replace("https://app.example.test", "")));
    (0, eval)(MINE.script); await flush();
    expect(new URL(document.querySelector<HTMLAnchorElement>(".rv-my-actions a")!.href).pathname).toBe("/share/");
  });
  it("an empty account is told kindly with a way in", async () => {
    await run(MINE, signedIn((p) => (p === "/api/contributions/mine" ? reply({ success: true, contributor: false, counts: {}, items: [] }) : undefined)));
    expect($("rv-my-state").textContent).toContain("You have not started a contribution yet");
    expect($("rv-my-state").querySelector("a")).toBeTruthy();
  });
  it("signed out: asks to sign in, returning to this page, and never asks for the list", async () => {
    await run(MINE, (p) => (p === "/api/auth/me" ? reply({ role: null, firstName: null }) : undefined));
    expect(calls).toEqual(["/api/auth/me"]);
    const a = $("rv-my-state").querySelector("a") as HTMLAnchorElement;
    expect(new URL(a.href).pathname).toBe("/login");
    expect(new URL(a.href).searchParams.get("returnTo")).toBe(location.origin + location.pathname);
  });
  it("401, 429, 503, 500, a network failure and bad JSON each show a plain message", async () => {
    for (const [status, body, want] of [[401, { success: false }, /sign in/i], [429, { retryAfter: 9 }, /try again in 9 seconds/], [503, { success: false }, /not open yet/], [500, { success: false }, /could not be loaded/], [200, undefined, /could not be loaded/]] as const) {
      await run(MINE, signedIn((p) => (p === "/api/contributions/mine" ? reply(body as never, status) : undefined)));
      expect($("rv-my-state").textContent).toMatch(want); expect($("rv-my-state").textContent).not.toMatch(/undefined|\[object|null/);
    }
    document.body.innerHTML = MINE.markup; (window as any).RoboValleyApi = { base: "https://x.test" };
    (window as any).fetch = vi.fn(async () => { throw new TypeError("offline"); }); (0, eval)(MINE.script); await flush();
    expect($("rv-my-state").textContent).toMatch(/check your connection/);
  });
  it("the file has no markup injection, storage or console use, and its page file is in sync", () => {
    expect(MINE.script).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write|eval\(|localStorage|sessionStorage|document\.cookie|console\./);
    expect(MINE.h).toMatch(/\.rv-my-btn\{[^}]*min-height:44px/);
    expect(() => execFileSync("node", ["scripts/build-contribute-mine.mjs", "--check"], { cwd: join(__dirname, ".."), stdio: "pipe" })).not.toThrow();
    expect(() => execFileSync("node", ["scripts/build-contribute-hub.mjs", "--check"], { cwd: join(__dirname, ".."), stdio: "pipe" })).not.toThrow();
    expect(() => execFileSync("node", ["scripts/build-contribute-wizard.mjs", "--check"], { cwd: join(__dirname, ".."), stdio: "pipe" })).not.toThrow();
  });
});

describe("the hub when you are signed in", () => {
  const SECTORS = { success: true, sectors: [{ slug: "agriculture-dairy", name: "Agriculture & Dairy", contributions: 1, contributors: null, empty: false }] };
  const hubRoutes = (who: unknown, mine: Response | undefined = reply(MINE_DATA)) => (p: string) => (p === "/api/contributions/sectors" ? reply(SECTORS) : p === "/api/auth/me" ? reply(who) : p === "/api/contributions/mine" ? mine : undefined);
  it("greets by first name, shows the badge and the count, and links to Your contributions", async () => {
    await run(HUB, hubRoutes({ role: "user", firstName: "Asha" }));
    const me = $("rv-hub-me");
    expect(me.hidden).toBe(false);
    expect(me.textContent).toContain("Welcome back, Asha.");
    expect(me.querySelector(".rv-hub-badge")!.textContent).toBe("Contributor");
    const a = me.querySelector("a") as HTMLAnchorElement;
    expect(a.textContent).toBe("Your contributions (5)"); expect(new URL(a.href).pathname).toBe("/your-contributions/");
  });
  it("no badge for a signed-in person with no submission yet", async () => {
    await run(HUB, hubRoutes({ role: "user", firstName: null }, reply({ success: true, contributor: false, items: [], counts: {} })));
    expect($("rv-hub-me").querySelector(".rv-hub-badge")).toBeNull();
    expect($("rv-hub-me").textContent).toContain("Welcome back.");
  });
  it("a visitor sees nothing extra and the list is never requested", async () => {
    await run(HUB, hubRoutes({ role: null, firstName: null }));
    expect($("rv-hub-me").hidden).toBe(true);
    expect(calls).not.toContain("/api/contributions/mine");
  });
  it("if the list fails the hub still works and shows no strip", async () => {
    await run(HUB, hubRoutes({ role: "user", firstName: "A" }, reply(undefined, 500)));
    expect($("rv-hub-me").textContent).toContain("Welcome back, A.");
    expect(document.querySelectorAll(".rv-hub-card")).toHaveLength(1);
  });
});

describe("the form opens your own contribution with ?edit=", () => {
  const C = { id: 41, status: "changes_requested", editable: true, type: "costs", robotType: "milking-robot", sectors: ["agriculture-dairy"], title: "Costs of milking by hand", description: "Three people, two hours every morning.", howNow: "By hand", affected: "", timeCost: "", improvement: "", role: "Farmer", district: "Guntur", photos: [{ id: 1 }], contact: { name: "Asha Rao", email: "asha@example.com", phone: null, shareWithModerators: true } };
  const routes = (c: unknown, status = 200) => (p: string) => p === "/api/contributions/sectors" ? reply({ success: true, sectors: [{ slug: "agriculture-dairy", name: "Agriculture & Dairy" }] }) : p === "/api/auth/me" ? reply({ role: "user" }) : p === "/api/contributions/41" ? reply(status === 200 ? { success: true, contribution: c } : { success: false }, status) : undefined;
  it("loads it straight into the details step, filled in, with its private contact details", async () => {
    await run(WIZ, routes(C), "?edit=41");
    expect(document.getElementById("rv-wz-h")!.textContent).toMatch(/Tell us the details/);
    expect(($("rv-wz-f-title") as HTMLInputElement).value).toBe("Costs of milking by hand");
    expect(($("rv-wz-f-howNow") as HTMLInputElement).value).toBe("By hand");
    expect(($("rv-wz-f-district") as HTMLInputElement).value).toBe("Guntur");
    expect(($("rv-wz-contact-on") as HTMLInputElement).checked).toBe(true);
    expect(($("rv-wz-f-name") as HTMLInputElement).value).toBe("Asha Rao");
    expect($("rv-wz-body").textContent).toContain("A photo is already saved");
    expect(calls).toContain("/api/contributions/41");
  });
  it("saving updates (PATCH) instead of creating a second contribution", async () => {
    const seen: { m: string; u: string }[] = [];
    document.body.innerHTML = WIZ.markup; (window as any).RoboValleyApi = { base: "https://app.example.test" }; history.replaceState(null, "", "/page/?edit=41");
    (window as any).fetch = vi.fn(async (u: string, init: any = {}) => { const p = String(u).replace("https://app.example.test", ""); seen.push({ m: init.method || "GET", u: p }); return (init.method === "PATCH" ? undefined : routes(C)(p)) ?? reply({ success: true, id: 41, status: "changes_requested" }); });
    (0, eval)(WIZ.script); await flush();
    ([...$("rv-wz-body").querySelectorAll("button")].find((b) => b.textContent === "Save draft") as HTMLButtonElement).click(); await flush(20);
    expect(seen.filter((s) => s.m !== "GET").map((s) => `${s.m} ${s.u}`)).toEqual(["PATCH /api/contributions/41", "PUT /api/contributions/41/contact"]);
  });
  it("somebody else's, a closed one and a failure each say so plainly", async () => {
    await run(WIZ, routes(null, 404), "?edit=41");
    expect($("rv-wz-body").textContent).toMatch(/could not find that contribution/);
    await run(WIZ, routes({ ...C, editable: false }), "?edit=41");
    expect($("rv-wz-body").textContent).toMatch(/closed by a moderator/);
    await run(WIZ, routes(null, 500), "?edit=41");
    expect($("rv-wz-body").textContent).toMatch(/could not be opened/);
  });
  it("a bad edit value is ignored, and signed out it asks to sign in", async () => {
    await run(WIZ, routes(C), "?edit=abc");
    expect($("rv-wz").hidden).toBe(true);
    await run(WIZ, (p) => (p === "/api/auth/me" ? reply({ role: null }) : routes(C)(p)), "?edit=41");
    expect(document.getElementById("rv-wz-h")!.textContent).toBe("Sign in to contribute");
  });
});

describe("returning after sign-in to Your contributions", () => {
  const env = { SITE_URL: "https://techytree.in/" } as unknown as NodeJS.ProcessEnv;
  it("allows exactly that page", () => {
    expect(resolveReturnTo("/your-contributions/", env)).toBe("https://techytree.in/your-contributions/");
    expect(resolveReturnTo("https://techytree.in/your-contributions", env)).toBe("https://techytree.in/your-contributions/");
    for (const bad of ["https://evil.example/your-contributions/", "/your-contributions/../admin/", "/your-contributions/x", "//evil.example/your-contributions/"]) expect(resolveReturnTo(bad, env)).toBeNull();
  });
  it("CONTRIBUTE_MINE_PATH can rename it; a bad value falls back", () => {
    expect(resolveReturnTo("/mine/", { ...env, CONTRIBUTE_MINE_PATH: "/mine/" } as never)).toBe("https://techytree.in/mine/");
    expect(resolveReturnTo("/your-contributions/", { ...env, CONTRIBUTE_MINE_PATH: "//bad" } as never)).toBe("https://techytree.in/your-contributions/");
  });
});
