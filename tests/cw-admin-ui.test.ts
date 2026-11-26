// @vitest-environment jsdom
// The Admin Approval Dashboard screen (public/cw/js/admin.js) with the demo's mock data: the word diff, Publish disabled until the
// CURRENT version is previewed, the Publish Preview modal (the shared card in an iframe), Edit Before Publishing, Request Changes.
import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "../public/cw/js/admin.js";
import { MockAdapter } from "../public/cw/js/api.js";
import { seed } from "../public/cw/js/demo-seed.js";
import { MESSAGES } from "../public/cw/js/lists.js";
import { DEMO_SECTORS } from "../scripts/build-contribution-workflow.mjs";

const settle = async () => { for (let i = 0; i < 15; i++) await new Promise((r) => setTimeout(r, 0)); };
let el: HTMLElement, mock: MockAdapter;
const q = (s: string) => el.querySelector(s) as HTMLElement;
const click = async (t: Element | null) => { (t as HTMLElement).click(); await settle(); };
const item = (title: string) => Array.from(el.querySelectorAll(".cw-item")).find((b) => b.textContent!.includes(title)) as HTMLElement;
const publishBtn = () => q('[data-act="publish"]') as HTMLButtonElement;

beforeEach(async () => {
  document.body.innerHTML = '<div class="rv"><div class="adm"><div id="a"></div></div></div>';
  el = document.getElementById("a")!;
  mock = new MockAdapter({ sectors: DEMO_SECTORS, publishDelay: 0 });
  await seed(mock);
  await mount(el, { adapter: mock.as("admin"), demoFailToggle: mock });
  await settle();
});

describe("the Admin Approval Dashboard", () => {
  it("lists Awaiting me with its count; a pending idea shows both boxes, the request and the word diff", async () => {
    expect(el.textContent).toContain("Review the original idea, the Moderator's changes, notes and history.");
    expect(q('[data-filter="Awaiting me"]').textContent).toContain(String((await mock.list("approvals", "Awaiting me")).counts.awaiting));
    await click(item("Add cost band"));
    expect(el.textContent).toContain("Contributor");
    expect(el.textContent).toContain("Moderator User");
    expect(q(".cw-boxes .cw-tag").textContent).toBe("Approved as-is");
    expect(el.textContent).toContain("Robots by Sector › Agriculture & Dairy › Weeding robots");
    expect(el.textContent).toContain("Moderator notes: Clear request; approved as-is.");
  });
  it("shows changes word by word: removed in <del>, added in <ins>, with a 'changed' tag (acceptance 9)", async () => {
    await click(q('[data-filter="All"]'));
    await click(item("Drone survey"));
    const path = Array.from(el.querySelectorAll(".cw-diff")).find((d) => d.closest(".cw-field")!.textContent!.startsWith("Suggested path"))!;
    expect(path.innerHTML).toBe("<del>Earn</del><del> </del><del>(18+)</del><ins>Learn</ins>"); // the space between the removed words goes too, as in the demo
    expect(path.closest(".cw-field")!.querySelector(".cw-tag")!.textContent).toBe("changed");
  });
  it("Publish stays disabled until the current version is previewed; the preview shows the shared card, then Publish is enabled", async () => {
    await click(item("Add cost band"));
    expect(publishBtn().disabled).toBe(true);
    expect(el.textContent).toContain(MESSAGES.previewNotice);
    await click(q('[data-act="preview"]'));
    const modal = document.querySelector(".cw-modal") as HTMLElement;
    expect(modal.getAttribute("role")).toBe("dialog");
    expect(modal.querySelector("[data-meta]")!.textContent).toMatch(/^RV-\d+ · version 1 · Agriculture & Dairy section$/);
    const src = (modal.querySelector("iframe") as HTMLIFrameElement).getAttribute("srcdoc") ?? (modal.querySelector("iframe") as any).srcdoc;
    expect(src).toContain("PREVIEW ONLY – not published.");
    expect(src).toContain("Add cost band and where to see weeding robots working");
    expect(src).not.toContain("Clear request; approved as-is."); // never the notes
    expect(Array.from(modal.querySelectorAll(".cw-modal-f button")).map((b) => b.textContent)).toEqual(["Download preview (.html)", "Open in new tab", "Done reviewing"]);
    await click(modal.querySelector('[data-x="done"]'));
    expect(document.querySelector(".cw-modal")).toBeNull();
    expect(el.textContent).toContain(MESSAGES.previewDone);
    expect(publishBtn().disabled).toBe(false);
  });
  it("Edit Before Publishing saves a new version, lists the previous one and needs a new preview", async () => {
    await click(item("Add cost band"));
    await click(q('[data-act="preview"]')); await click(document.querySelector('[data-x="done"]'));
    await click(q('[data-act="edit"]'));
    (q("#cw-a-title") as HTMLInputElement).value = "Cost band and where to see weeding robots";
    await click(q('[data-act="save-edit"]'));
    expect(q(".cw-detail h3").textContent).toContain("Cost band and where to see weeding robots");
    expect(el.textContent).toContain("Previous versions");
    expect(publishBtn().disabled).toBe(true);
    expect(el.textContent).toContain(MESSAGES.previewNotice);
  });
  it("Request Changes asks for feedback in a dialog and returns the idea to the Moderator", async () => {
    await click(item("Add cost band"));
    q('[data-act="changes"]').click(); await settle();
    const ta = document.querySelector('[role="dialog"] textarea') as HTMLTextAreaElement;
    ta.value = "Please add a source for the prices."; ta.dispatchEvent(new Event("input"));
    await click(document.querySelector('[role="dialog"] [data-x="ok"]'));
    expect(q(".cw-detail .rv-badge").textContent).toBe("Changes Requested");
    expect(el.textContent).toContain("This contribution is still with the Moderator. No publishing request yet.");
  });
});
