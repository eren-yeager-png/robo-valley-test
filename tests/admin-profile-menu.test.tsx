// @vitest-environment jsdom
// The admin top bar: one profile button with Landing Page / My Profile / Sign Out, and the responsive drawer.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), path: "/admin/dashboard" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: h.replace, refresh: h.refresh, push: vi.fn() }), usePathname: () => h.path }));

import AdminShell from "../src/app/admin/_components/AdminShell";
import ProfileMenu from "../src/app/admin/_components/ProfileMenu";
import { POST as logoutRoute } from "../src/app/api/auth/logout/route";

const LANDING = "https://techytree.in/";
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  h.replace.mockReset(); h.refresh.mockReset(); h.path = "/admin/dashboard";
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const open = async (user = userEvent.setup()) => { await user.click(screen.getByRole("button", { name: "Admin" })); return user; };

describe("profile menu", () => {
  it("shows a single profile button; the menu, the email and Sign Out appear only when it is opened", async () => {
    render(<ProfileMenu email="boss@robovalley.com" landingUrl={LANDING} />);
    const btn = screen.getByRole("button", { name: "Admin" });
    expect(btn.getAttribute("aria-haspopup")).toBe("menu");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByText("boss@robovalley.com")).toBeNull();
    expect(screen.queryByText("Sign Out")).toBeNull();
    await open();
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Landing Page", "My Profile", "Sign Out"]);
    expect(within(menu).getByText("boss@robovalley.com")).toBeTruthy();
    expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: "Landing Page" })); // keyboard users land on the first item
  });

  it("points Landing Page at the public site and My Profile at the profile section of Settings", async () => {
    render(<ProfileMenu email="boss@robovalley.com" landingUrl={LANDING} />);
    await open();
    expect(screen.getByRole("menuitem", { name: "Landing Page" }).getAttribute("href")).toBe(LANDING);
    expect(screen.getByRole("menuitem", { name: "My Profile" }).getAttribute("href")).toBe("/admin/settings#profile");
  });

  it("closes when you click outside, press Escape (focus returns to the button) or Tab away", async () => {
    render(<div><ProfileMenu email="a@b.c" landingUrl={LANDING} /><p>elsewhere</p></div>);
    const user = await open();
    await user.click(screen.getByText("elsewhere"));
    expect(screen.queryByRole("menu")).toBeNull();
    await open(user);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Admin" }));
    await open(user);
    await user.keyboard("{Tab}");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("clicking the button again closes it, and choosing Landing Page or My Profile closes it", async () => {
    render(<ProfileMenu email="a@b.c" landingUrl={LANDING} />);
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Admin" }));
    expect(screen.queryByRole("menu")).toBeNull();
    await open(user);
    fireEvent.click(screen.getByRole("menuitem", { name: "My Profile" }));
    expect(screen.queryByRole("menu")).toBeNull();
    await open(user);
    fireEvent.click(screen.getByRole("menuitem", { name: "Landing Page" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("supports the keyboard: ArrowDown opens, arrows/Home/End move and wrap", async () => {
    render(<ProfileMenu email="a@b.c" landingUrl={LANDING} />);
    const btn = screen.getByRole("button", { name: "Admin" });
    btn.focus();
    const user = userEvent.setup();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menu")).toBeTruthy();
    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);
    await user.keyboard("{ArrowDown}"); expect(document.activeElement).toBe(items[1]);
    await user.keyboard("{ArrowDown}"); expect(document.activeElement).toBe(items[2]);
    await user.keyboard("{ArrowDown}"); expect(document.activeElement).toBe(items[0]); // wraps
    await user.keyboard("{ArrowUp}"); expect(document.activeElement).toBe(items[2]);
    await user.keyboard("{Home}"); expect(document.activeElement).toBe(items[0]);
    await user.keyboard("{End}"); expect(document.activeElement).toBe(items[2]);
  });

  it("Sign Out calls the existing logout route once, then goes to /login", async () => {
    render(<ProfileMenu email="a@b.c" landingUrl={LANDING} />);
    const user = await open();
    const out = screen.getByRole("menuitem", { name: "Sign Out" });
    await user.dblClick(out); // a double click must not sign out twice
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/login"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" });
    expect(h.replace).toHaveBeenCalledTimes(1);
    expect(h.refresh).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Sign Out still leaves the page when the network call fails (the cookie expires anyway)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    render(<ProfileMenu email="a@b.c" landingUrl={LANDING} />);
    const user = await open();
    await user.click(screen.getByRole("menuitem", { name: "Sign Out" }));
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/login"));
  });

  it("Sign Out really clears the session cookie on the server (the real logout route)", async () => {
    vi.stubEnv("SESSION_SECRET", "unit-test-secret-unit-test-secret-1234");
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => logoutRoute(new Request("http://localhost" + url, init)));
    render(<ProfileMenu email="a@b.c" landingUrl={LANDING} />);
    const user = await open();
    await user.click(screen.getByRole("menuitem", { name: "Sign Out" }));
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/login"));
    const res = (await fetchMock.mock.results[0]!.value) as Response;
    expect(res.headers.get("set-cookie")).toMatch(/rv_session=;/);
    vi.unstubAllEnvs();
  });
});

describe("admin shell", () => {
  it("shows the eleven sections with the current page highlighted, and no standalone email or Sign out button", () => {
    h.path = "/admin/users";
    render(<AdminShell email="boss@robovalley.com" landingUrl={LANDING} locked={false}><p>body</p></AdminShell>);
    const nav = screen.getByRole("navigation");
    expect(within(nav).getAllByRole("link")).toHaveLength(11); // Sector Counts was added
    expect(within(nav).getByRole("link", { name: /User Management/ }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: /Overview/ }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("User Management");
    expect(screen.queryByText("boss@robovalley.com")).toBeNull();
    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Admin" })).toHaveLength(1);
  });

  it("the menu button opens and closes the drawer (Escape, the backdrop and choosing a page close it)", async () => {
    const user = userEvent.setup();
    const { container } = render(<AdminShell email="a@b.c" landingUrl={LANDING} locked={false}><p>body</p></AdminShell>);
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

  it("while a password change is forced there is no navigation, but the profile menu (and so Sign Out) is still there", () => {
    render(<AdminShell email="a@b.c" landingUrl={LANDING} locked><p>form</p></AdminShell>);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("button", { name: "Menu" })).toBeNull();
    expect(screen.getByRole("button", { name: "Admin" })).toBeTruthy();
  });
});

describe("responsive stylesheet", () => {
  const css = readFileSync("src/app/admin/admin.css", "utf8");
  it("turns the sidebar into a drawer on tablets and phones and keeps it on desktop", () => {
    expect(css).toMatch(/@media \(max-width:900px\)\{[^@]*\.adm-side\{position:fixed;[^}]*translateX\(-100%\)/);
    expect(css).toMatch(/\.rv \.adm-side\{position:sticky/);
    expect(css).toMatch(/@media \(max-width:600px\)/);
  });
  it("keeps the dropdown inside the screen and the tap targets large", () => {
    expect(css).toMatch(/\.adm-menu\{[^}]*right:0;[^}]*max-width:calc\(100vw - 24px\)/);
    expect(css).toMatch(/\.adm-menu a,\.rv \.adm-menu button\{[^}]*min-height:44px/);
  });
  it("uses the landing page's design tokens and fonts", () => {
    for (const token of ["#17694f", "#123f33", "#f5f4ef", "#e3ede7", "#15302a", "#d6dfd9", "--rv-display", "--rv-body"]) expect(css, token).toContain(token);
    const landing = readFileSync("frontend/wordpress/plugins/robovalley-landing/assets/robovalley-home.css", "utf8");
    for (const token of ["--rh-brand: #17694f", "--rh-hero: #123f33", "--rh-bg: #f5f4ef", "--rh-tint: #e3ede7", "--rh-fg: #15302a", "--rh-line: #d6dfd9"]) expect(landing, token).toContain(token);
  });

describe("the responsive drawer", () => {
  const shell = () => <AdminShell email="boss@robovalley.com" landingUrl={LANDING} locked={false}>x</AdminShell>;
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
});

