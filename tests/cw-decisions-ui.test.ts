// @vitest-environment jsdom
// The spec's open points as decided (27-11-2026), on the screens with the demo's mock data: Unpublish and publishing again, Edit
// after publishing, the Rejected filter (who declined or rejected, why, when) and Reopen, the Moderator's banners, and the Earn (18+)
// path for minors (form, Moderator Workspace, Admin Approval Dashboard).
import { beforeEach, describe, expect, it } from "vitest";
import { mount as mountAdmin } from "../public/cw/js/admin.js";
import { mount as mountModerator } from "../public/cw/js/moderator.js";
import { mount as mountForm } from "../public/cw/js/form.js";
import { mount as mountSite } from "../public/cw/js/site.js";
import { MockAdapter } from "../public/cw/js/api.js";
import { seed } from "../public/cw/js/demo-seed.js";
import { MESSAGES } from "../public/cw/js/lists.js";
import { DEMO_SECTORS } from "../scripts/build-contribution-workflow.mjs";

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };
let el: HTMLElement, mock: MockAdapter;
const q = (s: string) => el.querySelector(s) as HTMLElement;
const click = async (t: Element | null) => { (t as HTMLElement).click(); await settle(); };
const item = (title: string) => Array.from(el.querySelectorAll(".cw-item")).find((b) => b.textContent!.includes(title)) as HTMLElement;
const badge = () => q(".cw-detail .rv-badge").textContent;
const dialog = () => document.querySelector('[role="dialog"].rv-dlg') as HTMLElement;
const cardsFor = async (title: string) => (await mock.publicList()).items.filter((c: any) => c.title.startsWith(title)).length;
async function setUp(screen: "admin" | "moderator") {
  document.body.innerHTML = '<div class="rv"><div class="adm"><div id="x"></div></div></div>';
  el = document.getElementById("x")!;
  mock = new MockAdapter({ sectors: DEMO_SECTORS, publishDelay: 0, earlier: 2 });
  await seed(mock);
  if (screen === "admin") await mountAdmin(el, { adapter: mock.as("admin"), demoFailToggle: mock });
  else await mountModerator(el, { adapter: mock.as("moderator") });
  await settle();
}
const previewAndClose = async () => { await click(q('[data-act="preview"]')); await click(document.querySelector('.cw-modal [data-x="done"]')); };

