// Contribution workflow: the rules. ONE copy, imported by the app's server (src/lib/cw) AND by the browser (the demo's mock data
// adapter), so the status machine, the validation messages and the history wording can never differ between them.
import {
  ATTACHMENT_TYPES, CATEGORIES, EARN, FEATURES, FIELDS, FIELD_LABELS, KINDS, LEVELS, LIMITS, MESSAGES, NEW_IDEA, NOT_SURE, NOT_SURE_LABEL,
  PATHS, PUBLIC_NAME_DISPLAY, RESOURCE_TYPES, STATUS,
} from "./lists.js";

const S = STATUS;

/** lower case, "&" -> "and", every run of other characters -> "-", no "-" at either end (the demo's slug). */
export const slug = (s) => String(s ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const isUrl = (u) => /^https?:\/\/\S+$/i.test(String(u ?? ""));

/** Resource ID: RESOURCE_TYPES[type] + " · " + slug(the last part of the path after the final "›"). Empty path -> "". */
export function resourceId(type, path) {
  const last = String(path ?? "").split("›").pop().trim();
  if (!last || !RESOURCE_TYPES[type]) return "";
  return `${RESOURCE_TYPES[type]} · ${slug(last)}`;
}

/** Does the form show the resource box? Always for a change to something existing; for a new idea only when the box is ticked. */
export const showsResource = (kind, refers) => kind !== NEW_IDEA || refers === true;

const str = (v) => (typeof v === "string" ? v.trim() : "");
const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean) : []);
const uniq = (a) => Array.from(new Set(a));

/** The Earn (18+) path is never allowed on a minor's idea (the contributor's users.age_category at submission time). */
export const earnBlocked = (minor, path) => minor === true && path === EARN;

/**
 * Checks a submission exactly as the demo does (all errors together, in this order), then the limits and lists.
 * `sectors`: [{ slug, name, robots: [{ slug, name }] }] from Sector Forms; `minor`: the contributor is under 18 (from the profile).
 * Returns { errors: string[], value } where value is clean.
 */
export function validateSubmission(input, { sectors = [], name = "", minor = false } = {}) {
  const i = input && typeof input === "object" ? input : {};
  const kind = KINDS.includes(i.kind) ? i.kind : "";
  const refers = i.refers === true;
  const withResource = showsResource(kind || NEW_IDEA, refers);
  const r = i.resource && typeof i.resource === "object" ? i.resource : {};
  const resource = withResource ? {
    feature: str(r.feature), type: str(r.type), path: str(r.path), url: str(r.url), change: str(r.change),
  } : null;
  if (resource) resource.id = resourceId(resource.type, resource.path);
  const references = (Array.isArray(i.references) ? i.references : [])
    .map((x) => ({ url: str(x && x.url), remarks: str(x && x.remarks) }))
    .filter((x) => x.url || x.remarks);
  const value = {
    kind, resource, references,
    title: str(i.title), description: str(i.description),
    sector: str(i.sector) || NOT_SURE, robotType: str(i.robotType) || NOT_SURE,
    categories: uniq(strList(i.categories)), suitableFor: uniq(strList(i.suitableFor)), learningPath: str(i.learningPath),
  };

  const errors = [];
  if (!str(name) || !value.title || !value.description) errors.push(MESSAGES.required);
  if (resource && !resource.path) errors.push(MESSAGES.resourcePath);
  if (resource && resource.url && !isUrl(resource.url)) errors.push(MESSAGES.resourceUrl);
  if (kind !== NEW_IDEA && resource && !resource.change) errors.push(MESSAGES.change);
  if (references.some((x) => !x.url)) errors.push(MESSAGES.refRemark);
  if (references.some((x) => x.url && !isUrl(x.url))) errors.push(MESSAGES.refUrl);

  const long = value.title.length > LIMITS.title || value.description.length > LIMITS.description
    || (resource && (resource.change.length > LIMITS.change || resource.path.length > LIMITS.path || resource.url.length > LIMITS.url))
    || references.some((x) => x.remarks.length > LIMITS.remark || x.url.length > LIMITS.url);
  if (long) errors.push(MESSAGES.tooLong);
  if (references.length > LIMITS.references) errors.push(MESSAGES.tooManyRefs);
  if (!kind || badChoice(value, sectors) || (resource && (!FEATURES.includes(resource.feature) || !RESOURCE_TYPES[resource.type]))) errors.push(MESSAGES.badChoice);
  if (earnBlocked(minor, value.learningPath)) errors.push(MESSAGES.earnMinor);
  return { errors, value };
}

