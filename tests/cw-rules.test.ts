// Contribution workflow: the shared rules (public/cw/js/rules.js, lists.js, utils.js, card.js) used by the server, the WordPress form,
// the portal and the demo. Unit tests: slug and resource ID, every validation message, the whole status machine, history wording,
// the word diff, the public card's privacy rules and escaping, and the file-type check.
import { describe, expect, it } from "vitest";
import * as R from "../public/cw/js/rules.js";
import * as L from "../public/cw/js/lists.js";
import { esc, wordDiff } from "../public/cw/js/utils.js";
import { renderPreviewDocument, renderPublicCard } from "../public/cw/js/card.js";

const SECTORS = [{ slug: "agriculture-dairy", name: "Agriculture & Dairy", robots: [{ slug: "weeding-robots", name: "Weeding robots" }] }, { slug: "healthcare", name: "Healthcare", robots: [] }];
const ok = (over: Record<string, unknown> = {}) => ({ kind: "New idea", refers: false, title: "Beach robot", description: "Picks up plastic.", sector: "not-sure", robotType: "not-sure", categories: ["Robotics"], suitableFor: [], learningPath: "", references: [], resource: {}, ...over });
const errorsOf = (input: unknown, name = "Ananya R.") => R.validateSubmission(input, { sectors: SECTORS, name }).errors;

describe("slug and resource ID (acceptance 2)", () => {
  it("lower case, & becomes and, other runs become -, no - at the ends", () => {
    expect(R.slug("Agriculture & Dairy")).toBe("agriculture-and-dairy");
    expect(R.slug("  --Weeding robots!!  ")).toBe("weeding-robots");
    expect(R.slug("K1–K5 (pilot)")).toBe("k1-k5-pilot");
  });
  it("uses the resource type's code and the last part of the path; an empty path gives an empty ID", () => {
    expect(R.resourceId("Robot type", "Robots by Sector › Agriculture & Dairy › Weeding robots")).toBe("rv_robot_type · weeding-robots");
    expect(R.resourceId("Sector page", "Robots by Sector › Agriculture & Dairy")).toBe("rv_sector · agriculture-and-dairy");
    expect(R.resourceId("Kit", "")).toBe("");
    expect(R.resourceId("Kit", "  ›  ")).toBe("");
    expect(R.resourceId("Not a type", "A › B")).toBe("");
  });
  it("the resource box shows for every change, and for a new idea only when ticked", () => {
    for (const k of ["Modification", "Suggestion", "Enhancement of existing feature"]) expect(R.showsResource(k, false)).toBe(true);
    expect(R.showsResource("New idea", false)).toBe(false);
    expect(R.showsResource("New idea", true)).toBe(true);
  });
});