describe("the Admin Approval Dashboard after publishing", () => {
  beforeEach(async () => { await setUp("admin"); });

  it("the Published filter lists Published and Unpublished ideas, each with its own badge", async () => {
    await click(q('[data-filter="Published"]'));
    const badges = Array.from(el.querySelectorAll(".cw-item .rv-badge")).map((b) => b.textContent);
    expect(badges).toContain("Published");
    expect(badges).toContain("Unpublished");
    expect(el.querySelector(".cw-item .rv-s-unpublished")).not.toBeNull();
  });
  it("Unpublish asks for confirmation (Cancel keeps it); then Unpublished, the card is gone and it says so", async () => {
    await click(q('[data-filter="Published"]'));
    await click(item("Beach clean-up robot challenge"));
    expect(await cardsFor("Beach clean-up robot challenge")).toBe(1);
    await click(q('[data-act="unpublish"]'));
    expect(dialog().getAttribute("aria-modal")).toBe("true");
    expect(dialog().textContent).toContain(MESSAGES.unpublishText);
    expect(document.getElementById(dialog().getAttribute("aria-labelledby")!)!.textContent).toMatch(/^Unpublish RV-\d+\?$/); // named and described
    expect(document.getElementById(dialog().getAttribute("aria-describedby")!)!.textContent).toBe(MESSAGES.unpublishText);
    expect(document.activeElement).toBe(dialog().querySelector('[data-x="ok"]')); // focus inside the dialog
    await click(dialog().querySelector('[data-x="cancel"]'));
    expect(badge()).toBe("Published");
    await click(q('[data-act="unpublish"]'));
    await click(dialog().querySelector('[data-x="ok"]'));
    expect(badge()).toBe("Unpublished");
    expect(el.textContent).toContain(MESSAGES.unpublished);
    expect(await cardsFor("Beach clean-up robot challenge")).toBe(0);
    expect(q('[data-act="unpublish"]')).toBeNull();
  });
  it("an Unpublished idea: who and when; Publish stays disabled until the preview; publishing again brings back exactly one card", async () => {
    await click(q('[data-filter="Published"]'));
    await click(item("Library book-return robot"));
    expect(el.textContent).toMatch(/Unpublished on .+ by Admin User\. The card is no longer on the Community Ideas page\. To publish it again: open the publish preview, then publish\./);
    expect((q('[data-act="publish"]') as HTMLButtonElement).disabled).toBe(true);
    await previewAndClose();
    await click(q('[data-act="publish"]'));
    expect(badge()).toBe("Published");
    expect(await cardsFor("Library book-return robot")).toBe(1);
  });
  it("edit after publishing: the warning shows; the live card keeps the old title until the new version is previewed and published", async () => {
    await click(q('[data-filter="Published"]'));
    await click(item("(pilot)"));
    expect(el.textContent).toContain("Version 2 has changes that are not on the public website yet. Open the publish preview, then publish to update the live card.");
    expect((await mock.publicList()).items.find((c: any) => c.title.startsWith("Delivery robot")).title).toBe("Delivery robot for hospital corridors and wards");
    expect((q('[data-act="publish"]') as HTMLButtonElement).disabled).toBe(true);
    await click(q('[data-act="edit"]'));
    expect(el.textContent).toContain("This makes a new version. The public card changes only when you open the preview and publish again.");
    await click(q('[data-act="cancel-edit"]'));
    await previewAndClose();
    await click(q('[data-act="publish"]'));
    expect(badge()).toBe("Published");
    expect(el.textContent).not.toContain("has changes that are not on the public website yet");
    expect((await mock.publicList()).items.filter((c: any) => c.title.startsWith("Delivery robot")).map((c: any) => c.title)).toEqual(["Delivery robot for hospital corridors and wards (pilot)"]);
  });
  it("a Published idea with nothing new offers Edit Before Publishing and Unpublish, but no Publish", async () => {
    await click(q('[data-filter="Published"]'));
    await click(item("Beach clean-up robot challenge"));
    expect(Array.from(el.querySelectorAll(".cw-detail [data-act]")).map((b) => b.textContent!.trim())).toEqual(["Edit Before Publishing", "Unpublish"]);
  });
  it("the Rejected filter shows who declined or rejected and when; Reopen needs a reason, then it is back with the Moderator", async () => {
    await click(q('[data-filter="Rejected"]'));
    const metas = Array.from(el.querySelectorAll(".cw-item .cw-decision")).map((m) => m.textContent);
    expect(metas.some((t) => /^Declined by Moderator User \(Moderator\) · /.test(t!))).toBe(true);
    expect(metas.some((t) => /^Rejected by Admin User \(Admin\) · /.test(t!))).toBe(true);
    await click(item("Robot that does my homework"));
    expect(el.textContent).toMatch(/Declined by Moderator User \(Moderator\) on .+\. Reason: Not a contribution to RoboValley: it asks for a robot to do homework\./);
    await click(q('[data-act="reopen"]'));
    const ok = dialog().querySelector('[data-x="ok"]') as HTMLButtonElement, ta = dialog().querySelector("textarea") as HTMLTextAreaElement;
    expect(dialog().textContent).toContain(MESSAGES.reopenLabel);
    expect(ok.disabled).toBe(true);
    ta.value = "Worth a second look as a homework-helper idea."; ta.dispatchEvent(new Event("input"));
    await click(ok);
    expect(badge()).toBe("Under Moderator Review");
    expect(el.textContent).toContain("Reopened. It is back with the Moderator (Under Moderator Review).");
    expect(el.textContent).toContain("Reopened the idea for Moderator review. Reason: Worth a second look as a homework-helper idea.");
  });
  it("a version with Earn (18+) on a minor's idea cannot be previewed or published, with the message", async () => {
    const kid = (mock as any).items.find((x: any) => x.contributor.minor && x.status === "changes_requested");
    Object.assign(kid, { status: "pending", proposed: { ...kid.proposed, learningPath: "Earn (18+)" } }); // data from before the rule
    await click(q('[data-filter="Awaiting me"]'));
    await click(item(kid.proposed.title));
    expect(el.textContent).toContain(MESSAGES.earnMinorPublish);
    expect(el.textContent).toContain("Under 18");
    expect((q('[data-act="publish"]') as HTMLButtonElement).disabled).toBe(true);
    await click(q('[data-act="preview"]'));
    expect(document.querySelector(".cw-modal")).toBeNull();
    expect(q("[data-msg]").textContent).toContain(MESSAGES.earnMinorPublish);
  });
});

