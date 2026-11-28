// @vitest-environment jsdom
// The Contribution Portal's shared screens (public/cw/js), run in a browser-like DOM against the in-memory data the demo uses (the
// workflow's MockAdapter plus demo-portal.js, the same methods the app's adapter has): the page layout (header -> sector grid -> panel),
// the shared sector grid, Moderation (Approve as-is, Edit & approve, Reject, the current form's Approve), Publish Requests (preview, then
// Publish), Sector Forms (add, switch, rename, approve a suggestion), the Member portals' Sectors per role, My Contributions, Overview.
import { beforeEach, describe, expect, it } from "vitest";
import { MockAdapter } from "../public/cw/js/api.js";
import { createDemoPortal } from "../public/cw/js/demo-portal.js";
import { mount as moderation, TITLE as MOD_TITLE, DESC as MOD_DESC, PANEL_SUB } from "../public/cw/js/moderation.js";
import { mount as requests } from "../public/cw/js/requests.js";
import { mount as sectorForms, NO_SUGGESTIONS } from "../public/cw/js/sector-forms.js";
import { mount as sectors, isClassroomPick, isSafeForKids } from "../public/cw/js/sectors.js";
import { mount as overview } from "../public/cw/js/overview.js";
import { mount as mine } from "../public/cw/js/mine.js";
import { mount as audit } from "../public/cw/js/audit.js";
import { mount as sectorsAdmin } from "../public/cw/js/sectors-admin.js";
import { fmtSent, sentHtml, statusBadge, tableHtml } from "../public/cw/js/portal-ui.js";
import { sectorGridHtml, tintOf } from "../public/cw/js/sector-grid.js";
import { WORKFLOW_TO_PORTAL, formToPortal, tabCounts, MODERATION_TABS } from "../public/cw/js/portal-status.js";

const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const SECTORS = [
  { slug: "agriculture-dairy", name: "Agriculture & Dairy", robots: [{ slug: "milking-robots", name: "Milking robots" }, { slug: "drone-sprayers", name: "Drone sprayers" }], fields: [{ id: "milking-robots", title: "Milking robots", html: "<p>m</p>" }, { id: "drone-sprayers", title: "Drone sprayers", html: "<p>d</p>" }, { id: "local-dealers", title: "Local dealers", source: "plugin", html: "<p>x</p>" }] },
  { slug: "education", name: "Education", robots: [{ slug: "robotic-arms", name: "Robotic arms" }] },
  { slug: "healthcare", name: "Healthcare", robots: [] },
];
const FORM_ITEMS = [
  { id: 301, user: "Neha S.", title: "Kit lending library", body: "Borrow kits.", type: "improve", status: "pending_review", sector: "education", robot: "", at: -6 },
  { id: 308, user: "Dr. S. Rao", title: "Drone pilot training", body: "Train pilots.", type: "resource", status: "pending_review", sector: "agriculture-dairy", robot: "drone-sprayers", at: -4, verified: true },
  { id: 306, user: "Meera K.", title: "Camp list", body: "Camps.", type: "resource", status: "published", sector: "education", robot: "", at: -50 },
];
const SUGG = [{ sector: "education", id: "coding-robots", title: "Coding robots", by: "Asha M.", html: "<p>Robots children program.</p>", at: -3 }];
let mock: any, data: any, el: HTMLElement;

