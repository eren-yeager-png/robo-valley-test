// @vitest-environment jsdom
// public/rv-header-menu.js: the shared header account menu, loaded as it is on techytree.in (one <script> tag from the app) and on
// the app's own pages. The page markup copies the live Astra header (old .rv-account-corner, phone header) and the Contribute
// plugin's banner. The real Bootstrap bundle is loaded, so the dropdown behaviour is Bootstrap's own.
import { readFileSync } from "node:fs";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/admin/dashboard" }));
import AdminShell from "../src/app/admin/_components/AdminShell";
import DashboardShell from "../src/app/dashboard/DashboardShell";
import HeaderMenuSlot from "../src/app/_components/HeaderMenuSlot";
import { POST as logoutRoute } from "../src/app/api/auth/logout/route";

const MENU_JS = readFileSync("public/rv-header-menu.js", "utf8");
const BOOTSTRAP_JS = readFileSync("public/vendor/bootstrap-5.3.3/bootstrap.bundle.min.js", "utf8");
const APP = "https://app.techytree.in";
const SITE_PAGE = "https://techytree.in/robots-by-sector/";

// The live techytree.in header (Astra), trimmed: the Contact button, the old account corner in "HTML 1" (which the site's CSS hides
// below 1140 px), the phone header's menu button, the Contribute banner.
const SITE_HTML = `
  <header id="masthead" class="site-header">
    <div id="ast-desktop-header"><div class="site-header-primary-section-right site-header-section">
      <div class="ast-builder-layout-element site-header-focus-item ast-header-button-1"><a href="/contact-us/">contact us</a></div>
      <div class="ast-builder-layout-element site-header-focus-item ast-header-html-1"><div class="ast-builder-html-element">
        <div class="rv-account-corner"><a href="${APP}/login" class="rv-account-link rv-login">Sign In</a></div>
      </div></div>
    </div></div>
    <div id="ast-mobile-header"><div class="site-header-primary-section-right site-header-section ast-flex">
      <div class="ast-builder-layout-element site-header-focus-item" data-section="section-header-mobile-trigger"><button class="menu-toggle">Menu</button></div>
    </div></div>
  </header>
  <div class="rv-c2" id="rv-c2"><p class="notice"><strong id="member-name">Asha</strong> · Registered member <button type="button" id="sign-out">Sign Out</button></p></div>`;

const ANSWERS = {
  visitor: { authenticated: false },
  member: { authenticated: true, role: "member", firstName: "Pilla", initial: "P", stakeholder: "Student", counts: { myContributions: 3 } },
  moderator: { authenticated: true, role: "moderator", firstName: "Ravi", initial: "R", stakeholder: null, counts: { reviewQueue: 12 } },
  admin: { authenticated: true, role: "admin", firstName: "Admin", initial: "A", stakeholder: null, counts: { reviewQueue: 12 } },
};

let fetchMock: ReturnType<typeof vi.fn>;
const answerWith = (body: unknown, status = 200) => {
  fetchMock = vi.fn(async (url: string) => (String(url).endsWith("/api/auth/logout") ? new Response("{}", { status: 200 }) : new Response(JSON.stringify(body), { status })));
  vi.stubGlobal("fetch", fetchMock);
};
const goTo = (url: string) => (globalThis as unknown as { jsdom: { reconfigure(o: { url: string }): void } }).jsdom.reconfigure({ url });

