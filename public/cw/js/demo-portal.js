// Contribution Portal: the STANDALONE DEMO's data for the portal screens (never used by the plugin or the app). The SAME methods as the
// app's adapter (portal-api.js: portal, formDecision, sectorForms, addField, changeField, auditLog, sectorCounts), worked out in memory
// from the demo's mock workflow (api.js MockAdapter), its current-form items and its "Suggest a field" suggestions, with the SAME status
// model (portal-status.js), so the demo's numbers and buttons behave like production's.
import { FORM_NOTE, WORKFLOW_NOTE, formToPortal, workflowToPortal } from "./portal-status.js";
import { canModeratorEdit, sectorLabel } from "./rules.js";
import { ApiError } from "./api.js";

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
const KIND_LABEL = { submitted: "Submitted", opened: "Opened for review", draft: "Draft saved", approved: "Approved", edited: "Edited", previewed: "Previewed", published: "Published", failed: "Publish failed", unpublished: "Unpublished", sent_back: "Sent back", rejected: "Rejected", reopened: "Reopened", removed: "Removed", roles: "Role changed", fields: "Field changed", other: "Other" };
/** The kind of a workflow history line (the same reading as the server's Audit Log, src/lib/auditLog.ts). */
export function historyKind(text) {
  const t = String(text);
  const rules = [[/^Submitted through/, "submitted"], [/^Opened the contribution/, "opened"], [/^(Saved a draft|Reset the working)/, "draft"], [/^(Submitted|Resubmitted) publishing request/, "approved"],
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
  const sugg = suggestions.map((x, i) => ({ ...clone(x), num: 9001 + i, status: "submitted", sentAt: at(x.at ?? -(i + 2)) }));
  const audit = [];
  const log = (actor, role, kind, target, details) => audit.push({ at: new Date().toISOString(), actor, role, action: kind, actionLabel: KIND_LABEL[kind] || "Other", target, details });
  let seq = 1;
  // Sector Forms' fields: the robot types the form offers, plus the sector page's other fields (a member's approved suggestion, a plugin's)
  for (const s of mock.sectors) {
    const robots = s.robots || [];
    const extra = (s.fields || []).filter((f) => f.id !== "about-this-sector" && !robots.some((r) => r.slug === f.id));
    s.formFields = [...robots.map((r) => ({ slug: r.slug, name: r.name, source: SOURCE[((s.fields || []).find((f) => f.id === r.slug) || {}).source] || "admin" })),
      ...extra.map((f) => ({ slug: f.id, name: f.title, source: SOURCE[f.source] || "admin" }))]
      .map((f, i) => ({ id: seq++, active: true, order: i + 1, pluginName: f.source === "plugin" ? plugins[f.slug] || "A directory plugin" : "", ...f }));
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
    return {
      key: `w-${it.id}`, source: "workflow", id: it.id, code: it.code, title: it.proposed.title, contributor: it.contributor.name, contributorType: it.contributor.typeLabel,
      status: it.status, display: workflowToPortal(it.status), note: WORKFLOW_NOTE[it.status] || "", sentAt: view === "requests" && last ? last.at : it.submittedAt,
      approvedBy: it.moderator || null, sector: workflowSector(it), sectorName: sectorLabel(workflowSector(it), mock.sectors), categories: [], alsoIn: [],
      actions: view === "moderation" ? (canModeratorEdit(it.status) ? ["approve", "edit", "reject"] : ["view"]) : [], viewUrl: null,
    };
  };
  const byNewest = (a, b) => String(b.sentAt || "").localeCompare(String(a.sentAt || ""));

  async function portal(actor, view, { sector = "" } = {}) {
    const sectors = counts();
    const out = { view, sectors, sector: null, rows: [], fields: [], totals: null, exportUrl: null, isAdmin: actor.isAdmin };
    if (view !== "moderation" && !actor.isAdmin) throw new ApiError(403, "ADMIN_ONLY", "Only an administrator can open this.");
    if (view === "moderation") {
      const pick = sectors.find((s) => s.slug === sector) || [...sectors].sort((a, b) => b.pending - a.pending)[0];
      if (!pick) return out;
      out.sector = { slug: pick.slug, name: pick.name };
      out.rows = [...live().filter((x) => x.sector === pick.slug).map((x) => formRow(x, actor, view)), ...mock.items.filter((it) => workflowSector(it) === pick.slug).map((it) => workflowRow(it, view))].sort(byNewest);
      out.fields = (sectorOf(pick.slug).formFields || []).map((f) => ({ slug: f.slug, name: f.name, active: f.active, source: f.source, pluginName: f.pluginName }));
      return out;
    }
    const formReq = forms.filter((x) => x.status === "pending_review" && x.verified).map((x) => formRow(x, actor, "requests"));
    const wf = mock.items.map((it) => workflowRow(it, "requests"));
    if (view === "requests") {
      const s = sectors.find((x) => x.slug === sector) || null;
      out.sector = s ? { slug: s.slug, name: s.name } : null;
      out.rows = [...wf.filter((r) => r.display !== "pending"), ...formReq].filter((r) => !sector || r.sector === sector).sort(byNewest);
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

  async function sectorForms(actor, sector = "") {
    if (!actor.isAdmin) throw new ApiError(403, "FORBIDDEN", "You do not have access to this.");
    const waiting = (s) => sugg.filter((x) => x.sector === s.slug && x.status !== "rejected" && !(s.formFields || []).some((f) => f.name.toLowerCase() === x.title.toLowerCase()));
    const s = sectorOf(sector) || mock.sectors[0];
    const used = (f) => mock.items.filter((it) => [it.proposed, it.original].some((v) => v && v.sector === s.slug && v.robotType === f.slug)).length + forms.filter((x) => x.sector === s.slug && x.robot === f.slug && !["draft", "removed"].includes(x.status)).length;
    return {
      sectors: mock.sectors.map((x) => ({ slug: x.slug, name: x.name, active: true, fields: (x.formFields || []).length, suggestions: waiting(x).length })),
      sector: s ? { slug: s.slug, name: s.name, active: true } : null,
      fields: s ? (s.formFields || []).slice().sort((a, b) => a.order - b.order).map((f) => ({ ...f, contributions: used(f) })) : [],
      suggestions: s ? waiting(s).map((x) => ({ id: x.num, code: `RV-${x.num}`, name: x.title, by: x.by, reason: String(x.html || "").replace(/<[^>]+>/g, ""), sentAt: x.sentAt, status: x.status, display: "pending" })) : [],
      questionsOn: null, robotsReady: true,
    };
  }
  function addField(actor, sector, body) {
    const s = sectorOf(sector), name = String((body && body.name) || "").replace(/\s+/g, " ").trim();
    if (!actor.isAdmin) throw new ApiError(403, "FORBIDDEN", "You do not have access to this.");
    if (!s || name.length < 2) throw new ApiError(400, "VALIDATION_FAILED", "Please type a name (at least 2 characters).");
    const slug = slugOf(name);
    if (s.formFields.some((f) => f.slug === slug || f.name.toLowerCase() === name.toLowerCase())) throw new ApiError(409, "DUPLICATE", `This sector already has a field called "${name}".`);
    const fromSuggestion = sugg.find((x) => x.sector === s.slug && x.title.toLowerCase() === name.toLowerCase());
    const f = { id: seq++, slug, name, active: true, order: s.formFields.length + 1, source: fromSuggestion ? "member" : "admin", pluginName: "" };
    s.formFields.push(f);
    s.robots = [...(s.robots || []), { slug, name }];
    s.fields = [...(s.fields || []), { id: slug, title: name, html: fromSuggestion ? fromSuggestion.html : `<p>${name} in ${s.name}.</p>`, ...(fromSuggestion ? { source: "suggested" } : {}) }];
    log(actor.name, "Admin", "fields", `${s.name} · ${name}`, fromSuggestion ? `Approved the suggested field "${name}" (suggested by ${fromSuggestion.by})` : `Added the field "${name}"`);
    return Promise.resolve({ success: true, robot: { id: f.id, slug, name, active: true, order: f.order } });
  }
  function changeField(actor, sector, id, change) {
    const s = sectorOf(sector);
    const list = s ? s.formFields.slice().sort((a, b) => a.order - b.order) : [];
    const f = list.find((x) => String(x.id) === String(id));
    if (!actor.isAdmin) throw new ApiError(403, "FORBIDDEN", "You do not have access to this.");
    if (!f) throw new ApiError(404, "NOT_FOUND", "We could not find that field.");
    if (typeof change.name === "string") { log(actor.name, "Admin", "fields", `${s.name} · ${f.name}`, `Renamed to "${change.name.trim()}"`); f.name = change.name.trim(); }
    if (typeof change.active === "boolean") { f.active = change.active; log(actor.name, "Admin", "fields", `${s.name} · ${f.name}`, change.active ? "Shown on the form again" : "Hidden from the form"); }
    if (change.move === "up" || change.move === "down") {
      const i = list.indexOf(f), j = change.move === "up" ? i - 1 : i + 1;
      if (j >= 0 && j < list.length) { const o = list[j].order; list[j].order = f.order; f.order = o; }
    }
    s.robots = s.formFields.filter((x) => x.active).sort((a, b) => a.order - b.order).map((x) => ({ slug: x.slug, name: x.name })); // the form offers the active ones, in order
    return Promise.resolve({ success: true });
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
    const sectors = mock.sectors.map((s) => { const c = { slug: s.slug, name: s.name, active: true, ...zero() }; live().filter((x) => x.sector === s.slug).forEach((x) => add(c, x)); return c; });
    const sum = zero(); sectors.forEach((c) => keys.forEach((k) => { sum[k] += c[k]; }));
    const unique = zero(); live().forEach((x) => add(unique, x));
    return { sectors, sum, unique };
  }
  const formItem = (id) => forms.find((x) => x.id === Number(id)) || null;

  /** The adapter of one role, like the app's: the workflow's own calls plus the portal's. */
  function as(role) {
    const base = mock.as(role), actor = { name: role === "admin" ? mock.actors.admin : mock.actors.moderator, isAdmin: role === "admin" };
    return {
      ...base,
      portal: (view, o) => portal(actor, view, o),
      formDecision: (id, action, note) => formDecision(actor, id, action, note),
      sectorForms: (sector) => sectorForms(actor, sector),
      addField: (sector, body) => addField(actor, sector, body),
      changeField: (sector, id, change) => changeField(actor, sector, id, change),
      auditLog: (q) => auditLog(actor, q),
      sectorCounts: () => sectorCounts(),
      mine: () => mock.mine({ name: actor.name, type: role === "admin" ? "Administrator" : "Moderator", minor: false }),
    };
  }
  return { as, formItem, forms, suggestions: sugg, formDecision, counts };
}