describe("validation messages, exactly the demo's, all together (acceptance 3)", () => {
  it("a valid new idea passes and a hidden resource box stores null", () => {
    const r = R.validateSubmission(ok({ resource: { path: "x" } }), { sectors: SECTORS, name: "A" });
    expect(r.errors).toEqual([]);
    expect(r.value.resource).toBeNull();
  });
  it("name, title and description are required", () => {
    expect(errorsOf(ok({ title: " " }))).toEqual([L.MESSAGES.required]);
    expect(errorsOf(ok({ description: "" }))).toEqual([L.MESSAGES.required]);
    expect(errorsOf(ok(), "")).toEqual([L.MESSAGES.required]);
  });
  it("with the resource box: path required, link http(s), and for a change 'what should change' required", () => {
    const res = (r: object) => ok({ kind: "Modification", resource: { feature: "Robots by Sector", type: "Robot type", ...r } });
    expect(errorsOf(res({ path: "", change: "x" }))).toEqual([L.MESSAGES.resourcePath]);
    expect(errorsOf(res({ path: "A › B", url: "ftp://x", change: "x" }))).toEqual([L.MESSAGES.resourceUrl]);
    expect(errorsOf(res({ path: "A › B", change: "" }))).toEqual([L.MESSAGES.change]);
    expect(errorsOf(ok({ refers: true, resource: { feature: "Robots by Sector", type: "Robot type", path: "A › B" } }))).toEqual([]); // a new idea needs no "what should change"
  });
  it("reference rows: both empty are dropped; a remark needs a link; links must be http(s)", () => {
    const r = R.validateSubmission(ok({ references: [{ url: "", remarks: "" }, { url: "https://a.example/x", remarks: "ok" }] }), { sectors: SECTORS, name: "A" });
    expect(r.errors).toEqual([]);
    expect(r.value.references).toEqual([{ url: "https://a.example/x", remarks: "ok" }]);
    expect(errorsOf(ok({ references: [{ url: "", remarks: "a remark" }] }))).toEqual([L.MESSAGES.refRemark]);
    expect(errorsOf(ok({ references: [{ url: "www.example.com", remarks: "" }] }))).toEqual([L.MESSAGES.refUrl]);
  });
  it("shows every problem at once, in the demo's order", () => {
    const all = errorsOf({ kind: "Suggestion", title: "", description: "", resource: { feature: "Robots by Sector", type: "Robot type", path: "", url: "x", change: "" }, references: [{ url: "", remarks: "r" }, { url: "nope", remarks: "" }] });
    expect(all.slice(0, 6)).toEqual([L.MESSAGES.required, L.MESSAGES.resourcePath, L.MESSAGES.resourceUrl, L.MESSAGES.change, L.MESSAGES.refRemark, L.MESSAGES.refUrl]);
  });
  it("lists and limits are checked too (the server repeats every check)", () => {
    expect(errorsOf(ok({ categories: ["Cooking"] }))).toContain(L.MESSAGES.badChoice);
    expect(errorsOf(ok({ sector: "agriculture-dairy", robotType: "milking-robots" }))).toContain(L.MESSAGES.badChoice); // not that sector's
    expect(errorsOf(ok({ sector: "not-sure", robotType: "weeding-robots" }))).toContain(L.MESSAGES.badChoice);
    expect(errorsOf(ok({ sector: "agriculture-dairy", robotType: "weeding-robots" }))).toEqual([]);
    expect(errorsOf(ok({ title: "x".repeat(151) }))).toContain(L.MESSAGES.tooLong);
    expect(errorsOf(ok({ kind: "Something else" }))).toContain(L.MESSAGES.badChoice);
  });
  it("the Moderator's send rule: a title, at least 20 characters of description, at least one category", () => {
    expect(R.validateSend({ title: "T", description: "x".repeat(19), categories: ["STEAM"] })).toBe(L.MESSAGES.sendLength);
    expect(R.validateSend({ title: "", description: "x".repeat(25), categories: ["STEAM"] })).toBe(L.MESSAGES.sendLength);
    expect(R.validateSend({ title: "T", description: "x".repeat(20), categories: [] })).toBe(L.MESSAGES.sendCategory);
    expect(R.validateSend({ title: "T", description: "x".repeat(20), categories: ["STEAM"] })).toBeNull();
  });
});

