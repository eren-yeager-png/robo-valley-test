// The moderation page (server-rendered): the queue, an item, contact details, own items, empty and failure states, and that the
// access guard runs. Rendered to static markup on the in-process database.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }), redirect: (to: string) => { throw new Error("REDIRECT:" + to); }, usePathname: () => "/moderation" }));
vi.mock("next/font/google", () => ({ Bricolage_Grotesque: () => ({ variable: "f1" }), Mulish: () => ({ variable: "f2" }) }));
const state: { viewer: number | null; guard: "ok" | "redirect"; isAdmin: boolean } = { viewer: null, guard: "ok", isAdmin: true };
vi.mock("../src/lib/reviewerPage", () => ({ requireReviewerPage: async () => { if (state.guard === "redirect") throw new Error("REDIRECT:/dashboard"); return { userId: state.viewer, email: "r@example.com", isAdmin: state.isAdmin }; } }));

import Page from "../src/app/moderation/page";
import Layout from "../src/app/moderation/layout";
import fs from "node:fs";
import path from "node:path";

const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
let seq = 0;
const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(sp) }));
async function make(userId: number, status: string, title: string, body = "A long enough description.\n\n## Role\nFarmer") {
  const id = Number(((await q("INSERT INTO contributions (user_id, type, title, body) VALUES ($1,'problem',$2,$3) RETURNING id", [userId, title, body])).rows[0] as any).id);
  await q("INSERT INTO contribution_scopes (contribution_id, sector_id) SELECT $1, id FROM sectors WHERE slug='agriculture-dairy'", [id]);
  if (status !== "draft") await q("UPDATE contributions SET status=$2::varchar, submitted_at=now(), published_at=CASE WHEN $2::varchar='published' THEN now() END WHERE id=$1", [id, status]);
  return id;
}
beforeEach(async () => { vi.spyOn(console, "error").mockImplementation(() => undefined); state.guard = "ok"; state.isAdmin = true; });
afterEach(() => { vi.restoreAllMocks(); testDb().failOn(undefined); });

describe("moderation page", () => {
  it("shows the tabs, the queue and an empty message", async () => {
    const reviewer = Number((await seedUser({ email: `rv${++seq}@example.com`, role: "admin", fullName: "Rev" })).id); state.viewer = reviewer;
    const author = Number((await seedUser({ email: `au${++seq}@example.com`, role: "ST", fullName: "Author" })).id);
    expect(await render()).toContain("Nothing here right now.");
    await make(author, "pending_review", "A pending title here");
    const h = await render();
    expect(h).toContain("A pending title here"); expect(h).toContain('aria-current="page"'); expect(h).toContain("Pending review");
    for (const t of ["Changes requested", "Published", "Taken down", "Not accepted"]) expect(h).toContain(t);
    expect(h).not.toMatch(/@example\.com/);
  });
  it("shows an item with its text, decision buttons and a note box; contact only when allowed", async () => {
    const reviewer = Number((await seedUser({ email: `rv${++seq}@example.com`, role: "TC", fullName: "Mod" })).id); await q("UPDATE users SET is_moderator=true WHERE id=$1", [reviewer]); state.viewer = reviewer;
    const author = Number((await seedUser({ email: `au${++seq}@example.com`, role: "ST", fullName: "Author" })).id);
    const a = await make(author, "pending_review", "Shared contact item"), b = await make(author, "pending_review", "Private contact item");
    await q("INSERT INTO contribution_contacts (contribution_id, contact_name, email, share_with_moderators) VALUES ($1,'Asha Shared','asha@example.com',true),($2,'Bela Private','bela@example.com',false)", [a, b]);
    const ha = await render({ item: String(a) });
    expect(ha).toContain("A long enough description."); expect(ha).toContain("Farmer"); expect(ha).toContain("asha@example.com");
    for (const w of ["Approve and publish", "Request changes", "Reject"]) expect(ha).toContain(w);
    expect(ha).toContain("Note for the author");
    const hb = await render({ item: String(b) });
    expect(hb).not.toMatch(/Bela|bela@/); expect(hb).toContain("No contact details are available to you");
  });
  it("your own item has no decision buttons; a missing or draft item says so; bad ids are ignored", async () => {
    const reviewer = Number((await seedUser({ email: `rv${++seq}@example.com`, role: "admin", fullName: "Rev" })).id); state.viewer = reviewer;
    const own = await make(reviewer, "pending_review", "My own item title"), draft = await make(reviewer, "draft", "A private draft title");
    const h = await render({ item: String(own) });
    expect(h).toContain("your own contribution"); expect(h).not.toContain("Approve and publish");
    expect(await render({ item: String(draft) })).toContain("We could not find that contribution.");
    expect(await render({ item: "abc", status: "bogus" })).toContain("Choose a contribution on the left");
  });
  it("shows a plain message when the tables are missing, never details", async () => {
    state.viewer = 1;
    testDb().failOn((sql) => (/FROM contributions c WHERE c\.status/.test(sql) ? Object.assign(new Error("x"), { code: "42P01" }) : undefined));
    expect(await render()).toContain("Reviewing is not set up on this database yet");
    testDb().failOn((sql) => (/FROM contributions c WHERE c\.status/.test(sql) ? new Error("password=hunter2") : undefined));
    const h = await render(); expect(h).toContain("could not be loaded"); expect(h).not.toContain("hunter2");
  });
  it("the layout runs the reviewer guard first (anonymous or ordinary users are redirected), and the page has no raw HTML injection", async () => {
    state.guard = "redirect";
    await expect(Layout({ children: null })).rejects.toThrow(/REDIRECT:\/dashboard/);
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(/REDIRECT/);
    for (const f of ["page.tsx", "DecisionForm.tsx", "layout.tsx"]) expect(fs.readFileSync(path.join(__dirname, "../src/app/moderation", f), "utf8")).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
  });
  it("the decision form needs a note for the three decisions the author reads about, with a plain message", async () => {
    const { default: DecisionForm } = await import("../src/app/moderation/DecisionForm");
    const h = renderToStaticMarkup(<DecisionForm id={7} actions={["approve", "request_changes", "reject"]} />);
    expect(h).toContain("required to request changes, reject, unpublish or remove"); expect(h).toContain('role="alert"');
    expect(renderToStaticMarkup(<DecisionForm id={7} actions={[]} />)).toContain("No decision can be made");
  });
});