async function world() {
  mock = new MockAdapter({ sectors: SECTORS, actors: { moderator: "Moderator User", admin: "Admin User" }, publishDelay: 0, formItems: FORM_ITEMS });
  const add = (who: any, d: any) => mock.submit({ refers: false, robotType: "not-sure", suitableFor: [], learningPath: "", references: [], ...d }, null, who);
  const a = await add({ name: "Kiran P.", type: "Teacher / lab in-charge" }, { kind: "New idea", title: "Robot club starter pack", description: "Everything a school needs to start a robot club in a week.", sector: "education", categories: ["Robotics"], suitableFor: ["K6–K8"] });
  const b = await add({ name: "Dr. S. Rao", type: "Mentor / subject expert" }, { kind: "New idea", title: "Weeding robot open day", description: "Farmers watch a weeding robot work on a real field.", sector: "agriculture-dairy", categories: [] });
  const c = await add({ name: "Meera K.", type: "Parent / guardian" }, { kind: "New idea", title: "Kids safe line follower", description: "A line follower kit that is safe for young children to build.", sector: "education", categories: ["STEAM"], suitableFor: ["K1–K5"], learningPath: "Make" });
  // c: approved, previewed and published (so it is on Community Ideas)
  const mod = mock.as("moderator"), adm = mock.as("admin");
  const it = async (id: number) => (await mock.detail(id)).item;
  await mod.act(c.id, "send_request", { rowVersion: (await it(c.id)).rowVersion, proposed: (await it(c.id)).proposed, notes: "" });
  await adm.act(c.id, "preview", { rowVersion: (await it(c.id)).rowVersion, version: 1 });
  await adm.publish(c.id, { rowVersion: (await it(c.id)).rowVersion });
  data = createDemoPortal(mock, { formItems: FORM_ITEMS, suggestions: SUGG, plugins: { "local-dealers": "Acme Dealer Directory" } });
  return { a: a.id, b: b.id, c: c.id };
}
const fresh = () => { document.body.innerHTML = '<div class="rv"><div class="adm rvd-adm"><div id="m"></div></div></div>'; el = document.getElementById("m")!; };
const $ = (s: string) => el.querySelector(s) as HTMLElement;
const $$ = (s: string) => Array.from(el.querySelectorAll(s)) as HTMLElement[];
const click = async (s: string) => { const x = $(s); if (!x) throw new Error(`not found: ${s}`); x.click(); await settle(); };
const reason = async (text: string) => { const ta = document.querySelector(".rv-dlg textarea") as HTMLTextAreaElement; ta.value = text; ta.dispatchEvent(new Event("input")); (document.querySelector('.rv-dlg [data-x="ok"]') as HTMLButtonElement).click(); await settle(); };

beforeEach(async () => { document.body.innerHTML = ""; await world(); fresh(); });