function page(html: string) {
  const fresh = document.createElement("body");
  fresh.innerHTML = html;
  document.documentElement.replaceChild(fresh, document.body); // also detaches the previous copy's MutationObserver
  document.head.querySelectorAll("#rv-header-menu-css, #rv-header-menu-hide, script").forEach((n) => n.remove());
  delete (window as unknown as { RVHeaderMenu?: unknown }).RVHeaderMenu;
}
function load(src = `${APP}/rv-header-menu.js`) {
  const tag = document.createElement("script");
  tag.setAttribute("src", src); // jsdom does not fetch it; the code is run below as that tag
  document.head.appendChild(tag);
  Object.defineProperty(document, "currentScript", { configurable: true, get: () => tag });
  window.eval(MENU_JS);
  Object.defineProperty(document, "currentScript", { configurable: true, get: () => null });
}
const menus = () => Array.from(document.querySelectorAll<HTMLElement>(".rv-header-menu"));
const items = (root: Element) => Array.from(root.querySelectorAll<HTMLElement>("[role=menuitem]"));
const labels = (root: Element) => items(root).map((i) => i.querySelector(".rv-hm-label")?.textContent ?? i.textContent);
// WCAG contrast ratio of two #rrggbb / #rgb colours
const luminance = (hex: string) => {
  const h = hex.length === 4 ? hex.slice(1).split("").map((c) => c + c).join("") : hex.slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
};
const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
const drawn = () => waitFor(() => {
  expect(menus().length).toBeGreaterThan(0);
  expect(menus()[0].querySelector(".rv-hm-placeholder")).toBeNull();
});

