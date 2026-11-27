// @vitest-environment jsdom
// Phase 4 screens with the demo's mock data: publishing from the Admin Approval Dashboard (in progress, Published, Publication Failed,
// Retry Publish) and the public Community Ideas page (sector order, "Other ideas", the empty state, the SAME card as the preview).
import { beforeEach, describe, expect, it } from "vitest";
import { mount as mountAdmin } from "../public/cw/js/admin.js";
import { mount as mountSite } from "../public/cw/js/site.js";
import { MockAdapter } from "../public/cw/js/api.js";
import { seed } from "../public/cw/js/demo-seed.js";
import { renderPublicCard } from "../public/cw/js/card.js";
import { toPublicRecord } from "../public/cw/js/rules.js";
import { MESSAGES } from "../public/cw/js/lists.js";
import { DEMO_SECTORS } from "../scripts/build-contribution-workflow.mjs";

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };
let el: HTMLElement, mock: MockAdapter;
const q = (s: string) => el.querySelector(s) as HTMLElement;
const click = async (t: Element | null) => { (t as HTMLElement).click(); await settle(); };
const item = (title: string) => Array.from(el.querySelectorAll(".cw-item")).find((b) => b.textContent!.includes(title)) as HTMLElement;
const setUp = async (seeded = true) => {
  document.body.innerHTML = '<div class="rv"><div class="adm"><div id="x"></div></div></div>';
  el = document.getElementById("x")!;
  mock = new MockAdapter({ sectors: DEMO_SECTORS, publishDelay: 0 });
  if (seeded) await seed(mock);
};

describe("publishing from the Admin Approval Dashboard", () => {
  beforeEach(async () => { await setUp(); await mountAdmin(el, { adapter: mock.as("admin"), demoFailToggle: mock }); await settle(); });
  const previewAndClose = async () => { await click(q('[data-act="preview"]')); await click(document.querySelector('[data-x="done"]')); };

  it("Publish: Published successfully, verified in the sector; the card is on the public page", async () => {
    await click(item("Add cost band")); await previewAndClose();
    await click(q('[data-act="publish"]'));
    expect(q(".cw-detail .rv-badge").textContent).toBe("Published");
    expect(el.textContent).toMatch(/Published successfully on .+\. Verified on the public website in the Agriculture & Dairy section\./);
    expect((await mock.publicList()).items.some((r: any) => r.title.startsWith("Add cost band"))).toBe(true);
    expect(el.querySelector('[data-act="publish"]')).toBeNull(); // nothing more to decide
  });
  it("a failure shows the error and Retry Publish; the public page is unchanged; the retry publishes exactly one card", async () => {
    await click(item("Add cost band")); await previewAndClose();
    const before = (await mock.publicList()).items.length;
    const toggle = q("[data-demo-fail]") as HTMLInputElement; toggle.checked = true; toggle.dispatchEvent(new Event("change"));
    await click(q('[data-act="publish"]'));
    expect(q(".cw-detail .rv-badge").textContent).toBe("Publication Failed");
    expect(el.textContent).toContain("Nothing was changed on the public website. You can safely retry; it will not create a duplicate.");
    expect((await mock.publicList()).items.length).toBe(before);
    expect(q('[data-act="publish"]').textContent).toBe("Retry Publish");
    expect((q('[data-act="publish"]') as HTMLButtonElement).disabled).toBe(false); // this version was previewed
    await click(q('[data-act="publish"]'));
    expect(q(".cw-detail .rv-badge").textContent).toBe("Published");
    expect((await mock.publicList()).items.length).toBe(before + 1);
  });
  it("shows the in-progress notice while publishing, and never Published before the site confirms", async () => {
    mock.publishDelay = 50;
    await click(item("Add cost band")); await previewAndClose();
    (q('[data-act="publish"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 5));
    expect(el.textContent).toContain("Publishing to the website and refreshing the page… Status will change only after the website confirms.");
    expect(q(".cw-detail .rv-badge").textContent).toBe("Publication In Progress");
    await new Promise((r) => setTimeout(r, 120)); await settle();
    expect(q(".cw-detail .rv-badge").textContent).toBe("Published");
  });
});

describe("Community Ideas", () => {
  it("groups by sector in Sector Forms' order, Not sure last as Other ideas; each card is the preview's card with its date", async () => {
    await setUp();
    await mountSite(el, { adapter: mock }); await settle();
    expect(q(".rv-site-head h2").textContent).toBe("RoboValley – Community Ideas");
    expect(q(".rv-site-head p").textContent).toBe("Public website. Only contributions an Admin has published appear here.");
    expect(Array.from(el.querySelectorAll(".rv-sector h3")).map((h) => h.textContent)).toEqual(["Healthcare", "Other ideas"]);
    const pub = (await mock.publicList()).items[0];
    expect(el.innerHTML).toContain(renderPublicCard(pub));
    expect(el.textContent).toMatch(/Published \d/);
    expect(el.textContent).not.toMatch(/Smart Irrigation|Medicine reminder|robot arm kit|Sorting robot/); // never drafts, pending or failed
  });
  it("the card on the site is exactly the card the Publish Preview showed", async () => {
    await setUp();
    const it = (await mock.detail(mock.items.find((x: any) => x.status === "published")!.id)).item;
    const fromPreview = renderPublicCard(toPublicRecord({ ...it, version: it.versions.length }, { sectors: DEMO_SECTORS, version: it.versions.length }));
    const live = (await mock.publicList()).items.find((r: any) => r.id === it.id);
    expect(renderPublicCard(live)).toBe(fromPreview);
  });
  it("shows the empty-state text when nothing is published", async () => {
    await setUp(false);
    await mountSite(el, { adapter: mock }); await settle();
    expect(q(".rv-empty").textContent).toBe(MESSAGES.publicEmpty);
  });
});