describe("the status machine: every listed transition, and nothing else (spec section 5)", () => {
  const S = L.STATUS;
  const all = Object.values(S);
  const table: [string, string, number, string | null][] = [
    // action, from, versions, to (null = refused)
    ["open", S.SUBMITTED, 0, S.REVIEW],
    ["save_draft", S.SUBMITTED, 0, S.DRAFT], ["save_draft", S.REVIEW, 0, S.DRAFT], ["save_draft", S.DRAFT, 0, S.DRAFT], ["save_draft", S.CHANGES, 1, S.CHANGES],
    ["send_request", S.SUBMITTED, 0, S.PENDING], ["send_request", S.REVIEW, 0, S.PENDING], ["send_request", S.DRAFT, 0, S.PENDING],
    ["send_request", S.CHANGES, 1, S.RESUBMITTED], ["send_request", S.DRAFT, 2, S.RESUBMITTED],
    ["decline", S.SUBMITTED, 0, S.REJECTED], ["decline", S.REVIEW, 0, S.REJECTED], ["decline", S.DRAFT, 0, S.REJECTED], ["decline", S.CHANGES, 1, S.REJECTED],
    ["request_changes", S.PENDING, 1, S.CHANGES], ["request_changes", S.RESUBMITTED, 2, S.CHANGES], ["request_changes", S.FAILED, 1, S.CHANGES],
    ["reject", S.PENDING, 1, S.REJECTED], ["reject", S.RESUBMITTED, 2, S.REJECTED], ["reject", S.FAILED, 1, S.REJECTED],
    ["publish", S.PENDING, 1, S.PUBLISHING], ["publish", S.RESUBMITTED, 2, S.PUBLISHING], ["publish", S.FAILED, 1, S.PUBLISHING],
    ["publish_ok", S.PUBLISHING, 1, S.PUBLISHED], ["publish_fail", S.PUBLISHING, 1, S.FAILED],
    // spec section 15, decided 27-11-2026 (the live card shows version 1 in these rows: publishedVersion = 1)
    ["unpublish", S.PUBLISHED, 1, S.UNPUBLISHED],
    ["reopen", S.REJECTED, 0, S.REVIEW], ["reopen", S.REJECTED, 2, S.REVIEW],
    ["admin_edit", S.PENDING, 1, S.PENDING], ["admin_edit", S.RESUBMITTED, 2, S.RESUBMITTED], ["admin_edit", S.FAILED, 1, S.FAILED],
    ["admin_edit", S.PUBLISHED, 1, S.PUBLISHED], ["admin_edit", S.UNPUBLISHED, 1, S.UNPUBLISHED],
    ["preview", S.PENDING, 1, S.PENDING], ["preview", S.RESUBMITTED, 2, S.RESUBMITTED], ["preview", S.FAILED, 1, S.FAILED],
    ["preview", S.UNPUBLISHED, 1, S.UNPUBLISHED], ["preview", S.PUBLISHED, 2, S.PUBLISHED],
    ["publish", S.UNPUBLISHED, 1, S.PUBLISHING], ["publish", S.PUBLISHED, 2, S.PUBLISHING],
  ];
  const ctx = (status: string, versions: number) => ({ status, versions, publishedVersion: 1 });
  it("allows each listed transition to the listed status", () => {
    for (const [action, from, v, to] of table) expect(R.nextStatus(action, ctx(from, v)), `${action} from ${from}`).toEqual({ ok: true, to });
  });
  it("refuses every other status for each state-changing action (including the new ones)", () => {
    for (const action of ["save_draft", "send_request", "decline", "request_changes", "reject", "publish", "publish_ok", "publish_fail", "unpublish", "reopen", "admin_edit", "preview"]) {
      const allowed = table.filter((t) => t[0] === action).map((t) => t[1]);
      for (const st of all.filter((s) => !allowed.includes(s))) expect(R.nextStatus(action, ctx(st, 1)).ok, `${action} from ${st}`).toBe(false);
    }
  });
  it("Unpublish only from Published; Reopen only from Rejected, to Under Moderator Review", () => {
    for (const st of all) expect(R.nextStatus("unpublish", ctx(st, 1)), st).toEqual(st === S.PUBLISHED ? { ok: true, to: S.UNPUBLISHED } : { ok: false });
    for (const st of all) expect(R.nextStatus("reopen", ctx(st, 1)), st).toEqual(st === S.REJECTED ? { ok: true, to: S.REVIEW } : { ok: false });
  });
  it("after publishing: preview and publish only when the current version is newer than the live card; an Unpublished item always", () => {
    expect(R.nextStatus("publish", { status: S.PUBLISHED, versions: 1, publishedVersion: 1 }).ok).toBe(false); // nothing new
    expect(R.nextStatus("preview", { status: S.PUBLISHED, versions: 1, publishedVersion: 1 }).ok).toBe(false);
    expect(R.nextStatus("publish", { status: S.PUBLISHED, versions: 2, publishedVersion: 1 })).toEqual({ ok: true, to: S.PUBLISHING }); // an edit after publishing
    expect(R.nextStatus("publish", { status: S.UNPUBLISHED, versions: 1, publishedVersion: 1 })).toEqual({ ok: true, to: S.PUBLISHING }); // publish again
    expect(R.nextStatus("admin_edit", { status: S.PUBLISHED, versions: 0 }).ok).toBe(false); // a version is needed first
    expect(R.canPublishNext(S.PUBLISHED, 3, 2)).toBe(true);
    expect(R.canPublishNext(S.PUBLISHED, 2, 2)).toBe(false);
    expect(R.canPublishNext(S.REJECTED, 2, null)).toBe(false);
  });
  it("a failed attempt goes back to Published only while the earlier card is still live; otherwise Publication Failed", () => {
    expect(R.nextStatus("publish_fail", { status: S.PUBLISHING, live: true })).toEqual({ ok: true, to: S.PUBLISHED });
    expect(R.nextStatus("publish_fail", { status: S.PUBLISHING, live: false })).toEqual({ ok: true, to: S.FAILED });
    expect(R.nextStatus("publish_fail", { status: S.PUBLISHING })).toEqual({ ok: true, to: S.FAILED });
    expect(R.nextStatus("publish_fail", { status: S.PUBLISHED, live: true }).ok).toBe(false);
  });
  it("Moderators edit only in Submitted, Under Review, Draft and Changes Requested; Admins act only in Pending, Resubmitted and Failed", () => {
    expect(all.filter(R.canModeratorEdit).sort()).toEqual([S.CHANGES, S.DRAFT, S.SUBMITTED, S.REVIEW].sort());
    expect(all.filter(R.canAdminAct).sort()).toEqual([S.FAILED, S.PENDING, S.RESUBMITTED].sort());
    for (const st of [S.PENDING, S.RESUBMITTED, S.PUBLISHING, S.PUBLISHED, S.REJECTED]) expect(R.canModeratorEdit(st)).toBe(false); // acceptance 8
  });
  it("opening changes only a Submitted item; preview and Admin edit need a version", () => {
    for (const st of all.filter((s) => s !== S.SUBMITTED)) expect(R.nextStatus("open", { status: st, versions: 0 })).toEqual({ ok: true, to: st });
    expect(R.nextStatus("preview", { status: S.PENDING, versions: 0 }).ok).toBe(false);
    expect(R.nextStatus("preview", { status: S.PENDING, versions: 1 })).toEqual({ ok: true, to: S.PENDING });
    expect(R.nextStatus("made-up", { status: S.PENDING, versions: 1 }).ok).toBe(false);
  });
});

