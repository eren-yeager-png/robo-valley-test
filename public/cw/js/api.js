// Contribution workflow: the data adapters. Every screen talks to ONE interface:
//   formConfig() me() submit(data, file) mine() loginUrl(returnTo)
//   list(view, filter) detail(id) act(id, action, payload) publish(id, payload) attachmentUrl(id) publicList()
// RestAdapter = production (the app's REST API, credentials included). MockAdapter = in memory, used only by the standalone demo file;
// it applies the SAME rules (rules.js) as the server, so the demo behaves like production.
import * as R from "./rules.js";
import { ADM_FILTERS, CONTRIBUTOR_STATUS_LABEL, MESSAGES, MOD_FILTERS, STATUS, STATUS_LABEL } from "./lists.js";

export class ApiError extends Error {
  constructor(status, error, message) { super(message || MESSAGES.failed); this.status = status; this.error = error || "ERROR"; }
}

// ------------------------------------------------------------------------------------------------ RestAdapter (production)
export class RestAdapter {
  constructor(base = "") { this.base = String(base || "").replace(/\/+$/, ""); }
  async call(path, opts = {}) {
    let res;
    try {
      res = await fetch(this.base + path, { credentials: "include", cache: "no-store", ...opts });
    } catch {
      throw new ApiError(0, "NETWORK", MESSAGES.failed);
    }
    let body = {};
    try { body = await res.json(); } catch { /* not JSON */ }
    if (!res.ok || body.success === false) throw new ApiError(res.status, body.error, body.message);
    return body;
  }
  post(path, payload) { return this.call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }
  loginUrl(returnTo) { return `${this.base}/login?returnTo=${encodeURIComponent(returnTo)}`; }
  formConfig() { return this.call("/api/cw/form-config"); }
  me() { return this.call("/api/cw/me"); }
  submit(data, file) {
    const fd = new FormData();
    fd.append("data", JSON.stringify(data));
    if (file) fd.append("attachment", file, file.name);
    return this.call("/api/cw/contributions", { method: "POST", body: fd });
  }
  mine() { return this.call("/api/cw/mine"); }
  list(view, filter) { return this.call(`/api/cw/review?view=${encodeURIComponent(view)}&filter=${encodeURIComponent(filter)}`); }
  detail(id) { return this.call(`/api/cw/review/${encodeURIComponent(id)}`); }
  act(id, action, payload = {}) { return this.post(`/api/cw/review/${encodeURIComponent(id)}`, { ...payload, action }); }
  publish(id, payload = {}) { return this.post(`/api/cw/review/${encodeURIComponent(id)}`, { ...payload, action: "publish" }); }
  attachmentUrl(id) { return `${this.base}/api/cw/review/${encodeURIComponent(id)}/attachment`; }
  publicList() { return this.call("/api/cw/public"); }
}

// ------------------------------------------------------------------------------------------------ MockAdapter (demo only)
const clone = (v) => JSON.parse(JSON.stringify(v));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const stale = () => new ApiError(409, "STALE", MESSAGES.stale);

export class MockAdapter {
  /**
   * sectors: [{ slug, name, robots: [{ slug, name }] }]; me: { name, type, minor };
   * actors: { moderator: "Name", admin: "Name" }; earlier: number of older (old form) contributions still open.
   */
  constructor({ sectors = [], me = { name: "Ananya R.", type: "Student", minor: false }, actors = { moderator: "Moderator User", admin: "Admin User" }, earlier = 0, publishDelay = 900 } = {}) {
    this.sectors = clone(sectors);
    this.meInfo = clone(me);
    this.actors = actors;
    this.earlier = earlier;
    this.publishDelay = publishDelay;
    this.items = [];
    this.public = new Map(); // keyed by contribution id: a retry never makes a second card
    this.seq = 1025;
    this.failNext = false; // demo only: the next publish attempt fails (to try error handling and safe retry)
  }
  now() { return new Date().toISOString(); }
  find(id) { const it = this.items.find((x) => x.id === Number(id)); if (!it) throw new ApiError(404, "NOT_FOUND", "We could not find that contribution."); return it; }
  log(it, actor, text) { it.history.push({ actor, text, at: this.now() }); }