beforeAll(() => { window.eval(BOOTSTRAP_JS); });
beforeEach(() => { goTo(SITE_PAGE); answerWith(ANSWERS.member); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("on techytree.in (one <script> tag from the app)", () => {
  it("asks the app who is signed in (with the session cookie), loads its stylesheet from the app, and hides the old corner and the Contribute page's Sign Out", async () => {
    page(SITE_HTML); load(); await drawn();
    expect(fetchMock).toHaveBeenCalledWith(`${APP}/api/auth/menu`, expect.objectContaining({ credentials: "include", cache: "no-store" }));
    expect(document.getElementById("rv-header-menu-css")?.getAttribute("href")).toBe(`${APP}/rv-header-menu.css`);
    expect(document.getElementById("rv-header-menu-hide")?.textContent).toBe(".rv-account-corner,.site-header a.rv-signin,.site-header .rv-acct,.site-header .rv-acct-adminwrap{display:none!important}#rv-c2 #sign-out{display:none!important}");
    expect(document.querySelector("#rv-c2 .notice")?.textContent).toContain("Asha · Registered member"); // the text stays
  });

  it("puts the menu in the header row right after Astra's HTML 1 element (not inside it: the site hides it below 1140 px), and in the phone header before its menu button", async () => {
    page(SITE_HTML); load(); await drawn();
    expect(menus()).toHaveLength(2);
    const html1 = document.querySelector(".ast-header-html-1")!;
    expect(html1.nextElementSibling?.classList.contains("rv-header-menu--site")).toBe(true);
    expect(html1.querySelector(".rv-header-menu")).toBeNull();
    const phone = document.querySelector("[data-section='section-header-mobile-trigger']")?.previousElementSibling;
    expect(phone?.classList.contains("rv-header-menu--phone")).toBe(true);
  });

  it("member: green avatar with the initial, 'Registered member · Student', My profile / My contributions (3) / Contribute / Sign Out", async () => {
    page(SITE_HTML); load(); await drawn();
    const m = menus()[0];
    const btn = m.querySelector("button.rv-hm-toggle")!;
    expect(btn.getAttribute("aria-label")).toBe("Account menu for Pilla");
    expect(btn.getAttribute("aria-haspopup")).toBe("menu");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.querySelector("circle")?.getAttribute("fill")).toBe("#2f7d1f");
    expect(btn.querySelector("text")?.textContent).toBe("P");
    expect(m.querySelector(".rv-hm-sub")?.textContent).toBe("Registered member · Student");
    expect(labels(m)).toEqual(["My profile", "My contributions", "Contribute", "Sign Out"]);
    expect(items(m).map((i) => i.getAttribute("href"))).toEqual([`${APP}/dashboard/profile`, "https://techytree.in/contribute-now/#history-title", "https://techytree.in/contribute-now/", null]);
    expect(m.querySelector(".rv-hm-count")?.textContent).toBe("3");
    expect(items(m)[1].getAttribute("aria-label")).toBe("My contributions, 3 contributions");
    expect(items(m)[3].classList.contains("rv-hm-signout")).toBe(true);
  });

  it("moderator: dark green avatar with the gold shield; only Review queue (12) and Sign Out; no dashboard, no admin links", async () => {
    answerWith(ANSWERS.moderator);
    page(SITE_HTML); load(); await drawn();
    const m = menus()[0];
    expect(m.querySelector("button circle")?.getAttribute("fill")).toBe("#1f4d3f");
    expect(m.querySelector("button path[fill='#f2b705']")).not.toBeNull();
    expect(m.querySelector(".rv-hm-sub")?.textContent).toBe("Moderator");
    expect(labels(m)).toEqual(["Review queue", "Sign Out"]);
    expect(items(m)[0].getAttribute("href")).toBe(`${APP}/moderation`);
    expect(m.querySelector(".rv-hm-count")?.textContent).toBe("12");
    expect(m.textContent).not.toMatch(/Moderator dashboard|Admin portal|Users|settings|Landing page|My profile|Sector forms/);
  });

  it("admin: navy avatar with the orange star; Admin portal / Contributions by sector / Sector forms / Review queue (12) / Users & moderators / Site settings / Landing page / My profile / Sign Out", async () => {
    answerWith(ANSWERS.admin);
    page(SITE_HTML); load(); await drawn();
    const m = menus()[0];
    expect(m.querySelector("button circle")?.getAttribute("fill")).toBe("#1e3a5f");
    expect(m.querySelector("button circle[fill='#e8590c']")).not.toBeNull();
    expect(m.querySelector(".rv-hm-sub")?.textContent).toBe("Administrator · full access");
    expect(labels(m)).toEqual(["Admin portal", "Contributions by sector", "Sector forms", "Review queue", "Users & moderators", "Site settings", "Landing page", "My profile", "Sign Out"]);
    expect(items(m).slice(0, 6).map((i) => i.getAttribute("href"))).toEqual(["/admin/dashboard", "/admin/sectors", "/admin/sector-forms", "/moderation", "/admin/users", "/admin/settings"].map((p) => APP + p));
    expect(items(m).slice(6, 8).map((i) => i.getAttribute("href"))).toEqual(["https://techytree.in/", `${APP}/admin/settings#profile`]);
  });

  it("signed out: the grey person icon links to Sign In and comes back to this page; tooltip and label as agreed", async () => {
    answerWith(ANSWERS.visitor);
    page(SITE_HTML); load(); await drawn();
    const a = menus()[0].querySelector("a.rv-hm-signin")!;
    expect(a.getAttribute("href")).toBe(`${APP}/login?returnTo=${encodeURIComponent(SITE_PAGE)}`);
    expect(a.getAttribute("title")).toBe("Sign in / Join");
    expect(a.getAttribute("aria-label")).toBe("Sign in to RoboValley");
    expect(menus()[0].querySelector("button")).toBeNull();
  });

  it("the counts cannot be read: the menu is shown without badges", async () => {
    answerWith({ ...ANSWERS.member, counts: null });
    page(SITE_HTML); load(); await drawn();
    expect(labels(menus()[0])).toEqual(["My profile", "My contributions", "Contribute", "Sign Out"]);
    expect(document.querySelector(".rv-hm-count")).toBeNull();
  });

  it("the app cannot be reached or answers with an error: the Sign In icon, never a broken header", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network"); }));
    page(SITE_HTML); load(); await drawn();
    expect(menus()[0].querySelector("a.rv-hm-signin")).not.toBeNull();
    answerWith({ authenticated: false, error: "SERVICE_UNAVAILABLE" }, 503);
    page(SITE_HTML); load(); await drawn();
    expect(menus()[0].querySelector("a.rv-hm-signin")).not.toBeNull();
  });

  it("Bootstrap's dropdown: a click opens it, Escape closes it and returns focus to the icon, a click outside closes it", async () => {
    page(SITE_HTML); load(); await drawn();
    const m = menus()[0], btn = m.querySelector<HTMLButtonElement>("button.rv-hm-toggle")!, list = m.querySelector(".rv-hm-menu")!;
    btn.click();
    expect(list.classList.contains("show")).toBe(true);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(list.classList.contains("show")).toBe(false);
    expect(document.activeElement).toBe(btn);
    btn.click();
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(list.classList.contains("show")).toBe(false);
  });

  it("no Bootstrap on the page: loads the app's own copy once; if that fails, the same behaviour still works (click, arrow keys, Escape)", async () => {
    const saved = (window as unknown as { bootstrap?: unknown }).bootstrap;
    delete (window as unknown as { bootstrap?: unknown }).bootstrap;
    try {
      page(SITE_HTML); load();
      await waitFor(() => expect(document.querySelectorAll("script[data-rv-hm-bootstrap]")).toHaveLength(1));
      const tag = document.querySelector<HTMLScriptElement>("script[data-rv-hm-bootstrap]")!;
      expect(tag.src).toBe(`${APP}/vendor/bootstrap-5.3.3/bootstrap.bundle.min.js`);
      tag.dispatchEvent(new Event("error"));
      await drawn();
      const m = menus()[0], btn = m.querySelector<HTMLButtonElement>("button.rv-hm-toggle")!, list = m.querySelector(".rv-hm-menu")!;
      btn.click();
      expect(list.classList.contains("show")).toBe(true);
      expect(btn.getAttribute("aria-expanded")).toBe("true");
      btn.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      expect(document.activeElement).toBe(items(m)[0]);
      items(m)[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
      expect(document.activeElement?.textContent).toBe("Sign Out");
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(list.classList.contains("show")).toBe(false);
      expect(document.activeElement).toBe(btn);
    } finally {
      (window as unknown as { bootstrap?: unknown }).bootstrap = saved;
    }
  });

  it("Sign Out asks the app to end the session (POST, with the cookie); if the app refuses, the button says so and can be pressed again", async () => {
    page(SITE_HTML); load(); await drawn();
    fetchMock.mockImplementationOnce(async () => new Response("{}", { status: 403 }));
    const out = menus()[0].querySelector<HTMLButtonElement>(".rv-hm-signout")!;
    out.click();
    expect(fetchMock).toHaveBeenLastCalledWith(`${APP}/api/auth/logout`, expect.objectContaining({ method: "POST", credentials: "include" }));
    await waitFor(() => expect(out.textContent).toBe("Sign out failed – try again"));
    expect(out.disabled).toBe(false);
  });

  it("a header that has a 'Sign In' link (robovalley-landing turns it into its own menu) instead of the corner: one menu after it, the old one hidden", async () => {
    page(`<header id="masthead" class="site-header"><div class="site-header-section">
      <div class="site-header-focus-item ast-header-html-1"><div class="ast-builder-html-element"><p><a class="rv-signin" href="${APP}/login">Sign In / Login</a></p></div></div>
    </div></header>`);
    load(); await drawn();
    expect(menus()).toHaveLength(1);
    expect(document.querySelector(".ast-header-html-1")?.nextElementSibling?.classList.contains("rv-header-menu--site")).toBe(true);
    expect(document.getElementById("rv-header-menu-hide")?.textContent).toContain(".site-header .rv-acct,");
  });

  it("the tag added twice does the work once", async () => {
    page(SITE_HTML); load(); load(); await drawn();
    expect(menus()).toHaveLength(2); // one in the desktop header, one in the phone header
  });

  it("every rule in rv-header-menu.css is scoped under .rv-header-menu (it cannot restyle the theme or the app)", () => {
    const css = readFileSync("public/rv-header-menu.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((m) => m[1].split(",")).map((s) => s.replace(/@media[^{]*$/, "").trim()).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(30);
    expect(selectors.filter((s) => !s.replace(/^@media[^)]*\)\s*/, "").startsWith(".rv-header-menu"))).toEqual([]);
  });

  it("every item comes from one list; 'Moderator dashboard' is there but switched off", () => {
    page(SITE_HTML); load();
    const list = (window as unknown as { RVHeaderMenu: { menu: { label: string; role: string; path: string; enabled: boolean }[] } }).RVHeaderMenu.menu;
    expect(list.find((i) => i.label === "Moderator dashboard")).toMatchObject({ role: "moderator", enabled: false });
    expect(list.every((i) => typeof i.label === "string" && typeof i.path === "string" && typeof i.enabled === "boolean" && ["member", "moderator", "admin"].includes(i.role))).toBe(true);
  });
});