describe("history wording (exactly the demo's)", () => {
  const h = R.history;
  it("each line", () => {
    expect(h.submitted("Enhancement of existing feature", { path: "A › B" }, 1)).toBe('Submitted through the contribution form: Enhancement of existing feature on "A › B" with 1 reference link(s).');
    expect(h.submitted("New idea", null, 0)).toBe("Submitted through the contribution form: New idea.");
    expect(h.opened()).toBe("Opened the contribution and started review.");
    expect(h.draft(["Title", "Category"])).toBe("Saved a draft (changed: Title, Category). Not published.");
    expect(h.draft([])).toBe("Saved a draft. Not published.");
    expect(h.sent(false, 1, [])).toBe("Submitted publishing request to Admin (version 1). Approved as-is, no changes to the original.");
    expect(h.sent(true, 2, ["Title"])).toBe("Resubmitted publishing request to Admin (version 2). Edited vs original: Title.");
    expect(h.previewed(3)).toBe("Opened the publish preview for v3.");
    expect(h.adminEdit(["Description"], 4)).toBe("Edited the proposed content (changed: Description). Saved as v4; Moderator version kept.");
    expect(h.publishClick(2)).toBe("Clicked Publish (attempt 2).");
    expect(h.published(2, "Healthcare")).toBe('Published v2 to the public "Healthcare" section, refreshed the page and verified it shows the approved content.');
    expect(h.failed("Timeout.")).toBe("Publication FAILED: Timeout. Public website unchanged.");
    expect(h.adminEditAfter(["Title"], 3)).toBe("Edited the proposed content after publishing (changed: Title). Saved as v3; the public card changes only when it is published again.");
    expect(h.unpublished()).toBe("Unpublished: removed the card from the public website. It can be published again (preview, then publish).");
    expect(h.reopened("Not a duplicate.")).toBe("Reopened the idea for Moderator review. Reason: Not a duplicate.");
  });
  it("changed fields use the labels and compare lists by value", () => {
    const a = { title: "T", description: "D", sector: "s", robotType: "r", categories: ["A", "B"], suitableFor: [], learningPath: "" };
    expect(R.changedFields({ ...a, categories: ["A", "B"] }, a)).toEqual([]);
    expect(R.changedFields({ ...a, categories: ["A"], learningPath: "Make" }, a)).toEqual(["Category", "Suggested path"]);
  });
});

