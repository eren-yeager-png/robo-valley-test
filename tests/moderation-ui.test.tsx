// The Admin Portal pages (portal PR2, server-rendered): Contributions by Sector, one sector's list, one contribution with the Review
// panel, and the layout. Rendered to static markup on the in-process database with the real migrations; no real database.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedUser, testDb } from "./helpers";

vi.mock("../src/lib/db", async () => { const c = await import("./helpers/currentPool"); return { get pool() { return c.getPool(); } }; });
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }), redirect: (to: string) => { throw new Error("REDIRECT:" + to); }, usePathname: () => "/moderation" }));
vi.mock("next/font/google", () => ({ Bricolage_Grotesque: () => ({ variable: "f1" }), Mulish: () => ({ variable: "f2" }) }));
const state: { viewer: number | null; guard: "ok" | "redirect"; isAdmin: boolean } = { viewer: null, guard: "ok", isAdmin: true };
vi.mock("../src/lib/reviewerPage", () => ({ requireReviewerPage: async () => { if (state.guard === "redirect") throw new Error("REDIRECT:/dashboard"); return { userId: state.viewer, email: "r@example.com", isAdmin: state.isAdmin }; } }));

import Overview from "../src/app/moderation/page";
import SectorPage from "../src/app/moderation/sector/[slug]/page";
import Detail from "../src/app/moderation/[id]/page";
import Layout from "../src/app/moderation/layout";
import fs from "node:fs";
import path from "node:path";

const q = (sql: string, p: unknown[] = []) => testDb().raw.query(sql, p as never);
let seq = 0;
const overview = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await Overview({ searchParams: Promise.resolve(sp) }));
const sector = async (slug: string, sp: Record<string, string> = {}) => renderToStaticMarkup(await SectorPage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(sp) }));
const detail = async (id: number | string, sp: Record<string, string> = {}) => renderToStaticMarkup(await Detail({ params: Promise.resolve({ id: String(id) }), searchParams: Promise.resolve(sp) }));
async function person(role: string, fullName: string, moderator = false) {
  const id = Number((await seedUser({ email: `p${++seq}@example.com`, role, fullName })).id);
  if (moderator) await q("UPDATE users SET is_moderator=true WHERE id=$1", [id]);
  return id;
}
async function make(userId: number, status: string, title: string, sectors = ["agriculture-dairy"], body = "A long enough description.\n\n## Role\nFarmer") {
  const id = Number(((await q("INSERT INTO contributions (user_id, type, title, body) VALUES ($1,'problem',$2,$3) RETURNING id", [userId, title, body])).rows[0] as any).id);
  for (const s of sectors) await q("INSERT INTO contribution_scopes (contribution_id, sector_id) SELECT $1, id FROM sectors WHERE slug=$2", [id, s]);
  if (status !== "draft") await q("UPDATE contributions SET status=$2::varchar, submitted_at=now() - (interval '1 minute' * $3), published_at=CASE WHEN $2::varchar='published' THEN now() END WHERE id=$1", [id, status, 1000 - (++seq)]);
  return id;
}
beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined); state.guard = "ok"; state.isAdmin = true;
  await q("INSERT INTO sectors (slug, name, sort_order) VALUES ('education', 'Education', 20), ('healthcare', 'Healthcare', 30) ON CONFLICT (slug) DO NOTHING");
});
afterEach(() => { vi.restoreAllMocks(); testDb().failOn(undefined); });