describe("the Moderator Workspace after the decisions", () => {
  beforeEach(async () => { await setUp("moderator"); });

  it("a reopened idea shows the Admin's reason and can be worked on again", async () => {
    await click(item("Water-quality robot boat"));
    expect(el.textContent).toMatch(/Reopened by Admin: Not a duplicate: the earlier idea was about beaches\. Please review it again\./);
    expect(q('[data-act="send"]')).not.toBeNull();
  });
  it("an Unpublished idea is read-only with its banner; a rejection names who decided", async () => {
    await click(q('[data-filter="Decided"]'));
    await click(item("Library book-return robot"));
    expect(el.textContent).toContain("Unpublished by Admin: it is no longer on the public website.");
    expect(q('[data-act="save"]')).toBeNull();
    await click(item("Robot that drives the school bus"));
    expect(el.textContent).toMatch(/Rejected by Admin User \(Admin\) on .+\. Reason: A robot must not drive a school bus/);
  });
  it("Earn (18+) cannot be chosen for a minor's idea: the option is disabled with a note, and saving it anyway is refused with the message", async () => {
    await click(item("robot arm kit guide")); // a minor's idea, back with the Moderator
    const earn = q('#cw-m-path option[value="Earn (18+)"]') as HTMLOptionElement;
    expect(earn.disabled).toBe(true);
    expect(q("#cw-m-path-hint").textContent).toBe(MESSAGES.earnMinorHint);
    expect(q("#cw-m-path").getAttribute("aria-describedby")).toBe("cw-m-path-hint");
    (q("#cw-m-path") as HTMLSelectElement).value = "Earn (18+)"; // forced, as a script could
    await click(q('[data-act="save"]'));
    expect(q("[data-msg]").textContent).toContain(MESSAGES.earnMinorReview);
  });
  it("an adult's idea keeps the Earn (18+) option", async () => {
    await click(item("lawn mower")); // an adult's idea (Moderator Draft)
    expect((q('#cw-m-path option[value="Earn (18+)"]') as HTMLOptionElement).disabled).toBe(false);
    expect(q("#cw-m-path-hint")).toBeNull();
  });
});

describe("the form and the public page", () => {
  const form = async (minor: boolean) => {
    document.body.innerHTML = '<div id="f"></div>';
    el = document.getElementById("f")!;
    mock = new MockAdapter({ sectors: DEMO_SECTORS, me: { name: "Neha S.", type: "Student", minor } });
    await mountForm(el, { adapter: mock, query: new URLSearchParams("") });
    await settle();
  };
  it("a contributor under 18 is not offered the Earn (18+) path, and the helper text says only what applies", async () => {
    await form(true);
    expect(el.querySelector('input[name="rv-path"][value="Earn (18+)"]')).toBeNull();
    expect(el.querySelectorAll('input[name="rv-path"]').length).toBe(5);
    expect(el.textContent).toContain("Not sure? Leave it: the moderator will set it.");
    expect(el.textContent).not.toContain("Earn path is for learners 18 and above");
  });
  it("an adult sees the Earn (18+) path with its helper text", async () => {
    await form(false);
    expect(el.querySelector('input[name="rv-path"][value="Earn (18+)"]')).not.toBeNull();
    expect(el.textContent).toContain("Earn path is for learners 18 and above. Not sure? Leave it: the moderator will set it.");
  });
  it("Community Ideas: an unpublished card disappears; publishing again shows it once", async () => {
    await setUp("admin");
    const adm = mock.as("admin");
    const site = async () => { document.body.innerHTML = '<div id="s"></div>'; el = document.getElementById("s")!; await mountSite(el, { adapter: mock }); await settle(); return el.textContent!.split("Beach clean-up robot challenge").length - 1; };
    expect(await site()).toBe(1);
    const id = (mock as any).items.find((x: any) => x.original.title === "Beach clean-up robot challenge").id;
    let it = (await adm.detail(id)).item;
    it = (await adm.act(id, "unpublish", { rowVersion: it.rowVersion })).item;
    expect(await site()).toBe(0);
    it = (await adm.act(id, "preview", { rowVersion: it.rowVersion, version: it.versions.length })).item;
    await adm.publish(id, { rowVersion: it.rowVersion });
    expect(await site()).toBe(1);
  });
});
