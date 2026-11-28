// Contribution Portal: the extra step on top of the workflow's ONE transition function (rules.js nextStatus, which the WordPress plugin
// bundles too and so stays exactly as it is). With migration 030 a Moderator's approval is its own step:
//   approve        a Moderator approves an idea, as it is or edited: Submitted / Under review / Draft / Changes requested -> Approved
//   send_request   from Approved: the publishing request goes to an Admin -> Pending Admin Approval (Resubmitted after an earlier
//                  version), exactly as rules.js sends one from the review states (that one-step path stays allowed)
//   save_draft / reset   from Approved: back to the Moderator's draft (the approval is undone)
//   decline        from Approved: Rejected (with the reason)
// Only Admins publish; Approved is never public. Every other action and status is rules.js's own answer. The app's server
// (src/lib/cw/store.ts) and the demo's in-memory data (demo-portal.js) both ask this function, so they cannot disagree.
import { mineStatus, nextStatus } from "./rules.js";
import { MINE_LABEL, STATUS } from "./lists.js";

export const APPROVED = "approved";
export const APPROVED_LABEL = "Approved by Moderator";
/** The actions this module adds to the Moderator's list (rules.js MODERATOR_ACTIONS). */
export const PORTAL_ACTIONS = ["approve"];
const FROM_REVIEW = [STATUS.SUBMITTED, STATUS.REVIEW, STATUS.DRAFT, STATUS.CHANGES];

/** May a Moderator approve an idea in this status? */
export const canApprove = (status) => FROM_REVIEW.includes(status);

/** rules.js nextStatus, plus the Approved step. c = { status, versions, publishedVersion, live }. */
export function portalNextStatus(action, c) {
  const st = c.status, versions = Number(c.versions) || 0;
  const ok = (to) => ({ ok: true, to }), no = { ok: false };
  if (action === "approve") return canApprove(st) ? ok(APPROVED) : no;
  if (st === APPROVED) {
    switch (action) {
      case "open": return ok(APPROVED);
      case "send_request": return ok(versions > 0 ? STATUS.RESUBMITTED : STATUS.PENDING);
      case "save_draft":
      case "reset": return ok(STATUS.DRAFT);
      case "decline": return ok(STATUS.REJECTED);
      default: return no;
    }
  }
  return nextStatus(action, c);
}

/** The history line of an approval (rules.js history has the rest). `changed`: the labels of the fields that differ from the original. */
export const portalHistory = {
  approved: (changed) => (changed.length
    ? `Approved with edits (changed: ${changed.join(", ")}). The publishing request to an Admin is sent separately.`
    : "Approved as-is, no changes to the original. The publishing request to an Admin is sent separately."),
};

/** "My Contributions": what a member sees (rules.js mineStatus), with the Approved step shown as "Approved" too. */
export const portalMineStatus = (source, status) => (source === "workflow" && status === APPROVED ? { key: "approved", label: MINE_LABEL.approved } : mineStatus(source, status));

/** The internal label of a status, Approved included (lists.js STATUS_LABEL has the rest). */
export const portalStatusLabel = (status, labels = {}) => (status === APPROVED ? APPROVED_LABEL : labels[status] ?? String(status));
