// Contribution Portal: the STANDALONE DEMO's data for the portal screens (never used by the plugin or the app). The SAME methods as the
// app's adapter (portal-api.js: portal, formDecision, sectorForms, addField, changeField, deleteField, decideSuggestion, addSector,
// changeSector, setReviewerSectors, auditLog, sectorCounts), worked out in memory from the demo's mock workflow (api.js MockAdapter), its
// current-form items and its "Suggest a field" suggestions, with the SAME status model (portal-status.js) and the SAME extra step
// (portal-rules.js: a Moderator's approval, then the publishing request), so the demo behaves like production with migration 030.
import { FORM_NOTE, WORKFLOW_NOTE, formToPortal, workflowToPortal } from "./portal-status.js";
import { canModeratorEdit, changedFields, cleanProposed, sectorLabel, validateSend } from "./rules.js";
import { ApiError } from "./api.js";
import { APPROVED, APPROVED_LABEL, canApprove, portalHistory } from "./portal-rules.js";

const slugOf = (s) => String(s ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const at = (days) => new Date(Date.now() + (Number(days) || 0) * 864e5).toISOString();
const clone = (v) => JSON.parse(JSON.stringify(v));
const SOURCE = { suggested: "member", plugin: "plugin" };
const DECISIONS = {
  verify: { from: "pending_review", to: "pending_review", admin: false, label: "Verified (approved for an Admin)", kind: "approved" },
  approve: { from: "pending_review", to: "published", admin: true, label: "Approved and published", kind: "published" },
  request_changes: { from: "pending_review", to: "changes_requested", admin: false, label: "Asked the contributor for changes", kind: "sent_back" },
  reject: { from: "pending_review", to: "rejected", admin: false, label: "Not accepted", kind: "rejected" },
  remove: { from: "pending_review", to: "removed", admin: true, label: "Removed", kind: "removed" },
  unpublish: { from: "published", to: "unpublished", admin: true, label: "Unpublished", kind: "unpublished" },
  republish: { from: "unpublished", to: "published", admin: true, label: "Published again", kind: "published" },
};
const KIND_LABEL = { submitted: "Submitted", opened: "Opened for review", draft: "Draft saved", approved: "Approved", requested: "Publish requested", edited: "Edited", previewed: "Previewed", published: "Published", failed: "Publish failed", unpublished: "Unpublished", sent_back: "Sent back", rejected: "Rejected", reopened: "Reopened", removed: "Removed", roles: "Roles and sectors", fields: "Field changes", suggestions: "Suggested fields", sectors: "Sector changes", other: "Other" };
/** The kind of a workflow history line (the same reading as the server's Audit Log, src/lib/auditLog.ts). */
export function historyKind(text) {
  const t = String(text);
  const rules = [[/^Submitted through/, "submitted"], [/^Opened the contribution/, "opened"], [/^(Saved a draft|Reset the working)/, "draft"], [/^Approved (as-is|with edits)/, "approved"], [/^(Submitted|Resubmitted) publishing request/, "requested"],
    [/^Opened the publish preview/, "previewed"], [/^Edited the proposed content/, "edited"], [/^(Published v|Clicked Publish)/, "published"], [/^Publication FAILED/, "failed"],
    [/^Unpublished/, "unpublished"], [/^Requested changes/, "sent_back"], [/^(Declined the idea|Rejected the publishing request)/, "rejected"], [/^Reopened/, "reopened"]];
  return (rules.find(([re]) => re.test(t)) || [null, "other"])[1];
}

/**
 * mock: the MockAdapter; formItems: what members sent with the current form ({ id, user, title, status, sector, robot, at, reply, verified });
 * suggestions: "Suggest a field" waiting ({ sector, id, title, by, html, at }); plugins: { <field id>: "Plugin name" }.
 */
export function createDemoPortal(mock, { formItems = [], suggestions = [], plugins = {}, users = [] } = {}) {
  const forms = formItems.map((x) => ({ ...clone(x), verified: x.verified === true, verifiedBy: x.verified ? "Moderator" : "" }));
  // suggested fields as their own records (migration 030): pending, approved (with the field) or rejected (with the reason)
  const sugg = suggestions.map((x, i) => ({ ...clone(x), num: 9001 + i, status: "pending", sentAt: at(x.at ?? -(i + 2)) }));
  const archivedSectors = []; // archived sectors: out of every member list (mock.sectors), kept here for Admin > Sectors
  const limits = new Map(); // a moderator's sectors (Users & Roles): name -> [slug]; none = every sector
  const audit = [];
  const log = (actor, role, kind, target, details) => audit.push({ at: new Date().toISOString(), actor, role, action: kind, actionLabel: KIND_LABEL[kind] || "Other", target, details });
  let seq = 1;
  // Sector Forms' fields: the robot types the form offers, plus the sector page's other fields (a member's approved suggestion, a plugin's)
  for (const s of mock.sectors) {
    const robots = s.robots || [];
    const extra = (s.fields || []).filter((f) => f.id !== "about-this-sector" && !robots.some((r) => r.slug === f.id));
    s.formFields = [...robots.map((r) => ({ slug: r.slug, name: r.name, source: SOURCE[((s.fields || []).find((f) => f.id === r.slug) || {}).source] || "admin" })),
      ...extra.map((f) => ({ slug: f.id, name: f.title, source: SOURCE[f.source] || "admin" }))]
      .map((f, i) => ({ id: seq++, active: true, status: "active", description: "", icon: "", order: i + 1, pluginName: f.source === "plugin" ? plugins[f.slug] || "A directory plugin" : "", ...f }));
  }
  const sectorOf = (slug) => mock.sectors.find((s) => s.slug === slug);
  const workflowSector = (it) => (it.proposed && it.proposed.sector) || "";
  const live = () => forms.filter((x) => !["draft", "removed"].includes(x.status));

  function counts() {
    return mock.sectors.map((s) => {
      const c = { slug: s.slug, name: s.name, total: 0, pending: 0, approved: 0, requested: 0, published: 0, rejected: 0, unpublished: 0 };
      const bump = (k) => { if (k && k in c) { c.total += 1; c[k] += 1; } };
      live().filter((x) => x.sector === s.slug).forEach((x) => bump(formToPortal(x.status, x.verified)));
      mock.items.filter((it) => workflowSector(it) === s.slug).forEach((it) => bump(workflowToPortal(it.status)));
      return c;
    });
  }
  const formRow = (x, actor, view) => {
    const display = view === "requests" ? "requested" : formToPortal(x.status, x.verified);
    return {
      key: `f-${x.id}`, source: "form", id: x.id, code: `C-${x.id}`, title: x.title, contributor: x.user, contributorType: (users.find((u) => u[0] === x.user) || [])[1] || "",
      status: x.status, display, note: x.verified && x.status === "pending_review" ? "Verified by a reviewer" : FORM_NOTE[x.status] || "",
      sentAt: at(x.at), approvedBy: x.verified ? x.verifiedBy || "Moderator" : null, sector: x.sector, sectorName: sectorLabel(x.sector, mock.sectors), categories: [], alsoIn: [],
      actions: view === "moderation" && x.status === "pending_review" && !x.verified && x.user !== actor.name ? ["approve", "reject"] : [], viewUrl: `#form-item-${x.id}`,
    };
  };
  const workflowRow = (it, view) => {
    const last = it.versions && it.versions.length ? it.versions[it.versions.length - 1] : null;
    const dec = it.status === "rejected" ? (it.feedback || []).filter((f) => f.type === "decline" || f.type === "reject").slice(-1)[0] : null;
    return {
      ...(dec ? { decision: { label: `${dec.type === "decline" ? "Declined" : "Rejected"} by ${dec.by} (${dec.type === "decline" ? "Moderator" : "Admin"})`, at: dec.at } } : {}),
      key: `w-${it.id}`, source: "workflow", id: it.id, code: it.code, title: it.proposed.title, contributor: it.contributor.name, contributorType: it.contributor.typeLabel,
      status: it.status, display: workflowToPortal(it.status), note: WORKFLOW_NOTE[it.status] || "", sentAt: view === "requests" && last ? last.at : it.submittedAt,
      approvedBy: it.moderator || null, sector: workflowSector(it), sectorName: sectorLabel(workflowSector(it), mock.sectors), categories: [], alsoIn: [],
      actions: view === "moderation" ? (canModeratorEdit(it.status) ? ["approve", "edit", "reject"] : it.status === APPROVED ? ["send", "view"] : ["view"]) : [], viewUrl: null,
    };
  };
  const byNewest = (a, b) => String(b.sentAt || "").localeCompare(String(a.sentAt || ""));

  async function portal(actor, view, { sector = "" } = {}) {
    const limitedTo = actor.isAdmin ? null : limits.get(actor.name) || null;
    const sectors = counts().filter((c) => !limitedTo || limitedTo.includes(c.slug));
    const out = { view, sectors, sector: null, rows: [], fields: [], totals: null, exportUrl: null, isAdmin: actor.isAdmin, features: { approvedStep: true }, limitedTo };
    if (view !== "moderation" && !actor.isAdmin) throw new ApiError(403, "ADMIN_ONLY", "Only an administrator can open this.");
    if (view === "moderation") {
      const pick = sectors.find((s) => s.slug === sector) || [...sectors].sort((a, b) => b.pending - a.pending)[0];
      if (!pick) return out;
      out.sector = { slug: pick.slug, name: pick.name };
      out.rows = [...live().filter((x) => x.sector === pick.slug).map((x) => formRow(x, actor, view)), ...mock.items.filter((it) => workflowSector(it) === pick.slug).map((it) => workflowRow(it, view))].sort(byNewest);
      out.fields = (sectorOf(pick.slug).formFields || []).filter((f) => f.status !== "archived").map((f) => ({ slug: f.slug, name: f.name, active: f.active, source: f.source, pluginName: f.pluginName }));
      return out;
    }
    const formReq = forms.filter((x) => x.status === "pending_review" && x.verified).map((x) => formRow(x, actor, "requests"));
    const wf = mock.items.map((it) => workflowRow(it, "requests"));
    if (view === "requests") {
      const s = sectors.find((x) => x.slug === sector) || null;
      out.sector = s ? { slug: s.slug, name: s.name } : null;
      out.rows = [...wf.filter((r) => r.display !== "pending" && r.display !== "approved"), ...formReq].filter((r) => !sector || r.sector === sector).sort(byNewest);
      return out;
    }
    const week = Date.now() - 7 * 864e5;
    out.totals = {
      requests: wf.filter((r) => r.display === "requested").length + formReq.length,
      publishedThisWeek: mock.items.filter((it) => it.status === "published" && it.publishedAt && Date.parse(it.publishedAt) >= week).length + forms.filter((x) => x.status === "published" && Date.parse(at(x.at)) >= week).length,
      rejected: mock.items.filter((it) => it.status === "rejected").length + forms.filter((x) => x.status === "rejected").length,
      activeContributors: new Set([...mock.items.map((it) => it.contributor.name), ...forms.filter((x) => Date.parse(at(x.at)) >= Date.now() - 30 * 864e5).map((x) => x.user)]).size,
    };
    return out;
  }

  async function formDecision(actor, id, action, note = "") {
    const x = forms.find((f) => f.id === Number(id));
    const rule = DECISIONS[action];
    if (!x || !rule) throw new ApiError(404, "NOT_FOUND", "We could not find that contribution.");
    if (rule.admin && !actor.isAdmin) throw new ApiError(403, "ADMIN_ONLY", "Only an administrator can approve, publish, unpublish or remove a contribution. You can verify it, ask for changes or reject it.");
    if (x.user === actor.name) throw new ApiError(403, "OWN_ITEM", "You cannot review your own contribution. Another reviewer will.");
    if (x.status !== rule.from) throw new ApiError(409, "WRONG_STATUS", "That cannot be done now. Reload the page to see where it stands.");
    if (["request_changes", "reject", "remove", "unpublish"].includes(action) && String(note).trim().length < 3) throw new ApiError(400, "VALIDATION_FAILED", "Please give a reason (at least 3 characters).");
    if (action === "verify") { x.verified = true; x.verifiedBy = actor.name.split(" ")[0]; }
    x.status = rule.to;
    if (note) x.reply = note;
    log(actor.name, actor.isAdmin ? "Admin" : "Moderator", rule.kind, `C-${x.id} · ${x.title}`, `${rule.label}${note ? `. Note: ${note}` : ""}`);
    return { success: true, id: x.id, status: x.status, action };
  }

  const allSectors = () => [...mock.sectors, ...archivedSectors];
  const sectorAny = (slug) => allSectors().find((s) => s.slug === slug);
  // how many contributions use a field: shown (current form: not drafts or removed) and any at all (what deleting waits for)
  const usedBy = (s, f) => mock.items.filter((it) => [it.proposed, it.original].some((v) => v && v.sector === s.slug && v.robotType === f.slug)).length + forms.filter((x) => x.sector === s.slug && x.robot === f.slug && !["draft", "removed"].includes(x.status)).length;
  const anyUse = (s, f) => usedBy(s, f) + forms.filter((x) => x.sector === s.slug && x.robot === f.slug && ["draft", "removed"].includes(x.status)).length;
  const offered = (s) => { s.robots = s.formFields.filter((x) => x.status === "active").sort((a, b) => a.order - b.order).map((x) => ({ slug: x.slug, name: x.name })); };

  async function sectorForms(actor, sector = "") {
    if (!actor.isAdmin) throw new ApiError(403, "FORBIDDEN", "You do not have access to this.");
    const waiting = (s) => sugg.filter((x) => x.sector === s.slug && x.status === "pending");
    const s = sectorAny(sector) || mock.sectors[0];
    const view = (f) => {
      const n = usedBy(s, f), any = anyUse(s, f);
      const deleteBlock = f.source === "plugin" ? `Managed by ${f.pluginName || "a plugin"}: it cannot be deleted. Hide or archive it instead.`
        : n > 0 ? `Can't delete: ${n} contribution${n === 1 ? " uses" : "s use"} this field. Archive it instead.` : any > 0 ? "Can't delete: a draft or removed contribution still uses this field. Archive it instead." : "";
      return { ...f, contributions: n, deletable: !deleteBlock, deleteBlock };
    };
    return {
      sectors: allSectors().map((x) => ({ slug: x.slug, name: x.name, active: !x.archived, archived: x.archived === true, icon: x.icon || "", color: x.color || "",
        fields: (x.formFields || []).filter((f) => f.status !== "archived").length, suggestions: waiting(x).length })),
      sector: s ? { slug: s.slug, name: s.name, active: !s.archived } : null,
      fields: s ? (s.formFields || []).slice().sort((a, b) => a.order - b.order).map(view) : [],
      suggestions: s ? waiting(s).map((x) => ({ id: x.num, code: `RV-${x.num}`, name: x.title, by: x.by, reason: String(x.html || "").replace(/<[^>]+>/g, ""), sentAt: x.sentAt, status: "pending", display: "pending", record: true })) : [],
      questionsOn: null, robotsReady: true, features: { fieldsData: true },
    };
  }
  /** Adds a field (body: name, and with 030 slug, description, icon, status), or the field an approved suggestion becomes. */
  function addField(actor, sector, body, fromSuggestion = null) {
    const s = sectorAny(sector), name = String((body && body.name) || "").replace(/\s+/g, " ").trim();
    if (!actor.isAdmin) throw new ApiError(403, "FORBIDDEN", "You do not have access to this.");
    if (!s || name.length < 2) throw new ApiError(400, "VALIDATION_FAILED", "Please type a name (at least 2 characters).");
    const typed = String((body && body.slug) || "").trim();
    if (typed && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(typed)) throw new ApiError(400, "VALIDATION_FAILED", "The link code can use lower-case letters, digits and single hyphens (up to 60 characters).");
    if (s.formFields.some((f) => f.name.toLowerCase() === name.toLowerCase())) throw new ApiError(409, "DUPLICATE", `This sector already has a field called "${name}".`);
    if (typed && s.formFields.some((f) => f.slug === typed)) throw new ApiError(409, "DUPLICATE_SLUG", `This sector already has a field with the link code "${typed}". Choose another one.`);
    let slug = typed || slugOf(name);
    for (let i = 2, base = slug; s.formFields.some((f) => f.slug === slug); i++) slug = `${base}-${i}`;
    const status = body && body.status === "hidden" ? "hidden" : "active";
    const f = { id: seq++, slug, name, active: status === "active", status, order: Math.max(0, ...s.formFields.map((x) => x.order)) + 1, source: fromSuggestion ? "member" : "admin", pluginName: "",
      description: String((body && body.description) || "").trim().slice(0, 500), icon: String((body && body.icon) || "").trim().slice(0, 8) };
    s.formFields.push(f);
    offered(s);
    s.fields = [...(s.fields || []), { id: slug, title: name, html: fromSuggestion ? fromSuggestion.html : `<p>${f.description || `${name} in ${s.name}.`}</p>`, ...(fromSuggestion ? { source: "suggested" } : {}) }];
    if (!fromSuggestion) log(actor.name, "Admin", "fields", `Field · ${name} (${s.slug})`, `Added the field "${name}" (link code ${slug}).`);
    return Promise.resolve({ success: true, robot: { id: f.id, slug, name, active: f.active, order: f.order, status } });
  }
  function deleteField(actor, sector, id) {
    const s = sectorAny(sector), f = s && s.formFields.find((x) => String(x.id) === String(id));
    if (!actor.isAdmin) throw new ApiError(403, "FORBIDDEN", "You do not have access to this.");
    if (!f) throw new ApiError(404, "NOT_FOUND", "We could not find that field.");
    if (f.source === "plugin") throw new ApiError(409, "PLUGIN_MANAGED", `"${f.name}" is managed by a plugin and cannot be deleted. Hide or archive it instead.`);
    const n = anyUse(s, f);
    if (n > 0) throw new ApiError(409, "IN_USE", `Can't delete "${f.name}": ${n} contribution${n === 1 ? " uses" : "s use"} this field. Archive it instead.`);
    s.formFields = s.formFields.filter((x) => x !== f);
    s.fields = (s.fields || []).filter((x) => x.id !== f.slug);
    offered(s);
    log(actor.name, "Admin", "fields", `Field · ${f.name} (${s.slug})`, `Deleted the field "${f.name}" (link code ${f.slug}); nothing used it.`);
    return Promise.resolve({ success: true });
  }
  function decideSuggestion(actor, id, body = {}) {
    if (!actor.isAdmin) throw new ApiError(403, "ADMIN_ONLY", "Only an administrator can approve or reject a suggested field.");
    const x = sugg.find((g) => g.num === Number(id));
    if (!x) throw new ApiError(404, "NOT_FOUND", "We could not find that suggestion.");
    if (x.status !== "pending") throw new ApiError(409, "ALREADY_DECIDED", `This suggestion was already ${x.status}. Reload the page.`);
    if (body.action === "reject") {
      const reason = String(body.reason || "").trim();
      if (!reason) throw new ApiError(400, "VALIDATION_FAILED", "Write the reason for rejecting this suggestion.");
      x.status = "rejected"; x.rejectReason = reason;
      log(actor.name, "Admin", "suggestions", `Suggested field · ${x.title}`, `Rejected the suggested field "${x.title}". Reason: ${reason}`);
      return Promise.resolve({ success: true, message: `Rejected "${x.title}". The member's idea keeps its own review.` });
    }
    const name = String(body.name || x.title).replace(/\s+/g, " ").trim();
    return addField(actor, x.sector, { name, slug: body.slug, description: body.description ?? String(x.html || "").replace(/<[^>]+>/g, "") }, x).then((r) => {
      x.status = "approved"; x.fieldId = r.robot.id;
      log(actor.name, "Admin", "suggestions", `Suggested field · ${x.title}`, `Approved the suggested field "${x.title}"${name !== x.title ? ` as "${name}"` : ""}: it is now a field of the sector.`);
      return { success: true, fieldId: r.robot.id, message: `"${name}" was added to the sector's fields with the "Suggested by member" badge.` };
    });
  }
  function changeField(actor, sector, id, change) {
    const s = sectorAny(sector);
    const list = s ? s.formFields.slice().sort((a, b) => a.order - b.order) : [];
    const f = list.find((x) => String(x.id) === String(id));
    if (!actor.isAdmin) throw new ApiError(403, "FORBIDDEN", "You do not have access to this.");
    if (!f) throw new ApiError(404, "NOT_FOUND", "We could not find that field.");
    if (typeof change.name === "string") { log(actor.name, "Admin", "fields", `Field · ${f.name} (${s.slug})`, `Renamed the field "${f.name}" to "${change.name.trim()}".`); f.name = change.name.trim(); }
    if (typeof change.active === "boolean") { f.active = change.active; f.status = change.active ? "active" : f.status === "archived" ? "archived" : "hidden"; log(actor.name, "Admin", "fields", `Field · ${f.name} (${s.slug})`, change.active ? "Shown on the form again" : "Hidden from the form"); }
    if (["active", "hidden", "archived"].includes(change.status)) {
      const from = f.status;
      f.status = change.status; f.active = change.status === "active";
      log(actor.name, "Admin", "fields", `Field · ${f.name} (${s.slug})`, change.status === "archived" ? `Archived the field "${f.name}" (its contributions stay).` : from === "archived" ? `Restored the field "${f.name}".` : `Field "${f.name}": ${from} → ${change.status}.`);
    }
    if (change.edit && typeof change.edit === "object") {
      const e = change.edit, changed = [];
      if (typeof e.name === "string" && e.name.trim() && e.name.trim() !== f.name) { f.name = e.name.trim(); changed.push("name"); }
      if (typeof e.description === "string" && e.description.trim() !== (f.description || "")) { f.description = e.description.trim().slice(0, 500); changed.push("description"); }
      if (typeof e.icon === "string" && e.icon.trim() !== (f.icon || "")) { f.icon = e.icon.trim().slice(0, 8); changed.push("icon"); }
      if (changed.length) log(actor.name, "Admin", "fields", `Field · ${f.name} (${s.slug})`, `Edited the field "${f.name}" (${changed.join(", ")}).`);
    }
    if (change.move === "up" || change.move === "down") {
      const i = list.indexOf(f), j = change.move === "up" ? i - 1 : i + 1;
      if (j >= 0 && j < list.length) { const o = list[j].order; list[j].order = f.order; f.order = o; }
    }
    offered(s); // the form offers the active ones, in order
    return Promise.resolve({ success: true });
  }

  // ---- Admin > Sectors (migration 030: archive, the card's icon and colour)
  function waitingIn(slug) {
    return mock.items.filter((it) => workflowSector(it) === slug && !["published", "rejected", "unpublished"].includes(it.status)).length
      + forms.filter((x) => x.sector === slug && ["pending_review", "changes_requested"].includes(x.status)).length;
  }
  function addSector(actor, body = {}) {
    if (!actor.isAdmin) throw new ApiError(403, "FORBIDDEN", "You do not have access to this.");
    const name = String(body.name || "").replace(/\s+/g, " ").trim();
    if (name.length < 2) throw new ApiError(400, "VALIDATION_FAILED", "The name needs at least 2 characters.");
    if (allSectors().some((x) => x.name.toLowerCase() === name.toLowerCase())) throw new ApiError(409, "DUPLICATE", `There is already a sector called "${name}".`);
    let slug = slugOf(name) || "sector";
    for (let i = 2, base = slug; allSectors().some((x) => x.slug === slug); i++) slug = `${base}-${i}`;
    const s = { slug, name, robots: [], fields: [], formFields: [], icon: String(body.icon || "").trim().slice(0, 8), color: /^#[0-9A-Fa-f]{6}$/.test(String(body.color || "")) ? String(body.color).toUpperCase() : "" };
    mock.sectors.push(s);
    log(actor.name, "Admin", "sectors", `Sector · ${name}`, `Added the sector "${name}" (link code ${slug}).`);
    return Promise.resolve({ success: true, sector: { slug, name }, message: `"${name}" was added at the end of the list.` });
  }
  function changeSector(actor, slug, change = {}) {
    if (!actor.isAdmin) throw new ApiError(403, "FORBIDDEN", "You do not have access to this.");
    const s = sectorAny(slug);
    if (!s) throw new ApiError(404, "NOT_FOUND", "We could not find that sector.");
    let message = "Saved.";
    if (typeof change.name === "string") {
      const name = change.name.replace(/\s+/g, " ").trim();
      if (name.length < 2) throw new ApiError(400, "VALIDATION_FAILED", "The name needs at least 2 characters.");
      log(actor.name, "Admin", "sectors", `Sector · ${name}`, `Renamed the sector "${s.name}" to "${name}".`);
      s.name = name; message = `Renamed to "${name}". Its link code stays "${s.slug}".`;
    } else if (change.move === "up" || change.move === "down") {
      const i = mock.sectors.indexOf(s), j = change.move === "up" ? i - 1 : i + 1;
      if (i >= 0 && j >= 0 && j < mock.sectors.length) { [mock.sectors[i], mock.sectors[j]] = [mock.sectors[j], mock.sectors[i]]; log(actor.name, "Admin", "sectors", `Sector · ${s.name}`, `Moved the sector "${s.name}" ${change.move} (now ${j + 1}).`); }
      message = "Moved.";
    } else if (change.archived === true) {
      const n = waitingIn(s.slug);
      if (n > 0) throw new ApiError(409, "STILL_WAITING", `${n} contribution${n === 1 ? " in this sector is" : "s in this sector are"} still waiting for a decision. Decide ${n === 1 ? "it" : "them"} first, then archive the sector.`);
      mock.sectors.splice(mock.sectors.indexOf(s), 1); s.archived = true; archivedSectors.push(s);
      log(actor.name, "Admin", "sectors", `Sector · ${s.name}`, `Archived the sector "${s.name}" (members no longer see it; its contributions stay).`);
      message = `"${s.name}" is archived: members no longer see it. Its contributions stay.`;
    } else if (change.archived === false) {
      archivedSectors.splice(archivedSectors.indexOf(s), 1); s.archived = false; mock.sectors.push(s);
      log(actor.name, "Admin", "sectors", `Sector · ${s.name}`, `Restored the sector "${s.name}".`);
      message = `"${s.name}" is back for members.`;
    } else if (change.style && typeof change.style === "object") {
      if ("icon" in change.style) s.icon = String(change.style.icon || "").trim().slice(0, 8);
      if ("color" in change.style) { const c = String(change.style.color || "").trim(); if (c && !/^#[0-9A-Fa-f]{6}$/.test(c)) throw new ApiError(400, "VALIDATION_FAILED", "The colour must look like #1F7A5C."); s.color = c.toUpperCase(); }
      log(actor.name, "Admin", "sectors", `Sector · ${s.name}`, `Changed the card of "${s.name}".`);
      message = "The sector's card is updated.";
    }
    return Promise.resolve({ success: true, message });
  }
  function setReviewerSectors(actor, name, sectors = []) {
    if (!actor.isAdmin) throw new ApiError(403, "FORBIDDEN", "You do not have access to this.");
    const list = (Array.isArray(sectors) ? sectors : []).filter((x) => mock.sectors.some((s) => s.slug === x));
    if (list.length) limits.set(name, list); else limits.delete(name);
    log(actor.name, "Admin", "roles", name, list.length ? `${name} reviews: ${list.join(", ")}.` : `${name} reviews every sector.`);
    return Promise.resolve({ success: true, sectors: list.map((x) => ({ slug: x, name: (sectorOf(x) || {}).name || x })) });
  }

  // ---- the Approved step (portal-rules.js, migration 030) on top of the mock's own workflow (api.js MockAdapter, which the plugin bundles)
  async function act(base, actor, id, action, payload = {}) {
    const it = mock.items.find((x) => x.id === Number(id));
    if (!it) throw new ApiError(404, "NOT_FOUND", "We could not find that contribution.");
    if (action === "approve") {
      if (!canApprove(it.status)) throw new ApiError(409, "NOT_ALLOWED", "This idea cannot be approved now.");
      if (Number(payload.rowVersion) !== it.rowVersion) throw new ApiError(409, "STALE", "Someone else changed this contribution. Reload it to see the latest version.");
      const { error, value } = cleanProposed(payload.proposed || it.proposed, { sectors: mock.sectors, minor: it.contributor.minor === true });
      if (error) throw new ApiError(400, "VALIDATION_FAILED", error);
      const sendError = validateSend(value);
      if (sendError) throw new ApiError(400, "VALIDATION_FAILED", sendError);
      const ch = changedFields(value, it.original);
      it.proposed = value; it.notes = String(payload.notes ?? it.notes ?? "").trim(); it.status = APPROVED; it.statusLabel = APPROVED_LABEL;
      it.moderator = it.moderator || actor.name; it.approvedBy = actor.name; it.rowVersion += 1;
      mock.log(it, actor.name, portalHistory.approved(ch));
      return { item: clone(it), message: "Approved. It is not public: send the publishing request to an Admin when it is ready." };
    }
    if (it.status === APPROVED && ["send_request", "save_draft", "reset", "decline"].includes(action)) {
      it.status = "draft"; // the mock's own step from the Moderator's draft gives the same result (portal-rules.js: from Approved)
      try { return await base.act(id, action, payload); } catch (e) { it.status = APPROVED; throw e; }
    }
    if (it.status === APPROVED && action === "open") return { item: clone(it) };
    return base.act(id, action, payload);
  }
  async function auditLog(actor, { page = 1, action = "", q = "" } = {}) {
    if (!actor.isAdmin) throw new ApiError(403, "FORBIDDEN", "You do not have access to this.");
    const rows = [...audit];
    for (const it of mock.items) for (const h of it.history || []) {
      const kind = historyKind(h.text), own = String(h.actor).startsWith(it.contributor.name);
      rows.push({ at: h.at, actor: String(h.actor).replace(/\s*\([^)]*\)\s*$/, ""), role: own ? "Contributor" : h.actor === mock.actors.admin ? "Admin" : "Moderator", action: kind, actionLabel: KIND_LABEL[kind], target: `${it.code} · ${it.proposed.title}`, details: h.text });
    }
    const shown = rows.filter((r) => (!action || r.action === action) && (!q || `${r.actor} ${r.role} ${r.target} ${r.details}`.toLowerCase().includes(String(q).toLowerCase()))).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const pages = Math.max(1, Math.ceil(shown.length / 50)), p = Math.min(Math.max(1, Number(page) || 1), pages);
    return { rows: shown.slice((p - 1) * 50, p * 50), total: shown.length, page: p, pages, actions: Object.entries(KIND_LABEL), action, q };
  }
  async function sectorCounts() {
    const keys = ["submitted", "verified", "changesRequested", "published", "rejected", "unpublished", "total"];
    const zero = () => Object.fromEntries(keys.map((k) => [k, 0]));
    const add = (c, x) => {
      const k = x.status === "pending_review" ? (x.verified ? "verified" : "submitted") : x.status === "changes_requested" ? "changesRequested" : x.status;
      if (k in c) { c[k] += 1; c.total += 1; }
    };
    const sectors = allSectors().map((s) => { const c = { slug: s.slug, name: s.name, active: !s.archived, demo: false, archived: s.archived === true, icon: s.icon || "", color: s.color || "", ...zero() }; live().filter((x) => x.sector === s.slug).forEach((x) => add(c, x)); return c; });
    const sum = zero(); sectors.forEach((c) => keys.forEach((k) => { sum[k] += c[k]; }));
    const unique = zero(); live().forEach((x) => add(unique, x));
    return { sectors, sum, unique, features: { sectorsData: true } };
  }
  const formItem = (id) => forms.find((x) => x.id === Number(id)) || null;

  /** The adapter of one role, like the app's: the workflow's own calls plus the portal's. */
  function as(role) {
    const base = mock.as(role), actor = { name: role === "admin" ? mock.actors.admin : mock.actors.moderator, isAdmin: role === "admin" };
    return {
      ...base,
      act: (id, action, payload) => act(base, actor, id, action, payload),
      portal: (view, o) => portal(actor, view, o),
      formDecision: (id, action, note) => formDecision(actor, id, action, note),
      sectorForms: (sector) => sectorForms(actor, sector),
      addField: (sector, body) => addField(actor, sector, body),
      changeField: (sector, id, change) => changeField(actor, sector, id, change),
      deleteField: (sector, id) => deleteField(actor, sector, id),
      decideSuggestion: (id, body) => decideSuggestion(actor, id, body),
      addSector: (body) => addSector(actor, body),
      changeSector: (slug, change) => changeSector(actor, slug, change),
      setReviewerSectors: (name, sectors) => setReviewerSectors(actor, name, sectors),
      auditLog: (q) => auditLog(actor, q),
      sectorCounts: () => sectorCounts(),
      mine: () => mock.mine({ name: actor.name, type: role === "admin" ? "Administrator" : "Moderator", minor: false }),
    };
  }
  return { as, formItem, forms, suggestions: sugg, formDecision, counts, limits };
}