function badChoice(v, sectors) {
  if (v.categories.some((c) => !CATEGORIES.includes(c))) return true;
  if (v.suitableFor.some((c) => !LEVELS.includes(c))) return true;
  if (v.learningPath && !PATHS.includes(v.learningPath)) return true;
  if (v.sector === NOT_SURE) return v.robotType !== NOT_SURE;
  const s = sectors.find((x) => x.slug === v.sector);
  if (!s) return true;
  return v.robotType !== NOT_SURE && !(s.robots || []).some((r) => r.slug === v.robotType);
}

/** The proposed version the Moderator sends: title present, description at least 20 characters, at least one category. */
export function validateSend(p) {
  if (!str(p.title) || str(p.description).length < LIMITS.sendDescriptionMin) return MESSAGES.sendLength;
  if (!strList(p.categories).length) return MESSAGES.sendCategory;
  return null;
}

/** Cleans a proposed version sent by a Moderator (same shape as the original). `minor`: the contributor is under 18. Returns { error, value }. */
export function cleanProposed(input, { sectors = [], minor = false } = {}) {
  const i = input && typeof input === "object" ? input : {};
  const value = {
    title: str(i.title), description: str(i.description), sector: str(i.sector) || NOT_SURE, robotType: str(i.robotType) || NOT_SURE,
    categories: uniq(strList(i.categories)), suitableFor: uniq(strList(i.suitableFor)), learningPath: str(i.learningPath),
  };
  if (value.title.length > LIMITS.title || value.description.length > LIMITS.description) return { error: MESSAGES.tooLong, value };
  if (badChoice(value, sectors)) return { error: MESSAGES.badChoice, value };
  if (earnBlocked(minor, value.learningPath)) return { error: MESSAGES.earnMinorReview, value };
  return { error: null, value };
}

/** Two field values are the same (lists compare by their items, in order). */
export const sameValue = (a, b) => JSON.stringify(a ?? "") === JSON.stringify(b ?? "");
/** The labels of the fields that differ between two versions (Title, Description, ...). */
export const changedFields = (now, base) => FIELDS.filter((f) => !sameValue(now[f], base[f])).map((f) => FIELD_LABELS[f]);
export const isModified = (c) => changedFields(c.proposed, c.original).length > 0;

// ---------------------------------------------------------------- the status machine (spec section 5)
// Spec section 15, decided by the owner (27-11-2026):
//   * Unpublish: Admin only, from Published -> Unpublished (the public card is removed). Publishing again is the normal flow (preview,
//     then publish) and updates the same card.
//   * Edit after publishing: the Admin's "Edit Before Publishing" also works on Published and Unpublished items. It makes a new version
//     that needs a new preview; the live card changes only when the Admin publishes again.
//   * No appeal by contributors after Rejected (they can always share a new idea). The Admin may Reopen a Rejected item (reason
//     required) -> Under Moderator Review. This also reverses a Moderator's decline, which Admins see in the Rejected filter.
//   * Earn (18+) is never allowed on a minor's idea: not in the form, not by the Moderator, not published by the Admin.
//   * Admins edit Title and Description only, as in the demo.
export const MOD_EDITABLE = [S.SUBMITTED, S.REVIEW, S.DRAFT, S.CHANGES];
export const ADMIN_ACTIONABLE = [S.PENDING, S.RESUBMITTED, S.FAILED];
export const AFTER_PUBLISHING = [S.PUBLISHED, S.UNPUBLISHED];
export const canModeratorEdit = (status) => MOD_EDITABLE.includes(status);
export const canAdminAct = (status) => ADMIN_ACTIONABLE.includes(status);
/** May the Admin preview and publish now? A request (Pending, Resubmitted, Failed), an Unpublished item, or a Published item whose
 *  current version is newer than the one on the live card. */