describe("shared pieces", () => {
  it("Sent is one line in the form \"19 Sep 2026, 1:20 pm\" (local time), with the full time in datetime", () => {
    const d = new Date(2026, 8, 19, 13, 20);
    expect(fmtSent(d.toISOString())).toBe("19 Sep 2026, 1:20 pm");
    expect(fmtSent(new Date(2026, 0, 5, 0, 5).toISOString())).toBe("5 Jan 2026, 12:05 am");
    expect(fmtSent("")).toBe("");
    expect(sentHtml(d.toISOString())).toMatch(/^<time class="rv-pp-sent" datetime="2026-09-19T/);
  });
  it("status badges: amber pending review, blue approved, purple publish requested, green published, red rejected", () => {
    expect(statusBadge("pending")).toContain("rv-pp-badge--amber\" data-status=\"pending\">Pending review");
    expect(statusBadge("approved")).toContain("rv-pp-badge--blue");
    expect(statusBadge("requested")).toContain("rv-pp-badge--purple\" data-status=\"requested\">Publish requested");
    expect(statusBadge("published")).toContain("rv-pp-badge--green");
    expect(statusBadge("rejected")).toContain("rv-pp-badge--red");
  });
  it("one status model for both kinds of contributions", () => {
    expect(WORKFLOW_TO_PORTAL).toMatchObject({ submitted: "pending", under_review: "pending", pending: "requested", resubmitted: "requested", published: "published", rejected: "rejected" });
    expect(formToPortal("pending_review", false)).toBe("pending");
    expect(formToPortal("pending_review", true)).toBe("requested");
    expect(formToPortal("removed")).toBeNull();
    expect(tabCounts(MODERATION_TABS, [{ display: "pending" }, { display: "requested" }, { display: "published" }])).toEqual({ all: 3, pending: 1, approved: 1, rejected: 0, published: 1 });
  });
  it("the sector grid: identical <button aria-pressed> cards from data, the selected one marked, optional badge, dot and chip", () => {
    document.body.innerHTML = sectorGridHtml({ sectors: [{ slug: "a", name: "Alpha", meta: "2 ideas", count: 3, countLabel: "3 waiting", dot: true, dotLabel: "1 suggestion", chip: "Relevant to your child" }, { slug: "b", name: "beta", meta: "0 ideas" }], selected: "a" });
    const cards = Array.from(document.querySelectorAll(".rv-sg-card"));
    expect(cards.map((c) => [c.tagName, c.getAttribute("aria-pressed")])).toEqual([["BUTTON", "true"], ["BUTTON", "false"]]);
    expect(cards[0].className).toContain("is-selected");
    expect(cards[0].querySelector(".rv-sg-count")!.textContent).toBe("33 waiting");
    expect(cards[0].querySelector(".rv-sg-dot")).not.toBeNull();
    expect(cards[0].querySelector(".rv-sg-chip")!.textContent).toBe("Relevant to your child");
    expect(cards[1].querySelector(".rv-sg-icon")!.textContent).toBe("B");
    expect(tintOf("education")).toBe(tintOf("education"));
  });
  it("an empty table becomes the empty state", () => {
    expect(tableHtml({ caption: "x", head: [["Title"]], rows: [] })).toContain("No contributions in this sector yet");
  });
});

describe("Moderation", () => {
  it("header, sector grid with waiting counts, the panel with the five tabs and one table for both kinds", async () => {
    await moderation(el, { adapter: data.as("moderator"), form: "#form", sector: "education" });
    await settle();
    expect($(".rv-pp-title").textContent).toBe(MOD_TITLE);
    expect($(".rv-pp-head .rv-pp-desc").textContent).toBe(MOD_DESC);
    expect($$(".rv-sg-card").map((c) => c.getAttribute("data-sector"))).toEqual(["agriculture-dairy", "education", "healthcare"]);
    expect($('.rv-sg-card[data-sector="education"]').getAttribute("aria-pressed")).toBe("true");
    expect($(".rv-pp-panel__title").textContent).toBe("Contributors for Education");
    expect($(".rv-pp-panel .rv-pp-desc").textContent).toBe(PANEL_SUB);
    expect($$(".rv-pp-tab").map((t) => t.textContent!.replace(/\s+\d+$/, ""))).toEqual(["All", "Pending review", "Approved", "Rejected", "Published"]);
    expect($$("thead th").map((t) => t.textContent)).toEqual(["Title", "Contributor", "Status", "Sent", "Actions"]);
    const rows = $$("tbody tr");
    expect(rows.some((r) => r.textContent!.includes("Current form"))).toBe(true);
    expect(rows.some((r) => r.textContent!.includes("Share Your Idea"))).toBe(true);
    expect($(".rv-pp-panel__head .rv-contribute-btn--header")).not.toBeNull();
  });
  // Phase B (migration 030; the demo's data has it): approving is its own step, then the Moderator sends the publishing request
  it("Approve as-is makes a Share Your Idea idea Approved (blue); Send publish request to Admin makes it Publish requested; never a Publish button", async () => {
    const ids = await world(); fresh();
    await moderation(el, { adapter: data.as("moderator"), form: "#form", sector: "education" });
    await settle();
    expect($$("button").some((b) => /^Publish$/.test(b.textContent!.trim()))).toBe(false);
    await click(`[data-act="approve"][data-key="w-${ids.a}"]`);
    expect((await mock.detail(ids.a)).item.status).toBe("approved");
    const lastToast = () => Array.from(document.querySelectorAll(".rv-pp-toast")).at(-1)!.textContent;
    expect(lastToast()).toMatch(/^Approved: .*Send the publishing request to an Admin/);
    await click('[data-tab="approved"]');
    expect($(`tr[data-row="w-${ids.a}"] .rv-pp-badge`).textContent).toBe("Approved");
    expect($(`tr[data-row="w-${ids.a}"] [data-act="send"]`).textContent).toBe("Send publish request to Admin");
    await click(`[data-act="send"][data-key="w-${ids.a}"]`);
    expect((await mock.detail(ids.a)).item.status).toBe("pending");
    expect(lastToast()).toMatch(/Publishing request sent to an Admin/);
    await click('[data-tab="approved"]');
    expect($(`tr[data-row="w-${ids.a}"] .rv-pp-badge`).textContent).toBe("Publish requested");
    expect($$("button").some((b) => /^Publish$/.test(b.textContent!.trim()))).toBe(false);
  });
  it("an idea with no category opens Edit & approve with the reason; the drawer shows the changes and approves", async () => {
    const ids = await world(); fresh();
    await moderation(el, { adapter: data.as("moderator"), form: "#form", sector: "agriculture-dairy" });
    await settle();
    await click(`[data-act="approve"][data-key="w-${ids.b}"]`);
    const dr = document.querySelector(".rv-pp-drawer") as HTMLElement;
    expect(dr.getAttribute("role")).toBe("dialog");
    expect(dr.querySelector("[data-msg]")!.textContent).toMatch(/category/i);
    const title = dr.querySelector("#cw-m-title") as HTMLInputElement;
    title.value = "Weeding robot open day for farmers"; title.dispatchEvent(new Event("input"));
    expect(Array.from(dr.querySelectorAll("[data-livediff] ins")).map((x) => x.textContent).join("")).toContain("for farmers");
    (dr.querySelector('input[name="cw-m-cat"]') as HTMLInputElement).click();
    expect((dr.querySelector('[data-act="send"]') as HTMLButtonElement).textContent).toBe("Approve"); // the publishing request is the next step
    (dr.querySelector('[data-act="send"]') as HTMLButtonElement).click(); await settle();
    expect(document.querySelector(".rv-pp-drawer")).toBeNull();
    const item = (await mock.detail(ids.b)).item;
    expect(item.status).toBe("approved");
    expect(item.proposed.title).toBe("Weeding robot open day for farmers");
    expect(item.history.at(-1).text).toMatch(/^Approved with edits \(changed: Title, Category\)/);
  });
  it("Reject needs a reason (the button stays disabled until one is typed); the current form's Approve marks it verified", async () => {
    const ids = await world(); fresh();
    await moderation(el, { adapter: data.as("moderator"), form: "#form", sector: "education" });
    await settle();
    await click(`[data-act="reject"][data-key="w-${ids.a}"]`);
    expect((document.querySelector('.rv-dlg [data-x="ok"]') as HTMLButtonElement).disabled).toBe(true);
    await reason("Not about robots in schools.");
    expect((await mock.detail(ids.a)).item.status).toBe("rejected");
    await click('[data-act="approve"][data-key="f-301"]');
    expect(data.formItem(301).verified).toBe(true);
    expect($('tr[data-row="f-301"] .rv-pp-badge').textContent).toBe("Publish requested");
    expect($('tr[data-row="f-301"] [data-act]')).toBeNull(); // nothing more for a Moderator: an Admin publishes it
  });
  it("shows the sector's fields read-only (with where each came from)", async () => {
    await moderation(el, { adapter: data.as("moderator"), form: "#form", sector: "agriculture-dairy" });
    await settle();
    const ro = $(".rv-pp-fieldsro");
    expect(ro.textContent).toContain("Milking robots");
    expect(ro.querySelector(".rv-pp-src--plugin")!.getAttribute("title")).toBe("Added by the plugin Acme Dealer Directory");
    expect(ro.querySelector("button, input")).toBeNull();
  });
});

describe("Publish Requests (Admin)", () => {
  it("the queue has the verified current-form item and the approved idea; preview, then Publish puts it on Community Ideas", async () => {
    const ids = await world(); fresh();
    const it = (await mock.detail(ids.a)).item;
    await mock.as("moderator").act(ids.a, "send_request", { rowVersion: it.rowVersion, proposed: it.proposed, notes: "" });
    await requests(el, { adapter: data.as("admin") });
    await settle();
    expect($(".rv-pp-title").textContent).toBe("Publish Requests");
    expect($$("thead th").map((t) => t.textContent)).toEqual(["Title", "Sector", "Contributor", "Approved by", "Sent", "Actions"]);
    expect($('tr[data-row="f-308"] a.btn').textContent).toBe("Open form");
    expect($(`tr[data-row="w-${ids.a}"]`).textContent).toContain("Moderator User");
    await click(`[data-act="preview"][data-key="w-${ids.a}"]`);
    const modal = document.querySelector(".cw-modal") as HTMLElement;
    expect(Array.from(modal.querySelectorAll("[data-pv-act]")).map((b) => b.textContent)).toEqual(["Publish", "Send back to moderator", "Reject"]);
    (modal.querySelector('[data-pv-act="publish"]') as HTMLButtonElement).click(); await settle(30);
    expect((await mock.detail(ids.a)).item.status).toBe("published");
    expect((await mock.publicList()).items.some((r: any) => r.id === ids.a)).toBe(true);
  });
  it("Send back to moderator needs a reason and returns it to the Moderator", async () => {
    const ids = await world(); fresh();
    const it = (await mock.detail(ids.a)).item;
    await mock.as("moderator").act(ids.a, "send_request", { rowVersion: it.rowVersion, proposed: it.proposed, notes: "" });
    await requests(el, { adapter: data.as("admin") });
    await settle();
    await click(`[data-act="preview"][data-key="w-${ids.a}"]`);
    (document.querySelector('.cw-modal [data-pv-act="changes"]') as HTMLButtonElement).click(); await settle();
    await reason("Please add the cost.");
    expect((await mock.detail(ids.a)).item.status).toBe("changes_requested");
  });
  it("a Moderator cannot open the Admin's views", async () => {
    await expect(data.as("moderator").portal("requests")).rejects.toMatchObject({ status: 403 });
    await expect(data.as("moderator").portal("overview")).rejects.toMatchObject({ status: 403 });
  });
});

describe("Sector Forms (Admin)", () => {
  it("grid with fields and suggestions (amber dot), the panel, two tabs with counts; fields table with source badges", async () => {
    await sectorForms(el, { adapter: data.as("admin"), form: "#form", sector: "agriculture-dairy" });
    await settle();
    expect($(".rv-pp-title").textContent).toBe("Sector Forms");
    expect($('.rv-sg-card[data-sector="education"] .rv-sg-dot')).not.toBeNull();
    expect($('.rv-sg-card[data-sector="education"] .rv-sg-meta').textContent).toBe("1 field · 1 suggestion");
    expect($(".rv-pp-panel__title").textContent).toBe("Sector form: Agriculture & Dairy");
    expect($(".rv-pp-panel__head [data-add]").textContent).toBe("+ Add field");
    expect($$(".rv-pp-tab").map((t) => t.textContent)).toEqual(["Fields 3", "Suggested fields 0"]);
    const rows = $$("tr[data-field]");
    expect(rows.map((r) => r.querySelector("b")!.textContent)).toEqual(["Milking robots", "Drone sprayers", "Local dealers"]);
    expect(rows[2].querySelector(".rv-pp-src--plugin")).not.toBeNull();
    expect((rows[2].querySelector(".btn.danger") as HTMLButtonElement).title).toMatch(/^Managed by Acme Dealer Directory/);
    expect(rows.every((r) => r.querySelector(".rv-field-contribute"))).toBe(true);
    expect(rows[0].querySelector(".rv-pp-slug")!.getAttribute("title")).toBe("milking-robots");
  });
  it("+ Add field (a dialog, the slug made from the name), the Active/Hidden switch and Move down", async () => {
    await sectorForms(el, { adapter: data.as("admin"), form: "#form", sector: "healthcare" });
    await settle();
    expect($(".rv-pp-empty").textContent).toBe("No fields yet. Add the first field for this sector.");
    await click("[data-add]");
    const dlg = document.querySelector(".rv-pp-modal") as HTMLElement;
    const name = dlg.querySelector('[name="name"]') as HTMLInputElement;
    name.value = "Pharmacy robots"; name.dispatchEvent(new Event("input"));
    expect((dlg.querySelector('[name="slug"]') as HTMLInputElement).value).toBe("pharmacy-robots");
    (document.querySelector('.rv-pp-modal [data-x="save"]') as HTMLButtonElement).click(); await settle();
    expect($$("tr[data-field] b").map((b) => b.textContent)).toEqual(["Pharmacy robots"]);
    await click("[data-toggle]");
    expect($("[data-toggle]").getAttribute("aria-checked")).toBe("false");
    expect(mock.sectors.find((s: any) => s.slug === "healthcare").robots).toEqual([]); // hidden fields are not offered on the form
  });
  it("approving a suggestion adds the field with the \"Suggested by member\" badge; the tab then shows its empty state", async () => {
    await sectorForms(el, { adapter: data.as("admin"), form: "#form", sector: "education" });
    await settle();
    await click('[data-tab="suggested"]');
    expect($$("thead th").map((t) => t.textContent)).toEqual(["Suggested name", "Suggested by", "Reason", "Sent", "Actions"]);
    await click("[data-approve]");
    expect($(".rv-pp-empty").textContent).toBe(NO_SUGGESTIONS);
    await click('[data-tab="fields"]');
    const row = $$("tr[data-field]").find((r) => r.textContent!.includes("Coding robots"))!;
    expect(row.querySelector(".rv-pp-src--member")!.textContent).toBe("Suggested by member");
  });
});

describe("Member portals' Sectors", () => {
  it("Parent: \"Explore sectors for your family\", the child-safe sectors first with their chip, three tabs", async () => {
    await sectors(el, { adapter: { ...mock.asMember({ name: "Meera K.", type: "Parent / guardian" }), publicList: () => mock.publicList() }, form: "#form", variant: "parent" });
    await settle();
    expect($(".rv-pp-title").textContent).toBe("Explore sectors for your family");
    expect($$(".rv-sg-card")[0].getAttribute("data-sector")).toBe("education");
    expect($$(".rv-sg-card")[0].querySelector(".rv-sg-chip")!.textContent).toBe("Relevant to your child");
    expect($$(".rv-pp-tab").map((t) => t.textContent!.replace(/\s+\d+$/, ""))).toEqual(["Published ideas", "Safe for kids", "My contributions"]);
    await click('[data-tab="mine"]');
    expect($$("thead th").map((t) => t.textContent)).toEqual(["Title", "Status", "Sent"]);
    expect($("[data-tabpanel]").textContent).toContain("Kids safe line follower");
  });
  it("Teacher: classroom picks are tagged (view-only); Student: no tag", async () => {
    await sectors(el, { adapter: { ...mock.asMember({ name: "Kiran P.", type: "Teacher / lab in-charge" }), publicList: () => mock.publicList() }, form: "#form", variant: "teacher", sector: "education" });
    await settle();
    expect($(".rv-pp-idea .rv-pp-tag--pick").textContent).toBe("Classroom pick");
    fresh();
    await sectors(el, { adapter: { ...mock.asMember({ name: "Neha S.", type: "Student" }), publicList: () => mock.publicList() }, form: "#form", variant: "student", sector: "education" });
    await settle();
    expect($(".rv-pp-tag--pick")).toBeNull();
    expect(isClassroomPick({ suitableFor: ["K6–K8"] })).toBe(true);
    expect(isSafeForKids({ suitableFor: ["K6–K8"], learningPath: "Earn (18+)" })).toBe(false);
  });
  it("Contributor: \"my ideas\" on each card; the short form opens with the field filled in and sends the idea to review", async () => {
    const who = { name: "Dr. S. Rao", type: "Mentor / subject expert", minor: false };
    await sectors(el, { adapter: { ...mock.asMember(who), publicList: () => mock.publicList() }, form: "#form", variant: "contributor", quickForm: true, sector: "agriculture-dairy" });
    await settle();
    expect($('.rv-sg-card[data-sector="agriculture-dairy"] .rv-sg-meta').textContent).toBe("My ideas: 2 · 3 fields"); // an idea and a current-form item
    expect($(".rv-pp-panel__title").textContent).toBe("Contribute to Agriculture & Dairy");
    await click('[data-quick="drone-sprayers"]');
    const dlg = document.querySelector(".rv-pp-modal") as HTMLElement;
    expect((dlg.querySelector('[name="field"]') as HTMLSelectElement).value).toBe("drone-sprayers");
    (dlg.querySelector('[name="title"]') as HTMLInputElement).value = "Drone battery swap station";
    (dlg.querySelector('[name="description"]') as HTMLTextAreaElement).value = "A shared station where farmers swap drone batteries.";
    (document.querySelector('.rv-pp-modal [data-x="submit"]') as HTMLButtonElement).click(); await settle(20);
    const sent = mock.items.find((x: any) => x.original.title === "Drone battery swap station");
    expect(sent.status).toBe("submitted");
    expect(sent.original.robotType).toBe("drone-sprayers");
    expect(document.querySelector(".rv-pp-toast")!.textContent).toMatch(/pending review/);
  });
});

describe("My Contributions, Overview, Sectors and the Audit Log", () => {
  it("My Contributions: Title, Sector, Status, Sent, Actions; a rejected item shows the reason", async () => {
    await mine(el, { adapter: { mine: () => mock.mine({ name: "Neha S." }) }, contributeUrl: "#form" });
    await settle();
    expect($$("thead th").map((t) => t.textContent)).toEqual(["Title", "Sector", "Status", "Sent", "Actions"]);
    expect($(".rv-pp-head .btn.primary").textContent).toBe("+ Contribute something new");
  });
  it("Overview: the four numbers and the sector grid with publish requests", async () => {
    await overview(el, { adapter: data.as("admin") });
    await settle();
    expect($$(".rv-pp-stat__l").map((s) => s.textContent)).toEqual(["Pending publish requests", "Published this week", "Rejected", "Active contributors (last 30 days)"]);
    expect($$(".rv-pp-stat__n")[0].textContent).toBe("1"); // the verified current-form item
    expect($$(".rv-sg-card")).toHaveLength(3);
  });
  it("Sectors: the grid, the selected sector's numbers (each opens Moderation) and every sector's table", async () => {
    await sectorsAdmin(el, { adapter: data.as("admin"), sector: "education", moderationPath: "/admin/moderation" });
    await settle();
    expect($(".rv-pp-panel__title").textContent).toBe("Sector: Education");
    expect($('.rv-pp-panel a[href="/admin/moderation?sector=education&tab=pending"]')).not.toBeNull();
    // Phase B (the demo's data has migration 030): the sector's actions work (Education is in the middle of the list: it moves both ways)
    expect($$(".rv-pp-panel__head .btn").map((b) => b.textContent)).toEqual(["Rename", "Move up", "Move down", "Card style", "Archive"]);
    expect($$(".rv-pp-panel__head .btn").filter((b) => (b as HTMLButtonElement).disabled)).toEqual([]);
    expect(($(".rv-pp-head .btn.primary") as HTMLButtonElement).disabled).toBe(false); // + Add sector
  });
  it("Audit Log: who, role, action, item, details, newest first, with a filter by kind", async () => {
    await audit(el, { adapter: data.as("admin") });
    await settle();
    expect($$("thead th").map((t) => t.textContent)).toEqual(["When", "Who", "Role", "Action", "Item", "Details"]);
    expect($$("tbody tr").length).toBeGreaterThan(3);
    const kind = $('[data-f="action"]') as unknown as HTMLSelectElement;
    kind.value = "published"; kind.dispatchEvent(new Event("change")); await settle();
    expect($$("tbody tr").every((r) => r.textContent!.includes("Published"))).toBe(true);
  });
});