describe("page 1: Contributions by Sector", () => {
  it("shows the four tiles and one card per sector, including sectors with nothing; an item in two sectors counts under both", async () => {
    state.viewer = await person("admin", "Ola Admin");
    const a = await person("ST", "Asha Kumari Rao"), b = await person("TC", "Farid Mehta");
    await make(a, "pending_review", "Solar milking robot");
    await make(b, "pending_review", "Drone spraying workshop", ["agriculture-dairy", "education"]);
    await make(a, "published", "Weed-picking rover club");
    await make(b, "rejected", "Cheap drone kits");
    await make(a, "draft", "A private draft");
    const h = await overview();
    expect(h).toContain("Contributions by Sector");
    expect(h).toMatch(/<b>4<\/b><span>All contributions<\/span>/);
    expect(h).toMatch(/<b>2<\/b><span>Pending review<\/span>/);
    expect(h).toMatch(/<b>1<\/b><span>Published<\/span>/);
    expect(h).toMatch(/<b>1<\/b><span>Not accepted<\/span>/);
    expect(h).toContain("Contributors for Agriculture &amp; Dairy →");
    expect(h).toContain('href="/moderation/sector/agriculture-dairy"');
    expect(h).toContain("4 contributions · 2 contributors");
    expect(h).toContain("Contributors for Education →"); expect(h).toContain("1 contribution · 1 contributor");
    expect(h).toContain("Contributors for Healthcare →"); expect(h).toContain("0 contributions · 0 contributors");
    expect(h).not.toContain("A private draft");
    expect(h).not.toMatch(/@example\.com|Kumari|Rao/);
  });
  it("finds a sector by name and sorts by name; an unknown sort falls back; nothing found says so", async () => {
    state.viewer = await person("admin", "Ola Admin");
    const h = await overview({ q: "health", sort: "name" });
    expect(h).toContain("Contributors for Healthcare"); expect(h).not.toContain("Contributors for Education");
    expect(await overview({ q: "zzz", sort: "bogus" })).toContain("No sector matches “zzz”.");
  });
  it("an older link /moderation?item=12 opens the new detail page", async () => {
    state.viewer = 1;
    await expect(overview({ item: "12" })).rejects.toThrow("REDIRECT:/moderation/12");
  });
  it("shows a plain message when the tables are missing, never details", async () => {
    state.viewer = 1;
    testDb().failOn((sql) => (/FROM contributions c WHERE c\.status NOT IN/.test(sql) ? Object.assign(new Error("x"), { code: "42P01" }) : undefined));
    expect(await overview()).toContain("Reviewing is not set up on this database yet");
    testDb().failOn((sql) => (/FROM contributions c WHERE c\.status NOT IN/.test(sql) ? new Error("password=hunter2") : undefined));
    const h = await overview(); expect(h).toContain("could not be loaded"); expect(h).not.toContain("hunter2");
  });
});