  // ---- contributor
  loginUrl() { return "#"; }
  async formConfig() { return { sectors: clone(this.sectors) }; }
  async me() { return { signedIn: true, name: this.meInfo.name, type: this.meInfo.type, reviewer: false }; }
  async submit(data, file, who = this.meInfo) {
    const { errors, value } = R.validateSubmission(data, { sectors: this.sectors, name: who.name });
    if (file) {
      if (file.size > 4 * 1024 * 1024) errors.push(MESSAGES.attachmentSize);
      else if (!R.attachmentAllowed(file.type)) errors.push(MESSAGES.attachmentType);
    }
    if (errors.length) throw new ApiError(400, "VALIDATION_FAILED", errors.join("\n"));
    const id = this.seq++;
    const original = { title: value.title, description: value.description, sector: value.sector, robotType: value.robotType, categories: value.categories, suitableFor: value.suitableFor, learningPath: value.learningPath };
    const it = {
      id, code: R.codeOf(id), status: STATUS.SUBMITTED, statusLabel: STATUS_LABEL.submitted, kind: value.kind,
      contributor: { name: who.name, firstName: R.firstNameOf(who.name), typeCode: "", typeLabel: who.type, minor: who.minor === true },
      submittedAt: this.now(), resource: value.resource ? Object.freeze({ ...value.resource }) : null,
      references: Object.freeze(value.references.map((r) => Object.freeze({ ...r }))), original: Object.freeze(clone(original)),
      proposed: clone(original), notes: "", moderator: null, previewedVersion: null, publishedVersion: null, publishedAt: null,
      publishError: null, publishAttempts: 0, rowVersion: 1, versions: [], feedback: [], history: [],
      attachment: file ? { name: file.name, mime: file.type, size: file.size } : null, mine: who === this.meInfo,
    };
    this.log(it, `${who.name} (${who.type})`, R.history.submitted(value.kind, value.resource, value.references.length));
    this.items.unshift(it);
    return { id, code: it.code, kind: value.kind };
  }
  async mine() {
    return { items: this.items.filter((x) => x.mine).map((x) => ({ id: x.id, code: x.code, kind: x.kind, title: x.original.title, status: x.status, statusLabel: CONTRIBUTOR_STATUS_LABEL[x.status], submittedAt: x.submittedAt, publishedAt: x.publishedAt })) };
  }

  // ---- reviewers: a view of the mock acting as one person
  as(role) {
    const self = this, actor = { name: role === "admin" ? this.actors.admin : this.actors.moderator, isAdmin: role === "admin" };
    return {
      loginUrl: () => "#",
      list: (view, filter) => self.list(view, filter),
      detail: (id) => self.detail(id),
      act: (id, action, payload) => self.act(actor, id, action, payload),
      publish: (id, payload) => self.publish(actor, id, payload),
      attachmentUrl: (id) => self.attachmentUrl(id),
      publicList: () => self.publicList(),
      formConfig: () => self.formConfig(),
      mock: self,
    };
  }
  async list(view, filter) {
    const filters = view === "admin" ? ADM_FILTERS : MOD_FILTERS;
    const statuses = Object.prototype.hasOwnProperty.call(filters, filter) ? filters[filter] : filters[Object.keys(filters)[0]];
    const items = this.items.filter((x) => !statuses || statuses.includes(x.status)).map((c) => ({
      id: c.id, code: c.code, status: c.status, statusLabel: STATUS_LABEL[c.status], title: c.proposed.title, kind: c.kind,
      contributorName: c.contributor.name, contributorType: c.contributor.typeLabel, sector: c.proposed.sector,
      sectorName: R.sectorLabel(c.proposed.sector, this.sectors), moderator: c.moderator,
    }));
    const counts = {
      open: this.items.filter((x) => MOD_FILTERS.Open.includes(x.status)).length,
      awaiting: this.items.filter((x) => ADM_FILTERS["Awaiting me"].includes(x.status)).length,
    };
    return { items, counts, earlier: this.earlier };
  }
  async detail(id) { return { item: clone(this.find(id)) }; }
  attachmentUrl() { return "#"; }