describe("on the app's own pages", () => {
  beforeEach(() => { goTo(`${APP}/admin/dashboard`); });

  it("fills the data-rv-header-menu slot, uses the slot's site address for site links, and hides nothing", async () => {
    page(`<header class="adm-top"><div data-rv-header-menu data-site="https://techytree.in/"></div></header><div class="rv-account-corner">x</div>`);
    load(); await drawn();
    expect(menus()).toHaveLength(1);
    expect(menus()[0].parentElement?.hasAttribute("data-rv-header-menu")).toBe(true);
    expect(document.getElementById("rv-header-menu-hide")).toBeNull();
    expect(items(menus()[0])[1].getAttribute("href")).toBe("https://techytree.in/contribute-now/#history-title");
    expect(fetchMock).toHaveBeenCalledWith(`${APP}/api/auth/menu`, expect.anything());
  });

  it("a slot that appears later (the app swaps layouts without reloading) is filled too", async () => {
    page(`<div id="a"><div data-rv-header-menu></div></div>`);
    load(); await drawn();
    const later = document.createElement("div");
    later.setAttribute("data-rv-header-menu", "");
    document.body.appendChild(later);
    await waitFor(() => expect(later.querySelector(".rv-header-menu button.rv-hm-toggle")).not.toBeNull());
  });

  it("the admin top bar has the slot as its only account control (the old green Admin button is gone); the member dashboard keeps its own Sign out", () => {
    page("");
    const admin = render(<AdminShell landingUrl="https://techytree.in/" locked={false}><p>x</p></AdminShell>);
    expect(admin.container.querySelector("header [data-rv-header-menu]")?.getAttribute("data-site")).toBe("https://techytree.in/");
    expect(admin.queryByRole("button", { name: "Admin" })).toBeNull();
    expect(admin.queryByText(/sign out/i)).toBeNull(); // Sign Out comes from the avatar menu once it is drawn
    admin.unmount();
    const dash = render(<DashboardShell userName="Asha Rao" roleLabel="Student" items={[{ href: "/dashboard", label: "Home" }]} site="https://techytree.in/"><p>x</p></DashboardShell>);
    expect(dash.container.querySelector("header [data-rv-header-menu]")?.getAttribute("data-site")).toBe("https://techytree.in/");
    expect(dash.getByRole("button", { name: "Sign out" })).toBeTruthy(); // the existing sidebar Sign out
    expect(dash.container.querySelector("header [data-rv-header-menu]")?.hasAttribute("data-tone")).toBe(false); // light bars: no dark mode
  });

  it("admin top bar: Landing page opens https://techytree.in/ and My profile opens Settings' My profile section, both right above Sign Out", async () => {
    goTo(`${APP}/admin/dashboard`);
    answerWith(ANSWERS.admin);
    page("");
    const shell = render(<AdminShell landingUrl="https://techytree.in/" locked={false}><p>x</p></AdminShell>);
    load(); await drawn();
    const m = menus()[0];
    expect(m.closest("header.adm-top")).not.toBeNull();
    const all = items(m);
    const landing = all.find((i) => i.textContent === "Landing page")!;
    const profile = all.find((i) => i.textContent === "My profile")!;
    expect(landing.getAttribute("href")).toBe("https://techytree.in/"); // the slot's data-site (the app's SITE_URL), not the app
    expect(profile.getAttribute("href")).toBe(`${APP}/admin/settings#profile`);
    expect(all.slice(-3)).toEqual([landing, profile, m.querySelector(".rv-hm-signout")]); // the last two links, then Sign Out
    expect(landing.getAttribute("target")).toBeNull(); // same tab, like every other item in the menu
    expect(readFileSync("src/app/admin/settings/page.tsx", "utf8")).toMatch(/<section id="profile"[^>]*>\s*<h2[^>]*>My profile<\/h2>/); // the section the link opens
    shell.unmount();
  });

  it("forced password change: the locked admin top bar draws the avatar menu, and its Sign Out ends the session (the real logout route) and leaves for /login", async () => {
    vi.stubEnv("SESSION_SECRET", "unit-test-secret-unit-test-secret-1234");
    try {
      answerWith(ANSWERS.admin); // /api/auth/menu answers for an administrator who still has to change the password (see admin-ui.test.tsx)
      const real = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>;
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
        String(url).endsWith("/api/auth/logout") ? logoutRoute(new Request(String(url), { ...init, headers: { host: "app.techytree.in" } })) : real(url, init));
      page("");
      const shell = render(<AdminShell landingUrl="https://techytree.in/" locked><p>Choose a new password</p></AdminShell>);
      expect(shell.queryByRole("navigation")).toBeNull(); // locked: no sidebar, no Menu button
      load(); await drawn();
      expect(menus()).toHaveLength(1);
      expect(menus()[0].closest("header.adm-top")).not.toBeNull();
      expect(labels(menus()[0])).toEqual(["Admin portal", "Contributions by sector", "Sector forms", "Review queue", "Users & moderators", "Site settings", "Landing page", "My profile", "Sign Out"]);
      expect(document.querySelectorAll(".adm-profile-btn, .adm-menu")).toHaveLength(0); // the old green button is not there to fall back on
      const toggle = menus()[0].querySelector<HTMLButtonElement>("button.rv-hm-toggle")!;
      toggle.click();
      await waitFor(() => expect(toggle.getAttribute("aria-expanded")).toBe("true"));
      const out = menus()[0].querySelector<HTMLButtonElement>(".rv-hm-signout")!;
      out.click();
      expect(fetchMock).toHaveBeenLastCalledWith(`${APP}/api/auth/logout`, expect.objectContaining({ method: "POST", credentials: "include" }));
      const res = (await fetchMock.mock.results[fetchMock.mock.results.length - 1]!.value) as Response;
      expect(res.status).toBe(200);
      expect(res.headers.get("set-cookie")).toMatch(/rv_session=;/); // the session cookie is cleared on the server
      await waitFor(() => expect(out.textContent).toBe("Signing out…")); // success path: it goes to /login (jsdom cannot navigate)
      expect(out.textContent).not.toMatch(/failed/);
      shell.unmount();
    } finally { vi.unstubAllEnvs(); }
  });

  it("on a dark green bar (the old moderation bar) the icon gets a white edge, hover ring and focus outline (at least 3:1 against the bar)", async () => {
    goTo(`${APP}/moderation`);
    answerWith(ANSWERS.moderator);
    page(`<header class="mod-bar"><nav><div data-rv-header-menu data-tone="dark"></div></nav></header><header class="adm-top"><div data-rv-header-menu></div></header>`);
    load(); await drawn();
    const [dark, light] = menus();
    expect(dark.classList.contains("rv-header-menu--on-dark")).toBe(true);
    expect(light.classList.contains("rv-header-menu--on-dark")).toBe(false);
    expect(dark.querySelector(".rv-hm-toggle .rv-hm-disc")).not.toBeNull();
    // the old moderation bar's colour against the edge rv-header-menu.css gives the icon there (the tone stays supported)
    const bar = "#123f37";
    const css = readFileSync("public/rv-header-menu.css", "utf8");
    const edge = /\.rv-header-menu--on-dark \.rv-hm-toggle \.rv-hm-disc\s*\{\s*stroke:\s*(#[0-9a-f]{3,6})/i.exec(css)![1];
    expect(contrast("#1f4d3f", bar)).toBeLessThan(3); // the reason: the moderator's dark green alone melts into the bar
    expect(contrast(edge, bar)).toBeGreaterThanOrEqual(3);
    expect(css).toMatch(/--on-dark \.rv-hm-toggle:focus-visible\s*\{\s*outline-color:\s*#fff;/);
  });

  it("a slot can be marked dark; Moderation now uses the admin shell, whose top bar is light", () => {
    page("");
    const slot = render(<HeaderMenuSlot site="https://techytree.in/" tone="dark" />);
    expect(slot.container.querySelector("[data-rv-header-menu]")?.getAttribute("data-tone")).toBe("dark");
    const layout = readFileSync("src/app/(reviewer)/admin/moderation/layout.tsx", "utf8");
    expect(layout).toContain("<AdminShell landingUrl={siteUrl()}"); expect(layout).not.toContain("HeaderMenuSlot");
  });
});