export function canPublishNext(status, versions, publishedVersion) {
  if (canAdminAct(status) || status === S.UNPUBLISHED) return true;
  return status === S.PUBLISHED && (Number(versions) || 0) > (Number(publishedVersion) || 0);
}
export const ADMIN_ACTIONS = ["preview", "admin_edit", "request_changes", "reject", "publish", "unpublish", "reopen"];
export const MODERATOR_ACTIONS = ["open", "save_draft", "reset", "send_request", "decline"];
export const WORKSPACE_ACTIONS = MODERATOR_ACTIONS; // the same list, named after the workspace

/**
 * The ONE transition function. `c` = { status, versions, publishedVersion, live }: versions = number of versions so far,
 * publishedVersion = the version on the live card (if any), live = a public card exists (used by "publish_fail" only).
 * Returns { ok: true, to } or { ok: false }. Every transition not listed is refused.
 */
export function nextStatus(action, c) {
  const st = c.status, versions = Number(c.versions) || 0, next = canPublishNext(st, versions, c.publishedVersion);
  const ok = (to) => ({ ok: true, to }), no = { ok: false };
  switch (action) {
    case "open": return st === S.SUBMITTED ? ok(S.REVIEW) : ok(st); // only the first open of a Submitted item changes it
    case "save_draft": return st === S.CHANGES ? ok(S.CHANGES) : [S.SUBMITTED, S.REVIEW, S.DRAFT].includes(st) ? ok(S.DRAFT) : no;
    case "reset": return canModeratorEdit(st) ? ok(st) : no;
    case "send_request":
      if (st === S.CHANGES) return ok(S.RESUBMITTED);
      if ([S.SUBMITTED, S.REVIEW, S.DRAFT].includes(st)) return ok(versions > 0 ? S.RESUBMITTED : S.PENDING);
      return no;
    case "decline": return canModeratorEdit(st) ? ok(S.REJECTED) : no;
    case "preview": return next && versions > 0 ? ok(st) : no;
    case "admin_edit": return (canAdminAct(st) || AFTER_PUBLISHING.includes(st)) && versions > 0 ? ok(st) : no;
    case "request_changes": return canAdminAct(st) ? ok(S.CHANGES) : no;
    case "reject": return canAdminAct(st) ? ok(S.REJECTED) : no;
    case "publish": return next ? ok(S.PUBLISHING) : no;
    case "publish_ok": return st === S.PUBLISHING ? ok(S.PUBLISHED) : no;
    // a failed attempt: back to Published when the earlier card is still live (a failed update), otherwise Publication Failed
    case "publish_fail": return st === S.PUBLISHING ? ok(c.live === true ? S.PUBLISHED : S.FAILED) : no;
    case "unpublish": return st === S.PUBLISHED ? ok(S.UNPUBLISHED) : no;
    case "reopen": return st === S.REJECTED ? ok(S.REVIEW) : no;
    default: return no;
  }
}