  async act(actor, id, action, payload = {}) {
    const it = this.find(id);
    if (R.ADMIN_ACTIONS.includes(action) && !actor.isAdmin) throw new ApiError(403, "ADMIN_ONLY", MESSAGES.adminOnly);
    if (!R.MODERATOR_ACTIONS.includes(action) && !R.ADMIN_ACTIONS.includes(action)) throw new ApiError(400, "UNKNOWN_ACTION", MESSAGES.notAllowed);
    if (action !== "open" && Number(payload.rowVersion) !== it.rowVersion) throw stale();
    const versions = it.versions.length;
    const step = R.nextStatus(action, { status: it.status, versions });
    if (!step.ok) throw new ApiError(409, "NOT_ALLOWED", MESSAGES.notAllowed);
    const bump = () => { it.rowVersion++; it.statusLabel = STATUS_LABEL[it.status]; };
    const reason = String(payload.reason ?? payload.feedback ?? "").trim();
    let message, record;
    switch (action) {
      case "open":
        if (it.status === STATUS.SUBMITTED) { it.status = step.to; it.moderator = actor.name; this.log(it, actor.name, R.history.opened()); bump(); }
        break;
      case "save_draft": {
        const { error, value } = R.cleanProposed(payload.proposed, { sectors: this.sectors });
        if (error) throw new ApiError(400, "VALIDATION_FAILED", error);
        const ch = R.changedFields(value, it.proposed);
        it.proposed = value; it.notes = String(payload.notes ?? it.notes).trim(); it.status = step.to; it.moderator = it.moderator || actor.name;
        this.log(it, actor.name, R.history.draft(ch)); bump(); message = MESSAGES.draftSaved;
        break;
      }
      case "reset":
        it.proposed = clone(it.original); this.log(it, actor.name, R.history.reset()); bump();
        break;
      case "send_request": {
        const { error, value } = R.cleanProposed(payload.proposed, { sectors: this.sectors });
        if (error) throw new ApiError(400, "VALIDATION_FAILED", error);
        const sendError = R.validateSend(value);
        if (sendError) throw new ApiError(400, "VALIDATION_FAILED", sendError);
        const resub = it.status === STATUS.CHANGES || versions > 0;
        it.proposed = value; it.notes = String(payload.notes ?? it.notes).trim();
        it.versions.push({ v: versions + 1, by: actor.name, role: "Moderator", data: clone(value), notes: it.notes, at: this.now() });
        it.status = step.to; it.previewedVersion = null; it.moderator = it.moderator || actor.name;
        this.log(it, actor.name, R.history.sent(resub, versions + 1, R.changedFields(value, it.original))); bump();
        message = `Request sent to Admin. Status: ${STATUS_LABEL[it.status]}. It is still not public.`;
        break;
      }
      case "decline": {
        if (!reason) throw new ApiError(400, "VALIDATION_FAILED", MESSAGES.reasonRequired);
        if (payload.proposed) { const pr = R.cleanProposed(payload.proposed, { sectors: this.sectors }); if (pr.error) throw new ApiError(400, "VALIDATION_FAILED", pr.error); it.proposed = pr.value; }
        if (typeof payload.notes === "string") it.notes = payload.notes.trim();
        it.status = step.to; it.feedback.push({ type: "reject", text: reason, by: actor.name, at: this.now() });
        this.log(it, actor.name, R.history.declined(reason)); bump();
        break;
      }
      case "preview":
        if (Number(payload.version) !== versions) throw stale();
        if (it.previewedVersion !== versions) { it.previewedVersion = versions; this.log(it, actor.name, R.history.previewed(versions)); bump(); }
        record = R.toPublicRecord({ ...it, version: versions }, { sectors: this.sectors, version: versions });
        break;
      case "admin_edit": {
        const title = String(payload.title ?? "").trim(), description = String(payload.description ?? "").trim();
        if (!title || !description) throw new ApiError(400, "VALIDATION_FAILED", MESSAGES.sendLength);
        const next = { ...it.proposed, title, description };
        const ch = R.changedFields(next, it.proposed);
        if (ch.length) {
          it.versions.push({ v: versions + 1, by: actor.name, role: "Admin", data: clone(next), notes: it.notes, at: this.now() });
          it.proposed = next; it.previewedVersion = null;
          this.log(it, actor.name, R.history.adminEdit(ch, versions + 1)); bump();
        }
        break;
      }
      case "request_changes":
      case "reject":
        if (!reason) throw new ApiError(400, "VALIDATION_FAILED", MESSAGES.reasonRequired);
        it.status = step.to;
        it.feedback.push({ type: action === "reject" ? "reject" : "changes", text: reason, by: actor.name, at: this.now() });
        this.log(it, actor.name, action === "reject" ? R.history.rejected(reason) : R.history.changes(reason)); bump();
        break;
      default:
        throw new ApiError(400, "UNKNOWN_ACTION", MESSAGES.notAllowed);
    }
    return { item: clone(it), ...(message ? { message } : {}), ...(record ? { record } : {}) };
  }