describe("duplicates and admin-only decisions on the page (PR C)", () => {
  async function people() {
    const admin = Number((await seedUser({ email: `ad${++seq}@example.com`, role: "admin", fullName: "Admin" })).id);
    const mod = Number((await seedUser({ email: `md${++seq}@example.com`, role: "TC", fullName: "Mod" })).id); await q("UPDATE users SET is_moderator=true WHERE id=$1", [mod]);
    const author = Number((await seedUser({ email: `au${++seq}@example.com`, role: "ST", fullName: "Author" })).id);
    return { admin, mod, author };
  }
  it("an administrator sees the likely duplicate with a link, the confirm box, Remove and Mark as verified", async () => {
    const { admin, author } = await people(); state.viewer = admin; state.isAdmin = true;
    const a = await make(author, "published", "Solar powered milking robot");
    const b = await make(author, "pending_review", "Solar-powered milking robots");
    const h = await render({ item: String(b) });
    expect(h).toContain("Possible duplicate already live in the same sector");
    expect(h).toContain(`href="/moderation?status=published&amp;item=${a}"`);
    expect(h).toMatch(/\d+% similar/);
    expect(h).toContain("I checked the possible duplicate");
    for (const t of ["Approve and publish", "Remove (duplicate or unsuitable)", "Mark as verified", "Request changes", "Reject"]) expect(h).toContain(t);
    expect(h).not.toContain("Only an administrator can approve");
  });
  it("a moderator sees no Approve or Remove, a plain note that only an administrator can, and no confirm box", async () => {
    const { mod, author } = await people(); state.viewer = mod; state.isAdmin = false;
    await make(author, "published", "Solar powered milking robot");
    const b = await make(author, "pending_review", "Solar-powered milking robots");
    const h = await render({ item: String(b) });
    expect(h).toContain("Possible duplicate already live in the same sector");
    expect(h).toContain("Only an administrator can approve, publish, unpublish or remove.");
    expect(h).not.toContain("Approve and publish"); expect(h).not.toContain("Remove (duplicate or unsuitable)"); expect(h).not.toContain("I checked the possible duplicate");
    for (const t of ["Mark as verified", "Request changes", "Reject"]) expect(h).toContain(t);
  });
  it("a verified item says so, and the history names the decision", async () => {
    const { admin, mod, author } = await people(); state.viewer = admin; state.isAdmin = true;
    const id = await make(author, "pending_review", "Checked by a moderator");
    await q("INSERT INTO contribution_reviews (contribution_id, reviewer_id, action) VALUES ($1,$2,'verify')", [id, mod]);
    const h = await render({ item: String(id) });
    expect(h).toContain("In review · Verified"); // opening it as a reviewer marks it In review (portal PR1)
    expect(h).toContain("<strong>Verified</strong>");
    expect(h).not.toContain("Possible duplicate");
  });
});

describe("replies, internal notes and the display status on the page (portal PR1)", () => {
  it("the queue labels a pending item New, opening it makes it In review, and the item shows replies, notes and both boxes", async () => {
    const reviewer = Number((await seedUser({ email: `rv${++seq}@example.com`, role: "admin", fullName: "Ola Admin" })).id); state.viewer = reviewer;
    const author = Number((await seedUser({ email: `au${++seq}@example.com`, role: "ST", fullName: "Author" })).id);
    const id = await make(author, "pending_review", "Portal item for the page");
    expect(await render()).toContain("New · ");
    await q("INSERT INTO contribution_replies (contribution_id, author_id, message) VALUES ($1,$2,'Thanks, please add a photo.')", [id, reviewer]);
    await q("INSERT INTO contribution_notes (contribution_id, author_id, note) VALUES ($1,$2,'Checked: the club is real.')", [id, reviewer]);
    const h = await render({ item: String(id) });
    expect(h).toContain("Replied · "); // a reply in this round beats In review
    expect(h).toContain("Replies to the contributor");
    expect(h).toContain("Thanks, please add a photo.");
    expect(h).toContain("Internal notes (moderators only)");
    expect(h).toContain("Checked: the club is real.");
    expect(h).toContain("Ola"); expect(h).not.toContain("Ola Admin"); // first name only
    expect(h).toContain("Reply to the contributor (they read it under My Contributions)");
    expect(h).toContain("Internal note (moderators only, never shown to the contributor)");
    expect(h).toContain(">Send reply</button>"); expect(h).toContain(">Save note</button>");
    expect(Number(((await q("SELECT count(*)::int n FROM contribution_views WHERE contribution_id=$1 AND viewer_id=$2", [id, reviewer])).rows[0] as any).n)).toBe(1);
  });
  it("on your own item there are no reply or note boxes", async () => {
    const reviewer = Number((await seedUser({ email: `rv${++seq}@example.com`, role: "admin", fullName: "Rev" })).id); state.viewer = reviewer;
    const id = await make(reviewer, "pending_review", "My own portal item");
    const h = await render({ item: String(id) });
    expect(h).toContain("This is your own contribution");
    expect(h).not.toContain(">Send reply</button>"); expect(h).not.toContain(">Save note</button>");
  });
});