// ---------------------------------------------------------------- history wording (exactly the demo's)
export const history = {
  submitted: (kind, resource, refCount) => `Submitted through the contribution form: ${kind}` + (resource ? ` on "${resource.path}"` : "")
    + (refCount ? ` with ${refCount} reference link(s)` : "") + ".",
  opened: () => "Opened the contribution and started review.",
  draft: (ch) => "Saved a draft" + (ch.length ? ` (changed: ${ch.join(", ")})` : "") + ". Not published.",
  reset: () => "Reset the working version back to the original submission.",
  sent: (resub, n, ch) => (resub ? "Resubmitted" : "Submitted") + ` publishing request to Admin (version ${n}). `
    + (ch.length ? `Edited vs original: ${ch.join(", ")}.` : "Approved as-is, no changes to the original."),
  declined: (r) => "Declined the idea. Reason: " + r,
  previewed: (n) => `Opened the publish preview for v${n}.`,
  adminEdit: (ch, n) => `Edited the proposed content (changed: ${ch.join(", ")}). Saved as v${n}; Moderator version kept.`,
  adminEditAfter: (ch, n) => `Edited the proposed content after publishing (changed: ${ch.join(", ")}). Saved as v${n}; the public card changes only when it is published again.`,
  unpublished: () => "Unpublished: removed the card from the public website. It can be published again (preview, then publish).",
  reopened: (r) => "Reopened the idea for Moderator review. Reason: " + r,
  changes: (r) => "Requested changes: " + r,
  rejected: (r) => "Rejected the publishing request. Reason: " + r,
  publishClick: (n) => `Clicked Publish (attempt ${n}).`,
  published: (n, sectorName) => `Published v${n} to the public "${sectorName}" section, refreshed the page and verified it shows the approved content.`,
  failed: (err) => "Publication FAILED: " + err + " Public website unchanged.",
};

// ---------------------------------------------------------------- the public card record (shared by the preview and the live site)
export const firstNameOf = (full) => String(full ?? "").trim().split(/\s+/)[0] || "";

/** The contributor as the public sees them: first name and type, or first name only (always for minors). */
export function publicContributor(first, typeLabel, minor, mode = PUBLIC_NAME_DISPLAY) {
  const showType = mode === "first-name-and-type" && !minor && Boolean(typeLabel);
  return { name: first, type: showType ? typeLabel : "" };
}

export const sectorLabel = (slugValue, sectors) => (slugValue === NOT_SURE || !slugValue ? NOT_SURE_LABEL : ((sectors || []).find((s) => s.slug === slugValue) || {}).name || slugValue);
export function robotLabel(sectorSlug, robotSlug, sectors) {
  if (!robotSlug || robotSlug === NOT_SURE) return NOT_SURE_LABEL;
  const s = (sectors || []).find((x) => x.slug === sectorSlug);
  return ((s && s.robots) || []).find((r) => r.slug === robotSlug)?.name || robotSlug;
}

/**
 * What the public website shows for a contribution, built from the APPROVED (proposed) version only: never notes, history, feedback,
 * drafts or the contributor's full name. Used for the Publish Preview and for the public record, so they cannot differ.
 */
export function toPublicRecord(c, { sectors = [], mode = PUBLIC_NAME_DISPLAY, publishedAt = null, version = null } = {}) {
  const p = c.proposed;
  return {
    id: c.id, code: c.code, version: version ?? c.version ?? null,
    title: p.title, description: p.description,
    sector: p.sector || NOT_SURE, sectorName: sectorLabel(p.sector, sectors), robotTypeName: robotLabel(p.sector, p.robotType, sectors),
    categories: [...(p.categories || [])], suitableFor: [...(p.suitableFor || [])], learningPath: p.learningPath || "",
    kind: c.kind, resource: c.resource ? { path: c.resource.path, url: c.resource.url || "" } : null,
    references: (c.references || []).map((r) => ({ url: r.url, remarks: r.remarks || "" })),
    contributor: publicContributor(c.contributor.firstName ?? firstNameOf(c.contributor.name), c.contributor.typeLabel, c.contributor.minor, mode),
    publishedAt,
  };
}

/** The "Idea by ..." line of the card. */
export const ideaBy = (contributor) => `Idea by ${contributor.name}` + (contributor.type ? ` (${contributor.type})` : "");

/** Checks the real type of an uploaded file from its first bytes (never from its name or the browser's word). */
export function sniffType(bytes) {
  const b = bytes || [];
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "application/pdf";
  return null;
}
export const attachmentAllowed = (mime) => ATTACHMENT_TYPES.includes(mime);
export const codeOf = (id) => `RV-${id}`;
