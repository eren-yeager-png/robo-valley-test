// Contribution Portal: the ONE status model every portal screen shows (Moderation, Publish Requests, the Admin's Overview, Sector
// Forms' suggestions, My Contributions in the demo), for BOTH kinds of contributions: ideas sent with "Share Your Idea" (the workflow,
// public/cw/js/rules.js) and items sent with the current form (src/lib/reviewStatus.ts). No DOM: the app's server imports it too, so
// the numbers on a sector card and the rows below it can never disagree.
//
//   submitted -> pending review -> approved (or edited + approved) -> publish requested -> published;   side state: rejected (reason)
//
// The stored statuses do not change. Until the separate "approved" step exists in the database, a Moderator's approval sends the
// publishing request at once (the workflow's send_request), so "approved" is shown only where a status says so.

/** The five portal statuses and two side states, in the order the tabs and the badges use. Colours: public/cw/portal.css. */
export const PORTAL_STATUS = {
  pending: { label: "Pending review", tone: "amber" },
  approved: { label: "Approved", tone: "blue" },
  requested: { label: "Publish requested", tone: "purple" },
  published: { label: "Published", tone: "green" },
  rejected: { label: "Rejected", tone: "red" },
  unpublished: { label: "Unpublished", tone: "grey" },
  draft: { label: "Draft", tone: "grey" },
};
export const PORTAL_KEYS = Object.keys(PORTAL_STATUS);

/** A "Share Your Idea" idea's stored status -> the portal status. */
export const WORKFLOW_TO_PORTAL = {
  submitted: "pending", under_review: "pending", draft: "pending", changes_requested: "pending",
  approved: "approved",
  pending: "requested", resubmitted: "requested", publishing: "requested", failed: "requested",
  published: "published", rejected: "rejected", unpublished: "unpublished",
};
/** The extra words under a badge when the stored status says more than the portal status. */
export const WORKFLOW_NOTE = {
  draft: "Moderator draft saved", changes_requested: "Sent back by an Admin", resubmitted: "Sent again after changes",
  publishing: "Publishing now", failed: "The last publish attempt failed",
};

/** A current-form item's stored status (and whether a reviewer verified it in this review round) -> the portal status. */
export function formToPortal(status, verified = false) {
  switch (status) {
    case "pending_review": return verified ? "requested" : "pending";
    case "changes_requested": return "pending";
    case "published": return "published";
    case "rejected": return "rejected";
    case "unpublished": return "unpublished";
    case "draft": return "draft";
    default: return null; // removed (final) and anything unknown: never listed
  }
}
export const FORM_NOTE = { changes_requested: "Changes asked from the contributor" };

export const workflowToPortal = (status) => WORKFLOW_TO_PORTAL[status] || "pending";
export const portalLabel = (key) => (PORTAL_STATUS[key] || PORTAL_STATUS.pending).label;

/** The Moderation tabs: "Approved" holds everything a Moderator has approved that is not public yet. */
export const MODERATION_TABS = [
  ["all", "All", null],
  ["pending", "Pending review", ["pending"]],
  ["approved", "Approved", ["approved", "requested"]],
  ["rejected", "Rejected", ["rejected"]],
  ["published", "Published", ["published", "unpublished"]],
];
/** The Publish Requests tabs (the Admin's queue first). */
export const REQUEST_TABS = [
  ["awaiting", "Awaiting me", ["requested"]],
  ["published", "Published", ["published"]],
  ["rejected", "Rejected", ["rejected"]],
  ["unpublished", "Unpublished", ["unpublished"]],
  ["all", "All", null],
];
export const inTab = (tabs, tab, key) => {
  const t = tabs.find((x) => x[0] === tab) || tabs[0];
  return !t[2] || t[2].includes(key);
};
/** Tab counts for a list of rows that carry `display` (a portal status key). */
export function tabCounts(tabs, rows) {
  const out = {};
  for (const [k, , keys] of tabs) out[k] = rows.filter((r) => !keys || keys.includes(r.display)).length;
  return out;
}
