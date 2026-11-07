// Contributions: the fixed lists and the pure validation rules (no database, no network). Part B, PR 1.
// The same limits are enforced again by CHECK constraints in db/migrations/012_contributions.sql; this file gives friendly,
// per-field messages first. The API that uses it comes in a later PR.
import { hasControlChars, type FieldErrors } from "./validation";

/** The 14 contribution types, as drawn in the wizard (id = stored value). */
export const CONTRIBUTION_TYPES = [
  { id: "problem", label: "Report a problem", group: "share" },
  { id: "discovered", label: "Share a robot you discovered", group: "share" },
  { id: "experience", label: "Share firsthand experience", group: "share" },
  { id: "costs", label: "Share costs and economics", group: "share" },
  { id: "resource", label: "Share a video or resource", group: "share" },
  { id: "challenge", label: "Propose a project challenge", group: "propose" },
  { id: "improve", label: "Suggest improvements", group: "propose" },
  { id: "rental", label: "Offer rental or shared access", group: "offer" },
  { id: "repairs", label: "Offer repairs or spare parts", group: "offer" },
  { id: "support", label: "Offer project support", group: "offer" },
  { id: "trial", label: "Offer a trial site", group: "offer" },
  { id: "learning", label: "Share learning opportunities", group: "offer" },
  { id: "supplier", label: "Add a manufacturer or supplier", group: "offer" },
  { id: "correct", label: "Correct existing information", group: "fix" },
] as const;
export type ContributionType = (typeof CONTRIBUTION_TYPES)[number]["id"];

export const CONTRIBUTION_STATUSES = ["draft", "pending_review", "changes_requested", "published"] as const;
export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number];

/** What a visitor sees for each stored status. */
export const STATUS_LABELS: Record<ContributionStatus, string> = {
  draft: "Draft",
  pending_review: "Pending review",
  changes_requested: "Changes requested",
  published: "Published",
};

/** Moves the application allows. The contributor submits (draft or changes_requested -> pending_review); a moderator decides. */
export const STATUS_TRANSITIONS: Record<ContributionStatus, readonly ContributionStatus[]> = {
  draft: ["pending_review"],
  pending_review: ["changes_requested", "published"],
  changes_requested: ["pending_review"],
  published: [],
};
export const canTransition = (from: ContributionStatus, to: ContributionStatus) => STATUS_TRANSITIONS[from].includes(to);

export const CONTRIBUTION_LIMITS = { titleMin: 5, titleMax: 150, bodyMin: 10, bodyMax: 4000, slugMax: 60, maxSectors: 20 };

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TYPE_IDS: readonly string[] = CONTRIBUTION_TYPES.map((t) => t.id);

export type ContributionInput = { type: ContributionType; robotType: string | null; title: string; body: string; sectors: string[] };
export type ValidationResult = { ok: true; value: ContributionInput } | { ok: false; errors: FieldErrors };

const text = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "");

/**
 * Checks a contribution as typed in the form. `activeSectors` is the list of sector slugs that exist and are active
 * (from the database); a sector not in it is refused. Duplicate sectors are merged (a contribution is in a sector once).
 * `forSubmit` = false checks a draft: the same rules, except that no sector is needed yet.
 */
export function validateContribution(raw: unknown, activeSectors: readonly string[], { forSubmit = true } = {}): ValidationResult {
  const errors: FieldErrors = {};
  const o = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const L = CONTRIBUTION_LIMITS;

  const type = text(o.type);
  if (!TYPE_IDS.includes(type)) errors.type = "Choose what you want to contribute.";

  const title = text(o.title);
  if (title.length < L.titleMin) errors.title = `Give it a title of at least ${L.titleMin} characters.`;
  else if (title.length > L.titleMax) errors.title = `Keep the title to ${L.titleMax} characters or fewer.`;
  else if (hasControlChars(title)) errors.title = "The title has characters that are not allowed.";

  const body = text(o.body);
  if (body.length < L.bodyMin) errors.body = `Tell us a little more (at least ${L.bodyMin} characters).`;
  else if (body.length > L.bodyMax) errors.body = `Keep it to ${L.bodyMax} characters or fewer.`;
  else if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(body)) errors.body = "The text has characters that are not allowed.";

  let robotType: string | null = null;
  if (o.robotType != null && o.robotType !== "") {
    const r = text(o.robotType);
    if (r.length > L.slugMax || !SLUG_RE.test(r)) errors.robotType = "That robot type is not valid.";
    else robotType = r;
  }

  const sectors: string[] = [];
  if (o.sectors != null && !Array.isArray(o.sectors)) errors.sectors = "Sectors must be a list.";
  else {
    const list = (o.sectors as unknown[] | undefined) ?? [];
    if (list.length > L.maxSectors) errors.sectors = "Too many sectors chosen.";
    else {
      for (const s of list) {
        const slug = text(s);
        if (!SLUG_RE.test(slug) || !activeSectors.includes(slug)) { errors.sectors = "One of the chosen sectors is not available."; break; }
        if (!sectors.includes(slug)) sectors.push(slug);
      }
    }
    if (!errors.sectors && forSubmit && sectors.length === 0) errors.sectors = "Choose at least one sector.";
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { type: type as ContributionType, robotType, title, body, sectors } };
}

/** Maps a PostgreSQL error from the contributions tables to a field message, or null when it is not one of ours. */
export function contributionDbError(e: unknown): { field: string; message: string } | null {
  const err = e as { code?: string; constraint?: string; message?: string } | null;
  if (!err) return null;
  if (err.code === "23505" && /contribution_scopes_pkey/.test(err.constraint ?? "")) return { field: "sectors", message: "That sector is already chosen." };
  if (err.code === "23503" && /sector/.test(err.constraint ?? "")) return { field: "sectors", message: "One of the chosen sectors is not available." };
  if (err.code === "23514") {
    const c = err.constraint ?? "";
    if (/title/.test(c)) return { field: "title", message: "Check the title length." };
    if (/body/.test(c)) return { field: "body", message: "Check the text length." };
    if (/robot_type/.test(c)) return { field: "robotType", message: "That robot type is not valid." };
    if (/type/.test(c)) return { field: "type", message: "Choose what you want to contribute." };
    if (/at least one sector|keep at least one sector/.test(err.message ?? "")) return { field: "sectors", message: "Choose at least one sector." };
  }
  return null;
}
