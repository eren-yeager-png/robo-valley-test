// Contribution Publishing Workflow: master lists, statuses, labels, limits and messages.
// ONE copy. The same file is used by the WordPress plugin (a byte-identical copy), the admin portal, the standalone demo and the app's
// server (validation and history wording), so every place shows the same words. Plain JavaScript, no framework.

export const KINDS = ["New idea", "Modification", "Suggestion", "Enhancement of existing feature"];
export const NEW_IDEA = "New idea";
export const FEATURES = ["Robots by Sector", "STEAM Kits", "Projects", "Services", "Events", "RoboValley Directory", "Other"];
export const RESOURCE_TYPES = {
  "Robot type": "rv_robot_type", "Sector page": "rv_sector", "Kit": "rv_kit", "Project": "rv_project", "Event": "rv_event",
  "Service": "rv_service", "Image or video": "rv_media", "Document or guide": "rv_document", "Button or section on a page": "rv_page_section",
};
export const CATEGORIES = ["STEAM", "Robotics", "Physical AI and AI", "Re-engineering"];
export const LEVELS = ["K1–K5", "K6–K8", "K9–K10", "K11–K12", "ITI", "Diploma", "Engineering", "Advanced", "Not sure"];
export const PATHS = ["Learn", "Make", "Present", "Earn (18+)", "Build", "Not sure"];

// Sectors and robot types come from Sector Forms (the app's database). "Not sure" is always offered as well.
export const NOT_SURE = "not-sure";
export const NOT_SURE_LABEL = "Not sure";
export const OTHER_IDEAS = "Other ideas"; // the public heading for "Not sure"

// Who is shown on the public card. "first-name-and-type" (default) or "first-name". Minors are ALWAYS shown by first name only.
export const PUBLIC_NAME_DISPLAY = "first-name-and-type";

export const STATUS = {
  SUBMITTED: "submitted", REVIEW: "under_review", DRAFT: "draft", PENDING: "pending", CHANGES: "changes_requested",
  RESUBMITTED: "resubmitted", PUBLISHING: "publishing", PUBLISHED: "published", FAILED: "failed", REJECTED: "rejected",
};
export const STATUS_LABEL = {
  submitted: "Submitted", under_review: "Under Moderator Review", draft: "Moderator Draft", pending: "Pending Admin Approval",
  changes_requested: "Changes Requested", resubmitted: "Resubmitted for Approval", publishing: "Publication In Progress",
  published: "Published", failed: "Publication Failed", rejected: "Rejected",
};
export const STATUS_CLASS = {
  submitted: "rv-s-submitted", under_review: "rv-s-review", draft: "rv-s-draft", pending: "rv-s-pending", changes_requested: "rv-s-changes",
  resubmitted: "rv-s-pending", publishing: "rv-s-publishing", published: "rv-s-published", failed: "rv-s-failed", rejected: "rv-s-rejected",
};
// What a contributor sees in "My contributions" (the internal steps are not theirs to follow).
export const CONTRIBUTOR_STATUS_LABEL = {
  submitted: "Submitted", under_review: "In review", draft: "In review", pending: "In review", changes_requested: "In review",
  resubmitted: "In review", publishing: "In review", failed: "In review", published: "Published", rejected: "Not accepted",
};

export const FIELDS = ["title", "description", "sector", "robotType", "categories", "suitableFor", "learningPath"];
export const FIELD_LABELS = {
  title: "Title", description: "Description", sector: "Sector", robotType: "Robot type",
  categories: "Category", suitableFor: "Suitable for", learningPath: "Suggested path",
};

const S = STATUS;
export const MOD_FILTERS = {
  "Open": [S.SUBMITTED, S.REVIEW, S.DRAFT, S.CHANGES],
  "Awaiting Admin": [S.PENDING, S.RESUBMITTED, S.PUBLISHING, S.FAILED],
  "Changes Requested": [S.CHANGES],
  "Decided": [S.PUBLISHED, S.REJECTED],
  "All": null,
};
export const ADM_FILTERS = {
  "Awaiting me": [S.PENDING, S.RESUBMITTED, S.FAILED],
  "With Moderators": [S.SUBMITTED, S.REVIEW, S.DRAFT],
  "Changes Requested": [S.CHANGES],
  "Published": [S.PUBLISHED],
  "Rejected": [S.REJECTED],
  "All": null,
};

export const LIMITS = {
  title: 150, description: 3000, notes: 2000, remark: 200, url: 2048, path: 300, change: 2000, references: 10, reason: 2000,
  sendDescriptionMin: 20, attachmentBytes: 4 * 1024 * 1024, fileName: 200,
  perDay: 10, duplicateMinutes: 10, // spam protection: ideas per member per 24 hours; the same title again within this many minutes
};
export const ATTACHMENT_TYPES = ["image/jpeg", "image/png", "application/pdf"];

export const MESSAGES = {
  // the contribution form (exact wording from the demo / spec)
  required: "Please fill in your name, idea title and description.",
  resourcePath: "Add the resource path of the RoboValley page or item you are referring to.",
  resourceUrl: "The link to that page must start with http:// or https://.",
  change: "Say what should change.",
  refRemark: "Each reference remark needs a link.",
  refUrl: "Reference links must start with http:// or https://.",
  // our additions (limits and lists the server checks too)
  tooLong: "Some answers are too long. Title: 150 characters, description: 3000, what should change: 2000, each remark: 200.",
  badChoice: "Please choose from the lists shown.",
  tooManyRefs: "Add at most 10 reference links.",
  attachmentType: "The attachment must be a JPEG or PNG image, or a PDF.",
  attachmentSize: "The attachment must be 4 MB or smaller.",
  // the Moderator Workspace
  sendLength: "Title is required and description must be at least 20 characters.",
  sendCategory: "Pick at least one category before sending to Admin.",
  draftSaved: "Draft saved. Nothing has been published.",
  reasonRequired: "Please write a reason.",
  // the Admin Approval Dashboard
  previewFirst: "Open the publish preview first.",
  previewNotice: "Open the publish preview to see exactly how this will look on the website. Publishing is enabled after you review it.",
  previewDone: "✔ You have reviewed the publish preview for this version.",
  popupBlocked: "Your browser blocked the new tab. Use Download instead.",
  stale: "Someone else changed this contribution a moment ago. It has been reloaded; please check it and try again.",
  notAllowed: "This action is not available for this contribution right now.",
  adminOnly: "Only an administrator can do that.",
  // the public website
  publicEmpty: "No contributions have been published yet. Moderator drafts and pending requests are never shown here.",
  // general
  signIn: "Please sign in with your RoboValley member account to share an idea.",
  dailyLimit: "You have shared many ideas today. Please try again tomorrow.",
  duplicate: "You sent this idea a moment ago. It is already with the reviewers.",
  reviewerCannot: "Administrators and moderators review contributions. Please use a member account to share an idea.",
  failed: "Something went wrong. Nothing was changed. Please try again.",
};
