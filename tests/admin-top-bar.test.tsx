// @vitest-environment jsdom
// The admin top bar: the shared header account menu (the avatar, public/rv-header-menu.js) is the only account control. The old green
// "Admin" profile button (Landing Page / My Profile / Sign Out) is gone, also while a password change is forced. And the drawer.
// The avatar menu's own behaviour, its Sign Out on the forced password change screen included, is in header-menu-script.test.tsx.
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ path: "/admin/dashboard" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }), usePathname: () => h.path }));

import AdminShell from "../src/app/admin/_components/AdminShell";

const LANDING = "https://techytree.in/";
const OLD_BUTTON = /adm-(profile|avatar|caret|menu)|ProfileMenu/;

beforeEach(() => { h.path = "/admin/dashboard"; });
afterEach(() => { cleanup(); });

const topBar = (c: HTMLElement) => c.querySelector("header.adm-top") as HTMLElement;

describe("admin top bar: one account control", () => {
  for (const locked of [false, true]) {
    it(`${locked ? "while a password change is forced" : "on every admin page"}: the header account menu slot is the only account control; no green Admin button, no email, no other Sign Out`, () => {
      const { container } = render(<AdminShell landingUrl={LANDING} locked={locked}><p>body</p></AdminShell>);
      const bar = topBar(container);
      const slots = bar.querySelectorAll("[data-rv-header-menu]");
      expect(slots).toHaveLength(1);
      expect(slots[0].getAttribute("data-site")).toBe(LANDING);
      expect(container.querySelectorAll("[data-rv-header-menu]")).toHaveLength(1); // nowhere else on the page either
      expect(screen.queryByRole("button", { name: "Admin" })).toBeNull();
      expect(container.querySelector(".adm-profile, .adm-profile-btn, .adm-profile-label, .adm-avatar, .adm-caret, .adm-menu, #adm-profile-menu")).toBeNull();
      expect(screen.queryByText(/@/)).toBeNull(); // the old menu showed the email address
      expect(screen.queryByText(/sign out/i)).toBeNull(); // Sign Out is drawn by the avatar menu, at the end of its list
      // the only button left in the top bar is the drawer's Menu button (and not even that while the password change is forced)
      expect(within(bar).queryAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(locked ? [] : ["Menu"]);
    });
  }

  it("while a password change is forced there is no navigation and no Menu button, the title says so, and the avatar slot stays (its Sign Out is the way out)", () => {
    const { container } = render(<AdminShell landingUrl={LANDING} locked><p>form</p></AdminShell>);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("button", { name: "Menu" })).toBeNull();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Change your password");
    expect(topBar(container).querySelector("[data-rv-header-menu]")).not.toBeNull();
    expect(screen.getByText("form")).toBeTruthy();
  });

  it("the old profile button is gone from the code: no component, and nothing in src/ uses its name or classes", () => {
    expect(existsSync("src/app/admin/_components/ProfileMenu.tsx")).toBe(false);
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|css|js)$/.test(f)) files.push(p); } };
    walk("src");
    expect(files.filter((f) => OLD_BUTTON.test(readFileSync(f, "utf8")))).toEqual([]);
  });
});

describe("admin shell", () => {
  it("shows the fourteen sections with the current page highlighted, and no standalone email or Sign out button", () => {
    h.path = "/admin/users";
    render(<AdminShell landingUrl={LANDING} locked={false}><p>body</p></AdminShell>);
    const nav = screen.getByRole("navigation");
    expect(within(nav).getAllByRole("link")).toHaveLength(14); // Sector Counts, then Sector Forms (P2), then the Moderator Workspace and the Admin Approval Dashboard (contribution workflow) were added
    expect(within(nav).getByRole("link", { name: /User Management/ }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: /Overview/ }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("User Management");
    expect(screen.queryByText("boss@robovalley.com")).toBeNull();
    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Admin" })).toBeNull();
  });

  it("the menu button opens and closes the drawer (Escape, the backdrop and choosing a page close it)", async () => {
    const user = userEvent.setup();
    const { container } = render(<AdminShell landingUrl={LANDING} locked={false}><p>body</p></AdminShell>);
    const burger = screen.getByRole("button", { name: "Menu" });
    expect(burger.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".adm.open")).toBeNull();
    await user.click(burger);
    expect(burger.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".adm.open")).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(container.querySelector(".adm.open")).toBeNull();
    await user.click(burger);
    await user.click(screen.getByRole("button", { name: "Close menu" }));
    expect(container.querySelector(".adm.open")).toBeNull();
  });
});

describe("responsive stylesheet", () => {
  const css = readFileSync("src/app/admin/admin.css", "utf8");
  it("turns the sidebar into a drawer on tablets and phones and keeps it on desktop", () => {
    // below 1024px (the shared lg breakpoint) the sidebar is a drawer; from 1024px it stays (responsive PR 1)
    expect(css).toMatch(/@media \(max-width:1023\.98px\)\{[^@]*\.adm-side\{position:fixed;[^}]*translateX\(-100%\)/);
    expect(css).toMatch(/\.rv \.adm-side\{position:sticky/);
    expect(css).toMatch(/@media \(max-width:767\.98px\)/);
  });
  it("has no rules left for the old profile button and its menu (the avatar menu brings its own stylesheet)", () => {
    expect(css).not.toMatch(OLD_BUTTON);
    expect(css).toMatch(/@media \(prefers-reduced-motion:reduce\)\{[^\n]*\.adm-side\{transition:none\}\}/);
    expect(css).toMatch(/\.rv \.adm-title\{[^}]*flex:1/); // the title still pushes the avatar to the right end of the bar
  });
  it("uses the landing page's design tokens and fonts", () => {
    for (const token of ["#17694f", "#123f33", "#f5f4ef", "#e3ede7", "#15302a", "#d6dfd9", "--rv-display", "--rv-body"]) expect(css, token).toContain(token);
    const landing = readFileSync("frontend/wordpress/plugins/robovalley-landing/assets/robovalley-home.css", "utf8");
    for (const token of ["--rh-brand: #17694f", "--rh-hero: #123f33", "--rh-bg: #f5f4ef", "--rh-tint: #e3ede7", "--rh-fg: #15302a", "--rh-line: #d6dfd9"]) expect(landing, token).toContain(token);
  });
});

describe("the responsive drawer", () => {
  const shell = () => <AdminShell landingUrl={LANDING} locked={false}>x</AdminShell>;
  it("opens from the Menu button, closes on Escape, and closes by itself when the page changes", async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(shell());
    const adm = () => container.querySelector(".adm") as HTMLElement;
    expect(adm().className).toBe("adm");
    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(adm().className).toBe("adm open");
    await user.keyboard("{Escape}");
    expect(adm().className).toBe("adm");
    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(adm().className).toBe("adm open");
    h.path = "/admin/users"; // the visitor followed a link in the drawer
    rerender(shell());
    expect(adm().className).toBe("adm");
    await user.click(screen.getByRole("button", { name: "Menu" })); // and it can be opened again on the new page
    expect(adm().className).toBe("adm open");
  });
});
