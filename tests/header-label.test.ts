// @vitest-environment jsdom
// WordPress header label (plugin asset robovalley-account.js): first name when signed in, "Sign In / Login" otherwise.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SRC = readFileSync(join(__dirname, "../frontend/wordpress/plugins/robovalley-landing/assets/robovalley-account.js"), "utf8");
const ORIGINAL = "Sign In / Login";

/** Run the script on a page whose /api/auth/me answers with `me` (null = network failure). Resolves after the label settled. */
async function run(me: unknown, opts: { status?: number } = {}) {
  document.body.innerHTML = `<a class="rv-signin" href="https://app.techytree.in/login">${ORIGINAL}</a>`;
  (window as any).RoboValleyApi = { base: "https://app.techytree.in" };
  const fetchMock = vi.fn(async () => {
    if (me === null) throw new Error("offline");
    return { ok: (opts.status ?? 200) < 400, json: async () => me } as Response;
  });
  (window as any).fetch = fetchMock;
  (0, eval)(SRC);
  await new Promise((r) => setTimeout(r, 0));
  return { link: document.querySelector("a.rv-signin") as HTMLAnchorElement, fetchMock };
}

beforeEach(() => { delete (window as any).RoboValleyApi; });
afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("header label", () => {
  it("signed out: keeps Sign In / Login", async () => {
    const { link, fetchMock } = await run({ role: null, firstName: null });
    expect(link.textContent).toBe(ORIGINAL);
    expect(link.hasAttribute("aria-label")).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith("https://app.techytree.in/api/auth/me", { credentials: "include", cache: "no-store" });
  });

  it("signed-in user: shows the first name", async () => {
    const { link } = await run({ role: "user", firstName: "Asha" });
    expect(link.textContent).toBe("Asha");
    expect(link.getAttribute("href")).toBe("https://app.techytree.in/login");
  });

  it("signed-in admin: shows the first name too (not \"Admin\")", async () => {
    const { link } = await run({ role: "admin", firstName: "Ravi" });
    expect(link.textContent).toBe("Ravi");
  });

  it("signed in but firstName null or empty: keeps Sign In / Login", async () => {
    expect((await run({ role: "user", firstName: null })).link.textContent).toBe(ORIGINAL);
    expect((await run({ role: "user", firstName: "   " })).link.textContent).toBe(ORIGINAL);
  });

  it("a name is text, never HTML", async () => {
    const { link } = await run({ role: "user", firstName: "<img src=x onerror=alert(1)>" });
    expect(link.querySelector("img")).toBeNull();
    expect(link.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("API error or unreachable: button unchanged", async () => {
    expect((await run({}, { status: 500 })).link.textContent).toBe(ORIGINAL);
    expect((await run(null)).link.textContent).toBe(ORIGINAL);
  });

  it("after logout (page restored from cache, then asked again): the original text returns", async () => {
    const { link } = await run({ role: "user", firstName: "Asha" });
    expect(link.textContent).toBe("Asha");
    (window as any).fetch = vi.fn(async () => ({ ok: true, json: async () => ({ role: null, firstName: null }) }) as Response);
    window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(link.textContent).toBe(ORIGINAL);
    expect(link.hasAttribute("aria-label")).toBe(false);
  });

  it("does nothing without the API base or without a sign-in link", async () => {
    document.body.innerHTML = `<a class="rv-signin" href="#">${ORIGINAL}</a>`;
    const f = vi.fn(); (window as any).fetch = f;
    (0, eval)(SRC);
    expect(f).not.toHaveBeenCalled();
  });
});
