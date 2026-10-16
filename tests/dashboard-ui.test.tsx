// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_FIELDS } from "../src/lib/roles";

const h = vi.hoisted(() => ({ pathname: "/dashboard", refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => h.pathname, useRouter: () => ({ refresh: h.refresh, replace: h.replace, push: vi.fn() }) }));

import DashboardShell from "../src/app/dashboard/DashboardShell";
import ProfileForm from "../src/app/dashboard/profile/ProfileForm";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); h.pathname = "/dashboard"; });
beforeEach(() => { h.refresh.mockReset(); h.replace.mockReset(); });

const items = [
  { href: "/dashboard", label: "Home" }, { href: "/dashboard/projects", label: "Projects" },
  { href: "/dashboard/notifications", label: "Notifications" }, { href: "/dashboard/profile", label: "Profile & settings" },
];
const shell = () => render(<DashboardShell userName="Asha Rao" roleLabel="Student" items={items}><p>page body</p></DashboardShell>);

describe("DashboardShell navigation", () => {
  it("renders branding, the user, the role and every nav item inside a labelled nav", () => {
    shell();
    expect(screen.getByRole("navigation", { name: "Dashboard" })).toBeTruthy();
    expect(screen.getByText("RoboValley Community")).toBeTruthy();
    expect(screen.getByText("Student")).toBeTruthy();
    expect(screen.getByText("Asha Rao")).toBeTruthy();
    for (const i of items) expect(screen.getByRole("link", { name: i.label })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(screen.getByText("page body")).toBeTruthy();
  });

  it("marks only the current page with aria-current", () => {
    h.pathname = "/dashboard/projects";
    shell();
    expect(screen.getByRole("link", { name: "Projects" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
  });

  it("has a skip link targeting the main landmark", () => {
    shell();
    const skip = screen.getByRole("link", { name: /Skip to main content/ });
    expect(skip.getAttribute("href")).toBe("#main");
    expect(document.getElementById("main")?.tagName).toBe("MAIN");
  });

  it("mobile menu: toggles with aria-expanded, closes on Escape (focus returns) and when a link is chosen", async () => {
    const user = userEvent.setup();
    shell();
    const btn = screen.getByRole("button", { name: /Menu/ });
    const aside = document.querySelector(".dside")!;
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.getAttribute("aria-controls")).toBe("dash-nav");
    expect(aside.classList.contains("open")).toBe(false);

    await user.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(aside.classList.contains("open")).toBe(true);

    await user.keyboard("{Escape}");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(btn);

    await user.click(btn);
    await user.click(screen.getByRole("link", { name: "Notifications" }));
    expect(aside.classList.contains("open")).toBe(false);
  });

  it("is keyboard reachable: skip link, menu button, then nav links in order", async () => {
    const user = userEvent.setup();
    shell();
    await user.tab(); expect(document.activeElement?.textContent).toMatch(/Skip to main/);
    await user.tab(); expect(document.activeElement?.textContent).toMatch(/Menu/);
    await user.tab(); expect(document.activeElement?.textContent).toBe("Home");
    await user.tab(); expect(document.activeElement?.textContent).toBe("Projects");
  });
});

describe("responsive stylesheet (static check only; jsdom does not lay out CSS)", () => {
  const css = readFileSync("src/app/dashboard/dashboard.css", "utf8");
  it("hides the sidebar on small screens and shows it permanently from 900px; no horizontal overflow rules are needed", () => {
    expect(css).toMatch(/\.rv \.dside\{display:none/);
    expect(css).toMatch(/@media \(min-width:900px\)/);
    expect(css).toMatch(/\.btn\.menu\{display:none\}/);
    expect(css).toMatch(/grid-template-columns:repeat\(auto-fit,minmax\(210px,1fr\)\)/);
    expect(css).toMatch(/min-width:0/); // lets grid children shrink instead of overflowing on phones
  });
});

describe("ProfileForm", () => {
  const initial = { fullName: "Asha Rao", district: "Guntur", language: "English", profile: { school: "ZP", schoolCode: "1", subjects: ["Maths"] } };
  const mount = () => render(<ProfileForm fields={ROLE_FIELDS.TC} initial={initial} readonly={{ email: "asha@example.com", role: "Teacher / lab in-charge", mobile: "9876543210", age: "18 or older" }} />);
  const save = () => screen.getByRole("button", { name: /Save changes|Saving/ }) as HTMLButtonElement;

  it("shows email, role, mobile and age as read-only; they cannot be edited", () => {
    mount();
    for (const v of ["asha@example.com", "Teacher / lab in-charge", "9876543210", "18 or older"]) {
      const el = screen.getByDisplayValue(v) as HTMLInputElement;
      expect(el.readOnly).toBe(true);
    }
  });

  it("sends only the editable fields (never role/email) and reports success", async () => {
    let sent: Record<string, unknown> = {};
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => { sent = JSON.parse(init.body as string); return new Response(JSON.stringify({ success: true }), { status: 200 }); }));
    const user = userEvent.setup();
    mount();
    await user.clear(screen.getByLabelText(/Full name/));
    await user.type(screen.getByLabelText(/Full name/), "Asha R");
    await user.click(save());
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved."));
    expect(Object.keys(sent).sort()).toEqual(["district", "fullName", "language", "profile"]);
    expect(sent.fullName).toBe("Asha R");
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].method).toBe("PATCH");
    expect(h.refresh).toHaveBeenCalled();
  });

  it("loading state: disabled while saving and only one request for repeated clicks", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchMock = vi.fn(async () => { await gate; return new Response(JSON.stringify({ success: true }), { status: 200 }); });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    mount();
    await user.click(save());
    await waitFor(() => expect(save().disabled).toBe(true));
    expect(save().textContent).toMatch(/Saving/);
    await user.click(save());
    release();
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved."));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows server field errors inline and keeps what was typed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false, message: "Please fix the highlighted fields.", fieldErrors: { "profile.schoolCode": "Please answer: School UDISE or ATL code." } }), { status: 400 })));
    const user = userEvent.setup();
    mount();
    await user.click(save());
    await waitFor(() => expect(screen.getByText("Please answer: School UDISE or ATL code.")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/fix the highlighted/);
    expect((screen.getByLabelText(/Full name/) as HTMLInputElement).value).toBe("Asha Rao");
    expect(save().disabled).toBe(false);
  });

  it("network failure shows a friendly error; an expired session sends the user to /login", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    mount();
    await user.click(save());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Could not reach the server/));
    cleanup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 401 })));
    mount();
    await user.click(save());
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/login"));
  });
});
