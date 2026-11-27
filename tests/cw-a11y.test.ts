// @vitest-environment jsdom
// Accessibility pass of every contribution-workflow screen (form, Moderator Workspace, Admin Approval Dashboard with the reason dialog
// and the Publish Preview, Community Ideas): labelled fields, named buttons, unique ids, keyboard-operable pills (real inputs, grouped),
// modal dialogs that are labelled and take focus, announced errors and live status regions, and a bot trap no person can reach.
import { beforeEach, describe, expect, it } from "vitest";
import { mount as mountForm } from "../public/cw/js/form.js";
import { mount as mountModerator } from "../public/cw/js/moderator.js";
import { mount as mountAdmin } from "../public/cw/js/admin.js";
import { mount as mountSite } from "../public/cw/js/site.js";
import { MockAdapter } from "../public/cw/js/api.js";
import { seed } from "../public/cw/js/demo-seed.js";
import { DEMO_SECTORS } from "../scripts/build-contribution-workflow.mjs";

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };
let mock: MockAdapter;

/** Every form control a person can reach has a name; every button has a name; ids are unique. */
function audit(root: HTMLElement) {
  const problems: string[] = [];
  const hiddenFromAll = (el: Element) => Boolean(el.closest('[aria-hidden="true"], [hidden]'));
  for (const c of Array.from(root.querySelectorAll("input, select, textarea"))) {
    if (hiddenFromAll(c) || (c as HTMLInputElement).type === "hidden") continue;
    const id = c.getAttribute("id");
    const named = c.getAttribute("aria-label") || c.closest("label") || (id && root.ownerDocument.querySelector(`label[for="${id}"]`));
    if (!named) problems.push(`unlabelled ${c.tagName.toLowerCase()} ${id ?? c.getAttribute("name") ?? ""}`);
  }
  for (const b of Array.from(root.querySelectorAll("button"))) if (!(b.textContent || "").trim() && !b.getAttribute("aria-label")) problems.push("a button without a name");
  const ids = Array.from(root.ownerDocument.querySelectorAll("[id]")).map((e) => e.id);
  for (const id of new Set(ids)) if (ids.filter((x) => x === id).length > 1) problems.push(`duplicate id ${id}`);
  for (const p of Array.from(root.querySelectorAll(".rv-pill input"))) if (!["radio", "checkbox"].includes((p as HTMLInputElement).type)) problems.push("a pill that is not a real input");
  for (const g of Array.from(root.querySelectorAll(".rv-pills"))) if (g.getAttribute("role") !== "group" && !g.closest("fieldset")) problems.push("pills without a group");
  return problems;
}

beforeEach(async () => {
  document.body.innerHTML = "";
  mock = new MockAdapter({ sectors: DEMO_SECTORS, earlier: 2, publishDelay: 0 });
  await seed(mock);
});

describe("accessibility of every screen", () => {
  it("the Share Your Idea form: labelled fields, grouped pills, an announced error, a bot trap nobody can reach", async () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    await mountForm(el, { adapter: mock, query: new URLSearchParams("") });
    expect(audit(el)).toEqual([]);
    expect(el.querySelectorAll("fieldset legend").length).toBeGreaterThanOrEqual(4);
    const trap = el.querySelector('input[name="website"]') as HTMLInputElement;
    expect(trap.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(trap.tabIndex).toBe(-1);
    (el.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    const err = el.querySelector(".rv-n-err") as HTMLElement;
    expect(err.getAttribute("role")).toBe("alert");
    expect(document.activeElement).toBe(err); // focus moves to the errors
    expect(el.querySelector("[aria-live]")).not.toBeNull();
  });
  it("the Moderator Workspace: named list buttons and filters, labelled editing fields, a labelled modal reason dialog", async () => {
    document.body.innerHTML = '<div class="rv"><div class="adm"><div id="m"></div></div></div>';
    const el = document.getElementById("m")!;
    await mountModerator(el, { adapter: mock.as("moderator") }); await settle();
    (Array.from(el.querySelectorAll(".cw-item")).find((b) => b.textContent!.includes("Smart Irrigation")) as HTMLElement).click(); await settle();
    expect(audit(el)).toEqual([]);
    expect(Array.from(el.querySelectorAll(".cw-chip")).every((c) => c.hasAttribute("aria-pressed"))).toBe(true);
    (el.querySelector('[data-act="decline"]') as HTMLElement).click(); await settle();
    const dlg = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(dlg.getAttribute("aria-labelledby")!)!.textContent).toBe("Decline Idea");
    expect(dlg.contains(document.activeElement)).toBe(true);
    expect(audit(dlg)).toEqual([]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector('[role="dialog"]')).toBeNull(); // Escape closes it
  });
  it("the Admin Approval Dashboard and the Publish Preview: labelled, named, a titled iframe, focus inside the modal", async () => {
    document.body.innerHTML = '<div class="rv"><div class="adm"><div id="a"></div></div></div>';
    const el = document.getElementById("a")!;
    await mountAdmin(el, { adapter: mock.as("admin") }); await settle();
    (Array.from(el.querySelectorAll(".cw-item")).find((b) => b.textContent!.includes("Add cost band")) as HTMLElement).click(); await settle();
    (el.querySelector('[data-act="edit"]') as HTMLElement).click(); await settle();
    expect(audit(el)).toEqual([]);
    (el.querySelector('[data-act="preview"]') as HTMLElement).click(); await settle();
    const modal = document.querySelector(".cw-modal") as HTMLElement;
    expect(modal.getAttribute("role")).toBe("dialog");
    expect(modal.getAttribute("aria-modal")).toBe("true");
    expect(modal.querySelector("iframe")!.getAttribute("title")).toBe("Publish preview");
    expect(modal.contains(document.activeElement)).toBe(true);
    expect(audit(modal)).toEqual([]);
  });
  it("Community Ideas: one heading per sector, a heading for the page, readable link text", async () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    await mountSite(el, { adapter: mock }); await settle();
    expect(audit(el)).toEqual([]);
    expect(el.querySelector("h2")!.textContent).toBe("RoboValley – Community Ideas");
    for (const s of Array.from(el.querySelectorAll(".rv-sector"))) expect(document.getElementById(s.getAttribute("aria-labelledby")!)!.tagName).toBe("H3");
    for (const a of Array.from(el.querySelectorAll("a"))) expect((a.textContent || "").trim().length).toBeGreaterThan(0);
  });
});