  async publish(actor, id, payload = {}) {
    const it = this.find(id);
    if (!actor.isAdmin) throw new ApiError(403, "ADMIN_ONLY", MESSAGES.adminOnly);
    if (Number(payload.rowVersion) !== it.rowVersion) throw stale();
    const n = it.versions.length;
    const step = R.nextStatus("publish", { status: it.status, versions: n });
    if (!step.ok) throw new ApiError(409, "NOT_ALLOWED", MESSAGES.notAllowed);
    if (n < 1 || it.previewedVersion !== n) throw new ApiError(409, "PREVIEW_FIRST", MESSAGES.previewFirst);
    it.status = STATUS.PUBLISHING; it.publishAttempts++; it.rowVersion++; it.statusLabel = STATUS_LABEL[it.status];
    this.log(it, actor.name, R.history.publishClick(it.publishAttempts));
    if (this.onChange) this.onChange();
    await wait(this.publishDelay);
    const before = this.public.get(it.id) || null;
    const rec = { ...R.toPublicRecord({ ...it, version: n }, { sectors: this.sectors, version: n }), publishedAt: this.now() };
    let error = null;
    try {
      if (this.failNext) { this.failNext = false; throw new Error("Website did not confirm the update (simulated timeout while refreshing the public page)."); }
      this.public.set(it.id, rec); // upsert by id
      const back = this.public.get(it.id);
      if (!back || back.title !== it.proposed.title || back.description !== it.proposed.description || back.version !== n) throw new Error("The public website did not show the approved content after the update.");
    } catch (e) {
      error = String(e.message);
      if (before) this.public.set(it.id, before); else this.public.delete(it.id);
    }
    if (error === null) {
      it.status = STATUS.PUBLISHED; it.publishedVersion = n; it.publishedAt = this.now(); it.publishError = null;
      this.log(it, "System", R.history.published(n, rec.sectorName));
    } else {
      it.status = STATUS.FAILED; it.publishError = error;
      this.log(it, "System", R.history.failed(error));
    }
    it.rowVersion++; it.statusLabel = STATUS_LABEL[it.status];
    return { item: clone(it), published: error === null };
  }

  async publicList() {
    return { items: Array.from(this.public.values()).sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt))).map(clone) };
  }
}