describe("page 2: one sector's list", () => {
  it("tabs with counts (role=tab, aria-selected), the table with contributor, Also in, categories and status, and a View form link", async () => {
    state.viewer = await person("TC", "Ravi Mod", true); state.isAdmin = false;
    const a = await person("TC", "Asha Kumari Rao"), b = await person("ST", "Farid Mehta");
    const x = await make(a, "pending_review", "Solar milking robot");
    await q("INSERT INTO contribution_categories (contribution_id, category, position) VALUES ($1,'Projects',1),($1,'Labs & Makerspaces',2)", [x]);
    await make(b, "pending_review", "Drone spraying workshop", ["agriculture-dairy", "education"]);
    await make(a, "published", "Weed-picking rover club");
    const h = await sector("agriculture-dairy");
    expect(h).toContain("Contributors for Agriculture &amp; Dairy");
    expect(h).toContain("3 contributions from 2 contributors.");
    expect(h).toContain('role="tablist"');
    expect(h).toMatch(/role="tab" aria-selected="true"[^>]*>New \(2\)/);
    for (const t of ["In review (0)", "Replied (0)", "Changes requested (0)", "Published (1)", "Not accepted (0)", "Unpublished (0)", "All (3)"]) expect(h).toContain(t);
    expect(h).toContain("Solar milking robot"); expect(h).toContain("Drone spraying workshop"); expect(h).not.toContain("Weed-picking rover club"); // New tab only
    expect(h).toContain("Asha R."); expect(h).not.toContain("Kumari"); expect(h).toContain("Teacher / lab in-charge");
    expect(h).toContain("Also in: Education");
    expect(h).toContain(">Projects<"); expect(h).toContain(">Labs &amp; Makerspaces<");
    expect(h).toContain(`href="/moderation/${x}?from=agriculture-dairy&amp;tab=new"`);
    expect(h).toContain('href="/api/review/export?sector=agriculture-dairy&amp;tab=new&amp;sort=new"');
    expect(h).not.toMatch(/@example\.com/);
  });
  it("search by title or contributor, the category filter, sort, an empty tab and pages of 20", async () => {
    state.viewer = await person("admin", "Ola Admin");
    const a = await person("ST", "Asha Rao");
    for (let i = 1; i <= 23; i++) await make(a, "published", `Published item number ${String(i).padStart(2, "0")}`);
    const h1 = await sector("agriculture-dairy", { tab: "published" });
    expect(h1).toContain("Page 1 of 2 · 23 contributions"); expect(h1).toContain("Published item number 23"); expect(h1).not.toContain("Published item number 03");
    expect(h1).toContain('href="/moderation/sector/agriculture-dairy?tab=published&amp;page=2"');
    const h2 = await sector("agriculture-dairy", { tab: "published", page: "2" });
    expect(h2).toContain("Published item number 01"); expect(h2).toContain("Page 2 of 2");
    const old = await sector("agriculture-dairy", { tab: "published", sort: "old" });
    expect(old.indexOf("number 01")).toBeLessThan(old.indexOf("number 02"));
    expect(await sector("agriculture-dairy", { tab: "published", q: "number 07" })).toContain("Published item number 07");
    expect(await sector("agriculture-dairy", { tab: "published", q: "asha" })).toContain("23 contributions");
    expect(await sector("agriculture-dairy", { tab: "published", cat: "Events" })).toContain("Nothing here yet.");
    expect(await sector("agriculture-dairy", { tab: "rejected" })).toContain("Nothing here yet.");
  });
  it("verified=1 / verified=0 (the admin Sector Counts links) show only pending items a reviewer has / has not verified, in the list, the CSV link and Previous / Next", async () => {
    const admin = await person("admin", "Ola Admin"); state.viewer = admin;
    const a = await person("ST", "Asha Rao");
    const checked = await make(a, "pending_review", "Checked pending item"), unchecked = await make(a, "pending_review", "Unchecked pending item");
    await make(a, "published", "Published, also verified earlier");
    await q("INSERT INTO contribution_reviews (contribution_id, reviewer_id, action) VALUES ($1,$2,'verify')", [checked, admin]);
    const yes = await sector("agriculture-dairy", { tab: "all", verified: "1" });
    expect(yes).toContain("Checked pending item"); expect(yes).not.toContain("Unchecked pending item"); expect(yes).not.toContain("Published, also verified");
    expect(yes).toContain("Showing only pending contributions a reviewer has verified.");
    expect(yes).toContain('href="/moderation/sector/agriculture-dairy?tab=all"'); // "Show everything" drops the filter
    expect(yes).toContain("verified=1"); // kept by the CSV link and the View form links
    expect(yes).toContain('<input type="hidden" name="verified" value="1"/>'); // and by the search form
    const no = await sector("agriculture-dairy", { tab: "all", verified: "0" });
    expect(no).toContain("Unchecked pending item"); expect(no).not.toContain("Checked pending item");
    expect(no).toContain("that nobody has verified yet");
    expect(await sector("agriculture-dairy", { tab: "all", verified: "maybe" })).toContain("Published, also verified"); // anything else: no filter
    const d = await detail(checked, { from: "agriculture-dairy", tab: "all", verified: "1" });
    expect(d).toContain("1 of 1"); // Previous / Next stay inside the filtered list
    expect(d).toContain('href="/moderation/sector/agriculture-dairy?tab=all&amp;verified=1"'); // and so does the way back
  });
  it("an unknown or malformed sector says so", async () => {
    state.viewer = 1;
    expect(await sector("no-such-sector")).toContain("We could not find that sector.");
    expect(await sector("../etc")).toContain("We could not find that sector.");
  });
});

