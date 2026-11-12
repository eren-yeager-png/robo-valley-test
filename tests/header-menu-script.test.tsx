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

const MENU_JS = readFileSync("public/rv-header-menu.js", "utf8");
const BOOTSTRAP_JS = readFileSync("public/vendor/bootstrap-5.3.3/bootstrap.bundle.min.js", "utf8");
const APP = "https://app.techytree.in";
const SITE_PAGE = "https://techytree.in/robots-by-sector/";

// The live techytree.in header (Astra), trimmed: the old account corner in "HTML 1", the phone header's menu button, the Contribute banner.
const SITE_HTML = `
  <header id="masthead" class="site-header">
    <div id="ast-desktop-header"><div class="ast-builder-layout-element ast-header-html-1"><div class="ast-builder-html-element">
      <div class="rv-account-corner"><a href="${APP}/login" class="rv-account-link rv-login">Sign In</a></div>
    </div></div></div>
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
    expect(document.getElementById("rv-header-menu-hide")?.textContent).toBe(".rv-account-corner{display:none!important}#rv-c2 #sign-out{display:none!important}");
    expect(document.querySelector("#rv-c2 .notice")?.textContent).toContain("Asha · Registered member"); // the text stays
  });

  it("puts the menu where the old corner was and in the phone header, just before its menu button", async () => {
    page(SITE_HTML); load(); await drawn();
    expect(menus()).toHaveLength(2);
    expect(document.querySelector(".rv-account-corner")?.previousElementSibling?.classList.contains("rv-header-menu")).toBe(true);
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
    expect(m.textContent).not.toMatch(/Moderator dashboard|Admin portal|Users|settings/);
  });

  it("admin: navy avatar with the orange star; Admin portal / Contributions by sector / Review queue (12) / Users & moderators / Site settings / Sign Out", async () => {
    answerWith(ANSWERS.admin);
    page(SITE_HTML); load(); await drawn();
    const m = menus()[0];
    expect(m.querySelector("button circle")?.getAttribute("fill")).toBe("#1e3a5f");
    expect(m.querySelector("button circle[fill='#e8590c']")).not.toBeNull();
    expect(m.querySelector(".rv-hm-sub")?.textContent).toBe("Administrator · full access");
    expect(labels(m)).toEqual(["Admin portal", "Contributions by sector", "Review queue", "Users & moderators", "Site settings", "Sign Out"]);
    expect(items(m).slice(0, 5).map((i) => i.getAttribute("href"))).toEqual(["/admin/dashboard", "/admin/sectors", "/moderation", "/admin/users", "/admin/settings"].map((p) => APP + p));
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

  it("the tag added twice does the work once", async () => {
    page(SITE_HTML); load(); load(); await drawn();
    expect(menus()).toHaveLength(2); // one in the desktop header, one in the phone header
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

  it("the admin top bar and the member dashboard top bar have the slot, and keep their own Sign Out", () => {
    page("");
    const admin = render(<AdminShell email="boss@robovalley.com" landingUrl="https://techytree.in/" locked={false}><p>x</p></AdminShell>);
    expect(admin.container.querySelector("header [data-rv-header-menu]")?.getAttribute("data-site")).toBe("https://techytree.in/");
    expect(admin.getByRole("button", { name: "Admin" })).toBeTruthy(); // the existing profile menu (Landing Page / My Profile / Sign Out)
    admin.unmount();
    const dash = render(<DashboardShell userName="Asha Rao" roleLabel="Student" items={[{ href: "/dashboard", label: "Home" }]} site="https://techytree.in/"><p>x</p></DashboardShell>);
    expect(dash.container.querySelector("header [data-rv-header-menu]")?.getAttribute("data-site")).toBe("https://techytree.in/");
    expect(dash.getByRole("button", { name: "Sign out" })).toBeTruthy(); // the existing sidebar Sign out
  });
});
