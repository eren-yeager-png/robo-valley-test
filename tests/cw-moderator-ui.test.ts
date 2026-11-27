// @vitest-environment jsdom
// The Moderator Workspace screen (public/cw/js/moderator.js) with the demo's mock data: list, filters, the old-form line, opening,
// editing, Save Draft, Submit Publishing Request, the send rules, Decline through the reason dialog, and the banners.
import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "../public/cw/js/moderator.js";
import { MockAdapter } from "../public/cw/js/api.js";
import { seed } from "../public/cw/js/demo-seed.js";
import { MESSAGES } from "../public/cw/js/lists.js";
import { DEMO_SECTORS } from "../scripts/build-contribution-workflow.mjs";

const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };
let el: HTMLElement, mock: MockAdapter;
const q = (s: string) => el.querySelector(s) as HTMLElement;
const click = async (target: Element | null) => { (target as HTMLElement).click(); await settle(); };
const itemButton = (title: string) => Array.from(el.querySelectorAll(".cw-item")).find((b) => b.textContent!.includes(title)) as HTMLElement;

beforeEach(async () => {
  document.body.innerHTML = '<div class="rv"><div class="adm"><div id="m"></div></div></div>';
  el = document.getElementById("m")!;
  mock = new MockAdapter({ sectors: DEMO_SECTORS, earlier: 2, publishDelay: 0 });
  await seed(mock);
  await mount(el, { adapter: mock.as("moderator") });
  await settle();
});

describe("the Moderator Workspace", () => {
  it("shows the intro, the older contributions line, Open by default with its count, and Nothing here for an empty filter", async () => {
    expect(el.textContent).toContain("Verify each idea. If it is good as it is, send it to Admin unchanged.");
    expect(q("[data-earlier]").textContent).toBe("Earlier contributions (old form): 2, open in Moderation");
    expect((q('[data-earlier] a') as HTMLAnchorElement).getAttribute("href")).toBe("/admin/moderation");
    const open = q('[data-filter="Open"]');
    expect(open.getAttribute("aria-pressed")).toBe("true");
    expect(open.textContent).toContain(String((await mock.list("workspace", "Open")).counts.open));
    expect(el.querySelectorAll(".cw-item").length).toBe((await mock.list("workspace", "Open")).items.length);
    await click(q('[data-filter="Decided"]'));
    expect(Array.from(el.querySelectorAll(".cw-item .rv-badge")).map((b) => b.textContent).sort()).toEqual(["Published", "Published", "Rejected", "Rejected", "Unpublished", "Unpublished"]);
    expect(el.textContent).toContain("Select a contribution to review.");
  });
  it("opening a Submitted idea moves it to Under Moderator Review and shows the original, the version for publishing and the buttons", async () => {
    await click(itemButton("Smart Irrigation System"));
    expect(q(".cw-detail h3").textContent).toMatch(/^RV-\d+ – Smart Irrigation System$/);
    expect(q(".cw-detail .rv-badge").textContent).toBe("Under Moderator Review");
    expect(el.textContent).toContain("Original submission (read-only)");
    expect(q(".cw-h4 .cw-tag").textContent).toBe("Unchanged");
    expect(Array.from(el.querySelectorAll("[data-act]")).map((b) => b.textContent)).toEqual(["Save Draft", "Reset to Original", "Submit Publishing Request to Admin", "Decline Idea"]);
    expect(el.textContent).toContain("If you made no changes, the original idea is sent to Admin as-is. None of these actions publish anything.");
    expect(q(".cw-attach").textContent).toContain("irrigation-sketch.png");
  });
  it("Save Draft: says nothing was published and marks the version Edited; Submit sends it to Admin and locks it", async () => {
    await click(itemButton("Smart Irrigation System"));
    (q("#cw-m-title") as HTMLInputElement).value = "Smart irrigation for school gardens";
    await click(q('[data-act="save"]'));
    expect(q("[data-msg]").textContent).toBe(MESSAGES.draftSaved);
    expect(q(".cw-h4 .cw-tag").textContent).toBe("Edited");
    expect(q(".cw-detail .rv-badge").textContent).toBe("Moderator Draft");
    await click(q('[data-act="send"]'));
    expect(q("[data-msg] .cw-n-ok").innerHTML).toBe("Request sent to Admin. Status: <b>Pending Admin Approval</b>. It is still not public.");
    expect(el.textContent).toContain("Publishing request is with Admin. You can't edit it until Admin responds.");
    expect(el.querySelector("[data-act]")).toBeNull();
    expect((q("#cw-m-title") as HTMLInputElement).readOnly).toBe(true);
  });
  it("the send rules are shown in red and nothing is sent", async () => {
    await click(itemButton("Smart Irrigation System"));
    (q("#cw-m-desc") as HTMLTextAreaElement).value = "Too short.";
    await click(q('[data-act="send"]'));
    expect(q("[data-msg] .cw-n-err").textContent).toBe(MESSAGES.sendLength);
    el.querySelectorAll<HTMLInputElement>('input[name="cw-m-cat"]').forEach((c) => { c.checked = false; });
    (q("#cw-m-desc") as HTMLTextAreaElement).value = "Long enough description of the idea.";
    await click(q('[data-act="send"]'));
    expect(q("[data-msg] .cw-n-err").textContent).toBe(MESSAGES.sendCategory);
  });
  it("Decline opens a real dialog whose button stays disabled until a reason is typed; then Rejected with the reason", async () => {
    await click(itemButton("Smart Irrigation System"));
    q('[data-act="decline"]').click(); await settle();
    const dlg = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    const ok = dlg.querySelector('[data-x="ok"]') as HTMLButtonElement, ta = dlg.querySelector("textarea") as HTMLTextAreaElement;
    expect(ok.disabled).toBe(true);
    expect(document.activeElement).toBe(ta);
    ta.value = "Already covered by another idea."; ta.dispatchEvent(new Event("input"));
    expect(ok.disabled).toBe(false);
    await click(ok);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(q(".cw-detail .rv-badge").textContent).toBe("Rejected");
    expect(el.textContent).toMatch(/Declined by Moderator User \(Moderator\) on .+\. Reason: Already covered by another idea\./);
  });
  it("an idea Admin sent back shows the feedback banner and can be edited again", async () => {
    await click(itemButton("robot arm kit guide"));
    expect(el.textContent).toContain("Admin requested changes: Please say which robot arm kit this is for and add a photo of the finished arm.");
    expect(el.querySelector('[data-act="send"]')).not.toBeNull();
  });
});