describe("page 3: one contribution with the Review panel", () => {
  it("shows the filled form in the member form's order: details, structured categories with links and remarks, sectors, photos, contact (only when allowed)", async () => {
    const mod = await person("TC", "Ravi Mod", true); state.viewer = mod; state.isAdmin = false;
    const author = await person("TC", "Asha Kumari Rao");
    const body = "A student team built a small solar milking unit.\n\nDirectory categories: Projects\n[Projects] Remarks: Tested for six weeks.\n[Projects] Link 1 (Website): https://example.org/milker - The build log";
    const a = await make(author, "pending_review", "Solar milking robot", ["agriculture-dairy", "education"], body);
    await q("INSERT INTO contribution_categories (contribution_id, category, remarks, position) VALUES ($1,'Projects','Tested for six weeks.',1)", [a]);
    await q("INSERT INTO contribution_category_links (contribution_id, category, position, link_type, url, gist) VALUES ($1,'Projects',1,'Website','https://example.org/milker','The build log')", [a]);
    await q("INSERT INTO contribution_contacts (contribution_id, contact_name, email, share_with_moderators) VALUES ($1,'Asha Shared','asha@example.com',true)", [a]);
    const h = await detail(a);
    expect(h).toContain("Solar milking robot"); expect(h).toContain("Submitted by <b>Asha R.</b>");
    expect(h).toContain("Teacher / lab in-charge");
    expect(h).toContain("A student team built a small solar milking unit."); expect(h).not.toContain("Directory categories: Projects"); // the folded copy is left out
    expect(h).toContain('href="https://example.org/milker" target="_blank" rel="noopener nofollow noreferrer"');
    expect(h).toContain("<b>Remarks:</b> Tested for six weeks.");
    expect(h).toContain(">Agriculture &amp; Dairy<"); expect(h).toContain(">Education<");
    expect(h).toContain("No photos uploaded.");
    expect(h).toContain("asha@example.com"); expect(h).toContain('href="mailto:asha@example.com"');
    expect(h.indexOf("Contribution details")).toBeLessThan(h.indexOf("Directory categories"));
    expect(h.indexOf("Directory categories")).toBeLessThan(h.indexOf(">Sectors<"));
    expect(h.indexOf(">Sectors<")).toBeLessThan(h.indexOf("Photos"));
    expect(h.indexOf("Photos")).toBeLessThan(h.indexOf("Contact details"));
  });
  it("an older item shows its description as it is; contact details not shared are never shown", async () => {
    const mod = await person("TC", "Ravi Mod", true); state.viewer = mod; state.isAdmin = false;
    const author = await person("ST", "Bela");
    const body = "Older words here.\n\nDirectory categories: Events\n[Events] Remarks: Next batch in December.";
    const b = await make(author, "pending_review", "Older item", ["agriculture-dairy"], body);
    await q("INSERT INTO contribution_contacts (contribution_id, contact_name, email, share_with_moderators) VALUES ($1,'Bela Private','bela@example.com',false)", [b]);
    const h = await detail(b);
    expect(h).toContain("Directory categories: Events"); expect(h).toContain("[Events] Remarks: Next batch in December.");
    expect(h).toContain("Sent before categories were stored separately");
    expect(h).not.toMatch(/Bela Private|bela@/); expect(h).toContain("No contact details are shown");
    expect(h).toContain("Submitted by <b>Bela</b>");
  });
  it("an administrator's Review panel: Approve &amp; Publish, Not accept, Request changes, Mark as verified, Remove, a reply box, an internal note box and the history", async () => {
    const admin = await person("admin", "Ola Admin"); state.viewer = admin;
    const mod = await person("TC", "Ravi Mod", true), author = await person("ST", "Asha Rao");
    const id = await make(author, "pending_review", "Checked by a moderator");
    await q("INSERT INTO contribution_reviews (contribution_id, reviewer_id, action) VALUES ($1,$2,'verify')", [id, mod]);
    await q("INSERT INTO contribution_replies (contribution_id, author_id, message) VALUES ($1,$2,'Could you add a photo?')", [id, mod]);
    await q("INSERT INTO contribution_notes (contribution_id, author_id, note) VALUES ($1,$2,'Looks genuine.')", [id, mod]);
    const h = await detail(id);
    for (const t of ["Approve &amp; Publish", "Not accept", "Request changes", "Mark as verified", "Remove (duplicate or unsuitable)", "Send reply", "Save note"]) expect(h).toContain(t);
    expect(h).toContain("Replied</span> · Verified");
    expect(h).toContain("Submitted by Asha R."); expect(h).toContain("Marked as verified by Ravi");
    expect(h).toContain("Replied to the contributor: Ravi"); expect(h).toContain("Could you add a photo?");
    expect(h).toContain("Internal note: Ravi"); expect(h).toContain("Looks genuine.");
    expect(h).not.toContain("Only an administrator can approve");
  });
  it("a moderator sees no Approve or Remove; the likely duplicate links to the new page", async () => {
    const mod = await person("TC", "Ravi Mod", true); state.viewer = mod; state.isAdmin = false;
    const author = await person("ST", "Asha Rao");
    const a = await make(author, "published", "Solar powered milking robot");
    const b = await make(author, "pending_review", "Solar-powered milking robots");
    const h = await detail(b);
    expect(h).toContain("Possible duplicate already live in the same sector");
    expect(h).toContain(`href="/moderation/${a}"`);
    expect(h).toContain("Only an administrator can approve, publish, unpublish or remove.");
    expect(h).not.toContain("Approve &amp; Publish"); expect(h).not.toContain("Remove (duplicate or unsuitable)"); expect(h).not.toContain("I checked the possible duplicate");
    for (const t of ["Mark as verified", "Request changes", "Not accept"]) expect(h).toContain(t);
  });
  it("status callouts: not accepted shows the reason; published says it counts; changes requested says it waits", async () => {
    const admin = await person("admin", "Ola Admin"); state.viewer = admin;
    const author = await person("ST", "Asha Rao");
    const r = await make(author, "rejected", "Rejected item here");
    await q("INSERT INTO contribution_reviews (contribution_id, reviewer_id, action, note) VALUES ($1,$2,'reject','This reads as an advert.')", [r, admin]);
    expect(await detail(r)).toContain("Not accepted. Reason shown to the contributor: “This reads as an advert.”");
    const p = await make(author, "published", "Published item here");
    const hp = await detail(p);
    expect(hp).toContain("Published. It counts in the public sector numbers."); expect(hp).toContain("Unpublish");
    const c = await make(author, "changes_requested", "Changes item here");
    await q("INSERT INTO contribution_reviews (contribution_id, reviewer_id, action, note) VALUES ($1,$2,'request_changes','Please add the district.')", [c, admin]);
    expect(await detail(c)).toContain("Changes requested. Waiting for the contributor. Note shown to them: “Please add the district.”");
  });
  it("Previous / Next walk the same sector list (kept stable after opening), with the position", async () => {
    const admin = await person("admin", "Ola Admin"); state.viewer = admin;
    const author = await person("ST", "Asha Rao");
    const first = await make(author, "pending_review", "First pending item");
    const second = await make(author, "pending_review", "Second pending item");
    const third = await make(author, "pending_review", "Third pending item");
    const h = await detail(second, { from: "agriculture-dairy", tab: "new" }); // opening it moves it to In review, but it stays in the New list it came from
    expect(h).toContain(`href="/moderation/${third}?from=agriculture-dairy&amp;tab=new"`); // newest first: the third was submitted last
    expect(h).toContain(`href="/moderation/${first}?from=agriculture-dairy&amp;tab=new"`);
    expect(h).toContain("2 of 3");
    expect(h).toContain('href="/moderation/sector/agriculture-dairy?tab=new"'); // the breadcrumb goes back to the same list
  });
  it("your own item has no decision, reply or note boxes; a missing, draft or malformed item says so", async () => {
    const admin = await person("admin", "Ola Admin"); state.viewer = admin;
    const own = await make(admin, "pending_review", "My own item title"), draft = await make(admin, "draft", "A private draft title");
    const h = await detail(own);
    expect(h).toContain("your own contribution"); expect(h).not.toContain("Approve &amp; Publish"); expect(h).not.toContain(">Send reply<");
    expect(await detail(draft)).toContain("We could not find that contribution.");
    expect(await detail("abc")).toContain("We could not find that contribution.");
  });
});