describe("word diff (acceptance 9)", () => {
  it("marks removed words in <del> and added words in <ins>, and escapes everything", () => {
    expect(wordDiff("a small robot", "a big robot")).toBe("a <del>small</del><ins>big</ins> robot");
    expect(wordDiff("same", "same")).toBe("same");
    expect(wordDiff("<b>x</b>", "<b>y</b>")).toBe("<del>&lt;b&gt;x&lt;/b&gt;</del><ins>&lt;b&gt;y&lt;/b&gt;</ins>");
    expect(esc(`"'&<>`)).toBe("&quot;&#39;&amp;&lt;&gt;");
  });
});

describe("the public card: only the approved version, never internal data (acceptance 15); first name and type, first name only for minors", () => {
  const c = {
    id: 1030, code: "RV-1030", kind: "New idea", version: 2, notes: "SECRET MODERATOR NOTE", history: [{ text: "SECRET HISTORY" }], feedback: [{ text: "SECRET FEEDBACK" }],
    contributor: { name: "Ananya Rao Kumar", typeLabel: "Student", minor: false },
    original: { title: "Original title", description: "Original text" },
    proposed: { title: "Approved <title>", description: "Approved text", sector: "agriculture-dairy", robotType: "weeding-robots", categories: ["Robotics"], suitableFor: ["K6–K8", "Not sure"], learningPath: "Make" },
    resource: { path: "A › B", url: "https://techytree.in/x", change: "SECRET CHANGE TEXT", feature: "F", type: "T", id: "i" },
    references: [{ url: "https://example.com/a", remarks: "a remark" }],
  };
  it("builds from proposed only and keeps the contributor's first name", () => {
    const r = R.toPublicRecord(c, { sectors: SECTORS, version: 2 });
    expect(r).toMatchObject({ title: "Approved <title>", sectorName: "Agriculture & Dairy", robotTypeName: "Weeding robots", contributor: { name: "Ananya", type: "Student" } });
    const html = renderPublicCard(r) + renderPreviewDocument(r);
    expect(html).not.toMatch(/SECRET|Original title|Ananya Rao|Kumar/);
    expect(html).toContain("Approved &lt;title&gt;");
    expect(html).toContain("Idea by Ananya (Student)");
    expect(html).toContain("Make path");
    expect(html).not.toContain(">Not sure<");
    expect(renderPreviewDocument(r)).toContain("PREVIEW ONLY – not published. This is how the idea will appear on the public website.");
    expect(renderPreviewDocument(r)).toContain("RoboValley</b> › Community Ideas › Agriculture &amp; Dairy");
  });
  it("a minor is shown by first name only; the setting can hide the type for everyone", () => {
    expect(R.toPublicRecord({ ...c, contributor: { ...c.contributor, minor: true } }, { sectors: SECTORS }).contributor).toEqual({ name: "Ananya", type: "" });
    expect(R.publicContributor("Ravi", "Teacher", false, "first-name")).toEqual({ name: "Ravi", type: "" });
    expect(R.ideaBy({ name: "Ravi", type: "" })).toBe("Idea by Ravi");
    expect(L.PUBLIC_NAME_DISPLAY).toBe("first-name-and-type");
  });
  it("needs no stylesheet or network: inline styles only, no external resources", () => {
    const doc = renderPreviewDocument(R.toPublicRecord(c, { sectors: SECTORS }));
    expect(doc).not.toMatch(/<link|<script|class="|@import|src="/);
  });
});

describe("the attachment's real type comes from its first bytes", () => {
  it("JPEG, PNG and PDF are recognised; anything else is not", () => {
    expect(R.sniffType([0xff, 0xd8, 0xff, 0xe0])).toBe("image/jpeg");
    expect(R.sniffType([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).toBe("image/png");
    expect(R.sniffType([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])).toBe("application/pdf");
    expect(R.sniffType([0x3c, 0x73, 0x76, 0x67])).toBeNull(); // "<svg"
    expect(R.sniffType([0x47, 0x49, 0x46, 0x38])).toBeNull(); // GIF
    expect(R.attachmentAllowed("image/gif")).toBe(false);
  });
});
