// @vitest-environment jsdom
// Login activity: the stat cards filter the table (A2). The address is the only state: cards, chips, a shared link and a refresh agree.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { activityHref } from "../src/app/admin/login-activity/activityHref";
import EventCards from "../src/app/admin/login-activity/EventCards";

const CARDS = [{ type: "login_success", label: "Successful login", value: 1234 }, { type: "otp_failed", label: "OTP failed", value: 0 }];
const scroll = vi.fn();
const page = (active: string, days = 30) => (<><EventCards cards={CARDS} active={active} days={days} tableId="t" /><div id="t">table</div></>);

beforeEach(() => { push.mockReset(); scroll.mockReset(); Element.prototype.scrollIntoView = scroll; window.matchMedia = vi.fn(() => ({ matches: false })) as never; });
afterEach(cleanup);

describe("the address", () => {
  it("holds the event type and the period; without a type only the period", () => {
    expect(activityHref(30, "otp_failed")).toBe("/admin/login-activity?event=otp_failed&range=30");
    expect(activityHref(90, "")).toBe("/admin/login-activity?range=90");
  });
});

describe("the cards", () => {
  it("are real buttons with their pressed state, a card at 0 included", () => {
    render(page("otp_failed"));
    const all = screen.getAllByRole("button") as HTMLButtonElement[];
    expect(all.map((b) => b.type)).toEqual(["button", "button"]);
    expect(all.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    expect(all.every((b) => b.matches(".adm-card.stat") && !b.disabled && b.getAttribute("aria-controls") === "t")).toBe(true);
    expect(all[0].textContent).toBe("Successful login1,234");
    expect(all[1].textContent).toBe("OTP failed0");
  });

  it("a click opens that event type and keeps the period, without jumping to the top", () => {
    render(page("", 90));
    fireEvent.click(screen.getByRole("button", { name: /OTP failed/ }));
    expect(push).toHaveBeenCalledExactlyOnceWith("/admin/login-activity?event=otp_failed&range=90", { scroll: false });
  });

  it("a click on the selected card shows all events again", () => {
    render(page("otp_failed", 7));
    fireEvent.click(screen.getByRole("button", { name: /OTP failed/ }));
    expect(push).toHaveBeenCalledExactlyOnceWith("/admin/login-activity?range=7", { scroll: false });
  });

  it("the table is scrolled into view smoothly, once the filtered page has arrived", () => {
    const r = render(page(""));
    fireEvent.click(screen.getByRole("button", { name: /OTP failed/ }));
    expect(scroll).not.toHaveBeenCalled(); // the old table is still there
    r.rerender(page("otp_failed"));
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ behavior: "smooth", block: "start" });
    expect(scroll.mock.contexts[0]).toBe(document.getElementById("t"));
  });

  it("only a click on a card moves the page: a chip, a link or Back does not; with reduced motion it jumps", () => {
    const r = render(page(""));
    r.rerender(page("login_success")); // a chip was used
    expect(scroll).not.toHaveBeenCalled();
    window.matchMedia = vi.fn(() => ({ matches: true })) as never;
    fireEvent.click(screen.getByRole("button", { name: /OTP failed/ }));
    r.rerender(page("otp_failed"));
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ behavior: "auto", block: "start" });
  });
});