describe("the layout and the forms", () => {
  it("runs the reviewer guard first, says who is signed in, has no Sign Out, and no page uses raw HTML injection", async () => {
    state.guard = "redirect";
    await expect(Layout({ children: null })).rejects.toThrow(/REDIRECT:\/dashboard/);
    await expect(Overview({ searchParams: Promise.resolve({}) })).rejects.toThrow(/REDIRECT/);
    state.guard = "ok"; state.isAdmin = false;
    const h = renderToStaticMarkup(await Layout({ children: null }));
    expect(h).toContain("RoboValley · Admin Portal"); expect(h).toContain("Signed in as a moderator"); expect(h).not.toContain('href="/admin/dashboard"');
    expect(h).not.toMatch(/Sign Out|sign-out|logout/i);
    for (const f of ["page.tsx", "DecisionForm.tsx", "ReplyNoteForm.tsx", "layout.tsx", "sector/[slug]/page.tsx", "[id]/page.tsx"]) expect(fs.readFileSync(path.join(__dirname, "../src/app/moderation", f), "utf8"), f).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
  });
  it("a link styled as a primary button keeps white text (the sector cards' buttons): its rule beats \".mod a\"", () => {
    const css = fs.readFileSync(path.join(__dirname, "../src/app/moderation/moderation.css"), "utf8");
    expect(css).toContain(".mod a{color:var(--mod-brand)}");
    expect(css).toContain(".mod .mod-btn--primary{color:#fff;");
    expect(css).not.toMatch(/(^|\n|\})\.mod-btn--primary\{/); // never the weaker selector alone
  });
  it("the decision form explains the note (5 characters to not accept) and has a plain alert; no actions means a plain message", async () => {
    const { default: DecisionForm } = await import("../src/app/moderation/DecisionForm");
    const h = renderToStaticMarkup(<DecisionForm id={7} actions={["approve", "request_changes", "reject"]} isAdmin />);
    expect(h).toContain("the reason for not accepting (at least 5 characters)"); expect(h).toContain("The contributor sees this under My Contributions.");
    expect(h).toContain('role="alert"'); expect(h).toContain(">Approve &amp; Publish<"); expect(h).toContain(">Not accept<");
    expect(renderToStaticMarkup(<DecisionForm id={7} actions={[]} />)).toContain("No decision can be made");
  });
});
