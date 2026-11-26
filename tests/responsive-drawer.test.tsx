// @vitest-environment jsdom
// The off-canvas navigation drawer of both shells (admin and member) below 1024px: keyboard and screen-reader behaviour.
// Open: the focus moves to its Close button, Tab and Shift+Tab stay inside, the rest of the page is inert, the page does not scroll.
// Closed by Escape (focus back on Menu), the Close button, the backdrop, choosing a link, or the window growing to the fixed sidebar.
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ path: "/admin/dashboard" }));
vi.mock("next/navigation", () => ({ usePathname: () => h.path, useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));
vi.mock("../src/app/dashboard/LogoutButton", () => ({ default: () => <button type="button">Sign out</button> }));
import AdminShell from "../src/app/admin/_components/AdminShell";
import DashboardShell from "../src/app/dashboard/DashboardShell";

// jsdom has no matchMedia: a controllable one (narrow by default, as on a phone)
let wide = false; const listeners = new Set<() => void>();
beforeEach(() => {
  wide = false; listeners.clear(); h.path = "/admin/dashboard"; document.documentElement.style.overflow = "";
  (window as any).matchMedia = (q: string) => ({ media: q, get matches() { return wide && q === "(min-width: 1024px)"; }, addEventListener: (_: string, f: () => void) => listeners.add(f), removeEventListener: (_: string, f: () => void) => listeners.delete(f) });
});
afterEach(() => { cleanup(); delete (window as any).matchMedia; });
const growToDesktop = () => act(() => { wide = true; listeners.forEach((f) => f()); });

const shells = [
  { name: "admin", menu: () => screen.getByRole("button", { name: "Menu" }), mount: () => render(<AdminShell landingUrl="https://techytree.in/" locked={false}><p>page</p></AdminShell>),
    isOpen: (c: HTMLElement) => !!c.querySelector(".adm.open"), rest: (c: HTMLElement) => c.querySelector(".adm-body")!, panel: (c: HTMLElement) => c.querySelector(".adm-side")!, link: "Upload Files" },
  { name: "member", menu: () => screen.getByRole("button", { name: /Menu/ }), mount: () => render(<DashboardShell userName="Asha Rao" roleLabel="Teacher" items={[{ href: "/dashboard", label: "Home" }, { href: "/dashboard/notifications", label: "Notifications" }]}><p>page</p></DashboardShell>),
    isOpen: (c: HTMLElement) => !!c.querySelector(".dside.open"), rest: (c: HTMLElement) => c.querySelector("main")!, panel: (c: HTMLElement) => c.querySelector(".dside")!, link: "Notifications" },
] as const;

describe.each(shells)("$name shell drawer", (s) => {
  it("opening moves the focus to the drawer's Close button, makes the rest of the page inert and stops it scrolling", async () => {
    const user = userEvent.setup(); const { container } = s.mount();
    await user.click(s.menu());
    expect(s.isOpen(container)).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close menu" }));
    expect(s.rest(container).hasAttribute("inert")).toBe(true);
    expect(document.documentElement.style.overflow).toBe("hidden");
  });
  it("Tab and Shift+Tab stay inside the drawer while it is open (focus trap)", async () => {
    const user = userEvent.setup(); const { container } = s.mount();
    await user.click(s.menu());
    const inside = Array.from(s.panel(container).querySelectorAll<HTMLElement>("a[href],button"));
    for (let i = 0; i < inside.length + 2; i++) { await user.tab(); expect(s.panel(container).contains(document.activeElement), `tab ${i}`).toBe(true); }
    for (let i = 0; i < inside.length + 2; i++) { await user.tab({ shift: true }); expect(s.panel(container).contains(document.activeElement), `shift+tab ${i}`).toBe(true); }
  });
  it("Escape closes it and puts the focus back on Menu; everything is normal again", async () => {
    const user = userEvent.setup(); const { container } = s.mount();
    await user.click(s.menu());
    // jsdom does not implement inert, so it would focus an inert Menu button where a browser refuses: refuse here too, as a browser does
    const realFocus = HTMLElement.prototype.focus;
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, ...a) { if (!this.closest("[inert]")) realFocus.apply(this, a); });
    await user.keyboard("{Escape}");
    focusSpy.mockRestore();
    expect(s.isOpen(container)).toBe(false);
    expect(document.activeElement).toBe(s.menu());
    expect(s.rest(container).hasAttribute("inert")).toBe(false);
    expect(document.documentElement.style.overflow).toBe("");
  });
  it("the Close button, the backdrop and choosing a link close it", async () => {
    const user = userEvent.setup(); const { container } = s.mount();
    await user.click(s.menu()); await user.click(screen.getByRole("button", { name: "Close menu" }));
    expect(s.isOpen(container)).toBe(false);
    await user.click(s.menu()); await user.click(container.querySelector(".adm-scrim, .dscrim") as HTMLElement);
    expect(s.isOpen(container)).toBe(false);
    await user.click(s.menu()); await user.click(screen.getByRole("link", { name: new RegExp(s.link) }));
    expect(s.isOpen(container)).toBe(false);
  });
  it("closes by itself when the window grows to the fixed sidebar (a tablet turned to landscape)", async () => {
    const user = userEvent.setup(); const { container } = s.mount();
    await user.click(s.menu());
    growToDesktop();
    expect(s.isOpen(container)).toBe(false);
  });
  it("the backdrop is not announced and not in the Tab order (the Close button is the control)", async () => {
    const user = userEvent.setup(); const { container } = s.mount();
    await user.click(s.menu());
    const scrim = container.querySelector(".adm-scrim, .dscrim")!;
    expect(scrim.getAttribute("aria-hidden")).toBe("true");
    expect(scrim.getAttribute("tabindex")).toBe("-1");
    expect(screen.getAllByRole("button", { name: "Close menu" })).toHaveLength(1);
  });
  it("the active page keeps aria-current in the drawer", () => {
    h.path = s.name === "admin" ? "/admin/upload" : "/dashboard/notifications";
    s.mount();
    const current = document.querySelector('[aria-current="page"]')!;
    expect(current.textContent).toContain(s.name === "admin" ? "Upload Files" : "Notifications");
  });
});
