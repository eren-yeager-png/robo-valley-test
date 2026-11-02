// @vitest-environment jsdom
// WordPress header (plugin asset robovalley-account.js): "Sign In / Login" when signed out, plain "Admin" for the
// administrator, and the first name as a dropdown button for every other signed-in user.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SRC = readFileSync(join(__dirname, "../frontend/wordpress/plugins/robovalley-landing/assets/robovalley-account.js"), "utf8");
const ORIGINAL = "Sign In / Login";
const HOME = "https://techytree.in/";

const settle = () => new Promise((r) => setTimeout(r, 0));
const flush = async () => { await settle(); await settle(); };

/** Run the script on a page whose /api/auth/me answers with `me` (null = network failure). */
async function run(me: unknown, opts: { status?: number; cfg?: object } = {}) {
  document.head.querySelectorAll("style").forEach((s) => s.remove());
  document.body.innerHTML = `<header><a class="rv-signin" href="https://app.techytree.in/login">${ORIGINAL}</a></header>`;
  (window as any).RoboValleyApi = { base: "https://app.techytree.in", home: HOME, ...(opts.cfg ?? {}) };
  const fetchMock = vi.fn(async () => {
    if (me === null) throw new Error("offline");
    return { ok: (opts.status ?? 200) < 400, json: async () => me } as Response;
  });
  (window as any).fetch = fetchMock;
  (0, eval)(SRC);
  await flush();
  const link = document.querySelector("a.rv-signin") as HTMLAnchorElement;
  return {
    link, fetchMock,
    btn: document.querySelector(".rv-acct-btn") as HTMLButtonElement | null,
    menu: document.querySelector(".rv-acct-menu") as HTMLUListElement | null,
    adminText: document.querySelector(".rv-acct-admin") as HTMLElement | null,
  };
}
const linkShown = (l: HTMLElement) => !l.hidden && !l.hasAttribute("hidden");

beforeEach(() => { delete (window as any).RoboValleyApi; });
afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("header label", () => {
  it("signed out: keeps the Sign In / Login link, no button, no admin text", async () => {
    const { link, btn, adminText, fetchMock } = await run({ role: null, firstName: null });
    expect(link.textContent).toBe(ORIGINAL);
    expect(linkShown(link)).toBe(true);
    expect(btn).toBeNull();
    expect(adminText).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("https://app.techytree.in/api/auth/me", { credentials: "include", cache: "no-store" });
  });

  it("admin: plain text \"Admin\" (not a link, not a button), the Sign In link is hidden", async () => {
    const { link, adminText, btn } = await run({ role: "admin", firstName: "Ravi" });
    expect(adminText?.textContent).toBe("Admin");
    expect(adminText?.tagName).toBe("SPAN");
    expect(adminText?.closest("a")).toBeNull();
    expect(btn).toBeNull();
    expect(linkShown(link)).toBe(false);
    expect(document.body.textContent).not.toContain("Ravi");
  });

  it("signed-in user: a button with the first name, collapsed dropdown, Sign In link hidden", async () => {
    const { link, btn, menu } = await run({ role: "user", firstName: "Asha" });
    expect(btn?.textContent).toBe("Asha");
    expect(btn?.getAttribute("aria-expanded")).toBe("false");
    expect(btn?.getAttribute("aria-haspopup")).toBe("true");
    expect(menu?.hidden).toBe(true);
    expect(linkShown(link)).toBe(false);
  });

  it("dropdown: first item is Homepage -> the landing page URL from the site config; items are label + URL links", async () => {
    const { btn, menu } = await run({ role: "user", firstName: "Asha" });
    btn!.click();
    expect(menu!.hidden).toBe(false);
    expect(btn!.getAttribute("aria-expanded")).toBe("true");
    const items = [...menu!.querySelectorAll("a")];
    expect(items[0].textContent).toBe("Homepage");
    expect(items[0].getAttribute("href")).toBe(HOME);
    expect(items[1].textContent).toBe("My account");
    expect(items[1].getAttribute("href")).toBe("https://app.techytree.in/dashboard");
  });

  it("dropdown: Homepage falls back to the site root when the config URL is missing or unsafe", async () => {
    for (const home of [undefined, "javascript:alert(1)"]) {
      const { menu } = await run({ role: "user", firstName: "Asha" }, { cfg: { home } });
      expect(menu!.querySelector("a")!.getAttribute("href")).toBe(window.location.origin + "/");
    }
  });

  it("dropdown closes on Escape (focus back on the button), on an outside click, and toggles on a second click", async () => {
    const { btn, menu } = await run({ role: "user", firstName: "Asha" });
    btn!.click(); expect(menu!.hidden).toBe(false);
    btn!.click(); expect(menu!.hidden).toBe(true);
    btn!.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(menu!.hidden).toBe(true);
    expect(document.activeElement).toBe(btn);
    btn!.click();
    document.body.click();
    expect(menu!.hidden).toBe(true);
    expect(btn!.getAttribute("aria-expanded")).toBe("false");
  });

  it("signed in but firstName null, empty or blank: keeps Sign In / Login (no button)", async () => {
    for (const firstName of [null, "", "   "]) {
      const { link, btn, adminText } = await run({ role: "user", firstName });
      expect(linkShown(link)).toBe(true);
      expect(link.textContent).toBe(ORIGINAL);
      expect(btn).toBeNull();
      expect(adminText).toBeNull();
    }
  });

  it("a name is text, never HTML", async () => {
    const { btn } = await run({ role: "user", firstName: "<img src=x onerror=alert(1)>" });
    expect(document.querySelector("img")).toBeNull();
    expect(btn!.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("API error or unreachable: the Sign In link is unchanged", async () => {
    for (const r of [await run({}, { status: 500 }), await run(null)]) {
      expect(linkShown(r.link)).toBe(true);
      expect(r.link.textContent).toBe(ORIGINAL);
      expect(r.btn).toBeNull();
    }
  });

  it("after logout (cached page shown again, API now says signed out): Sign In / Login returns, the user button is gone", async () => {
    const { link } = await run({ role: "user", firstName: "Asha" });
    expect(document.querySelector(".rv-acct-btn")).not.toBeNull();
    (window as any).fetch = vi.fn(async () => ({ ok: true, json: async () => ({ role: null, firstName: null }) }) as Response);
    window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    await flush();
    expect(document.querySelector(".rv-acct-btn")).toBeNull();
    expect(document.querySelector("[data-rv-acct]")).toBeNull();
    expect(linkShown(link)).toBe(true);
    expect(link.textContent).toBe(ORIGINAL);
  });

  it("switching user -> admin on refresh replaces the dropdown with the plain Admin text (no duplicates)", async () => {
    const { link } = await run({ role: "user", firstName: "Asha" });
    (window as any).fetch = vi.fn(async () => ({ ok: true, json: async () => ({ role: "admin", firstName: "Ravi" }) }) as Response);
    window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    await flush();
    expect(document.querySelectorAll("[data-rv-acct]").length).toBe(1);
    expect(document.querySelector(".rv-acct-admin")?.textContent).toBe("Admin");
    expect(document.querySelector(".rv-acct-btn")).toBeNull();
    expect(linkShown(link)).toBe(false);
  });

  it("does nothing without the API base or without a sign-in link", async () => {
    document.body.innerHTML = `<a class="rv-signin" href="#">${ORIGINAL}</a>`;
    const f = vi.fn(); (window as any).fetch = f;
    (0, eval)(SRC);
    expect(f).not.toHaveBeenCalled();
  });
});
