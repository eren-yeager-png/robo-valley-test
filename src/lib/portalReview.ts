// Contribution Portal: the numbers and rows behind Moderation, Publish Requests and the Admin's Overview, for BOTH kinds of
// contributions: ideas sent with "Share Your Idea" (cw_contributions, migration 027) and items sent with the current form
// (contributions, migrations 012-026). Reads only; every change still goes through the existing routes, which check again.
// The status shown comes from the ONE portal model (public/cw/js/portal-status.js), so a card's number and the rows below it agree.
// Either kind may be missing on an older database: it is then simply empty; both missing = not set up.
import { FORM_NOTE, WORKFLOW_NOTE, formToPortal, workflowToPortal } from "../../public/cw/js/portal-status.js";
import { sectorRows } from "./contributionReview";
import { sectorForm } from "./sectorForms";
import { roleLabel } from "./cw/lookups";
import * as R from "./cw/shared";
import { fieldSources } from "./portalFields";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
export type PortalView = "moderation" | "requests" | "overview";
export const PORTAL_VIEWS: readonly PortalView[] = ["moderation", "requests", "overview"];
const KEYS = ["pending", "approved", "requested", "published", "rejected", "unpublished"] as const;
type Key = (typeof KEYS)[number];
export type SectorCounts = { slug: string; name: string; total: number } & Record<Key, number>;
export type PortalRow = {
  key: string; source: "workflow" | "form"; id: number; code: string; title: string; contributor: string; contributorType: string;
  status: string; display: string; note: string; sentAt: string | null; approvedBy: string | null; sector: string; sectorName: string;
  categories: string[]; alsoIn: string[]; actions: string[]; viewUrl: string | null;
  /** a Rejected idea: who declined it (a Moderator) or rejected it (an Admin), and when */
  decision?: { label: string; at: string | null };
};
export class PortalNotSetUp extends Error { constructor() { super("Reviewing is not set up on this database yet."); } }

const missing = (e: unknown) => ["42P01", "42703"].includes((e as { code?: string } | null)?.code ?? "");
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const j = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
/** Runs a read of one kind; a table that does not exist yet gives `empty` and is noted. */
async function part<T>(fn: () => Promise<T>, empty: T, absent: string[], name: string): Promise<T> {
  try { return await fn(); } catch (e) { if (missing(e)) { absent.push(name); return empty; } throw e; }
}
const VERIFIED = "EXISTS (SELECT 1 FROM contribution_reviews r WHERE r.contribution_id = c.id AND r.action = 'verify')";

async function sectorList(db: Db): Promise<{ slug: string; name: string }[]> {
  return (await db.query("SELECT slug, name FROM sectors WHERE is_active AND NOT is_demo ORDER BY sort_order, name")).rows.map((r) => ({ slug: r.slug, name: r.name }));
}

/** Every sector with its numbers per portal status (an item in several sectors counts under each, as in Moderation). */
async function sectorCounts(db: Db, absent: string[]): Promise<SectorCounts[]> {
  const sectors = await part(() => sectorList(db), [], absent, "sectors");
  const map = new Map<string, SectorCounts>(sectors.map((s) => [s.slug, { ...s, total: 0, pending: 0, approved: 0, requested: 0, published: 0, rejected: 0, unpublished: 0 }]));
  const bump = (slug: string, key: string | null) => { const s = map.get(slug); if (!s || !key || !(KEYS as readonly string[]).includes(key)) return; s.total += 1; s[key as Key] += 1; };
  const form = await part(async () => (await db.query(
    `SELECT c.id, c.status, s.slug, ${VERIFIED} AS verified FROM contributions c JOIN contribution_scopes cs ON cs.contribution_id = c.id ` +
    "JOIN sectors s ON s.id = cs.sector_id WHERE c.status NOT IN ('draft','removed') AND NOT c.is_demo AND NOT s.is_demo")).rows, [] as any[], absent, "form");
  for (const r of form) bump(r.slug, formToPortal(r.status, r.verified === true));
  const wf = await part(async () => (await db.query("SELECT status, proposed->>'sector' AS sector FROM cw_contributions")).rows, [] as any[], absent, "workflow");
  for (const r of wf) bump(String(r.sector ?? ""), workflowToPortal(r.status));
  return [...map.values()];
}

const WF_COLS = "c.id, c.user_id, c.status, c.proposed, c.contributor_name, c.contributor_type, c.submitted_at, c.moderator_name, c.published_at, " +
  "(SELECT max(v.created_at) FROM cw_contribution_versions v WHERE v.contribution_id = c.id) AS sent_at";

function workflowRow(r: any, sectors: { slug: string; name: string }[], view: PortalView): PortalRow {
  const p = j(r.proposed) ?? {};
  const status = String(r.status);
  return {
    key: `w-${r.id}`, source: "workflow", id: Number(r.id), code: R.codeOf(r.id), title: String(p.title ?? ""),
    contributor: String(r.contributor_name ?? ""), contributorType: roleLabel(String(r.contributor_type ?? "")),
    status, display: workflowToPortal(status), note: (WORKFLOW_NOTE as Record<string, string>)[status] ?? "",
    sentAt: view === "requests" ? iso(r.sent_at) ?? iso(r.submitted_at) : iso(r.submitted_at), approvedBy: r.moderator_name ?? null,
    sector: String(p.sector ?? ""), sectorName: R.sectorLabel(p.sector, sectors), categories: [], alsoIn: [],
    actions: view === "moderation" ? (R.canModeratorEdit(status) ? ["approve", "edit", "reject"] : ["view"]) : [], viewUrl: null,
  };
}

/** Who declined (a Moderator) or rejected (an Admin) each Rejected idea, and when: the latest decision of each. */
async function decisions(db: Db, rows: { id: number; status: string }[], absent: string[]): Promise<Map<number, { label: string; at: string | null }>> {
  const ids = rows.filter((r) => r.status === "rejected").map((r) => r.id);
  const out = new Map<number, { label: string; at: string | null }>();
  if (!ids.length) return out;
  const found = await part(async () => (await db.query(
    "SELECT DISTINCT ON (contribution_id) contribution_id, type, by_name, created_at FROM cw_contribution_feedback WHERE contribution_id = ANY($1::bigint[]) AND type IN ('decline', 'reject') ORDER BY contribution_id, id DESC",
    [ids])).rows, [] as any[], absent, "feedback");
  for (const f of found) out.set(Number(f.contribution_id), { label: `${f.type === "decline" ? "Declined" : "Rejected"} by ${f.by_name} (${f.type === "decline" ? "Moderator" : "Admin"})`, at: iso(f.created_at) });
  return out;
}
const withDecisions = async (db: Db, rows: PortalRow[], absent: string[]) => {
  const d = await decisions(db, rows.filter((r) => r.source === "workflow"), absent);
  for (const r of rows) if (r.source === "workflow" && d.has(r.id)) r.decision = d.get(r.id);
  return rows;
};

const formNote = (status: string, display: string, verified: boolean) =>
  verified && status === "pending_review" ? "Verified by a reviewer" : (FORM_NOTE as Record<string, string>)[status] ?? (display === "in_review" ? "In review" : display === "replied" ? "Replied" : "");

export type PortalData = {
  view: PortalView; sectors: SectorCounts[]; sector: { slug: string; name: string } | null; rows: PortalRow[];
  fields: { slug: string; name: string; active: boolean; source: string; pluginName: string }[];
  totals: { requests: number; publishedThisWeek: number; rejected: number; activeContributors: number } | null;
  exportUrl: string | null; isAdmin: boolean; absent: string[];
};

/** Moderation, Publish Requests or the Overview. `sector` "" = Moderation opens the sector with the most waiting (Requests: all). */
export async function portalData(db: Db, o: { view: PortalView; sector: string; viewerId: number; isAdmin: boolean }): Promise<PortalData> {
  const absent: string[] = [];
  const sectors = await sectorCounts(db, absent);
  if (absent.includes("sectors") || (absent.includes("form") && absent.includes("workflow"))) throw new PortalNotSetUp();
  const names = sectors.map((s) => ({ slug: s.slug, name: s.name }));
  const out: PortalData = { view: o.view, sectors, sector: null, rows: [], fields: [], totals: null, exportUrl: null, isAdmin: o.isAdmin, absent };

  if (o.view === "moderation") {
    const pick = sectors.find((s) => s.slug === o.sector) ?? [...sectors].sort((a, b) => b.pending - a.pending)[0] ?? null;
    if (!pick) return out;
    out.sector = { slug: pick.slug, name: pick.name };
    const form = await part(() => sectorRows(db as never, pick.slug), null, absent, "form");
    for (const r of form?.rows ?? []) {
      const display = formToPortal(r.status, r.verified);
      if (!display) continue;
      out.rows.push({
        key: `f-${r.id}`, source: "form", id: r.id, code: `C-${r.id}`, title: r.title, contributor: r.contributor, contributorType: r.stakeholder,
        status: r.status, display, note: formNote(r.status, r.display, r.verified), sentAt: r.submittedAt, approvedBy: null,
        sector: pick.slug, sectorName: pick.name, categories: r.categories, alsoIn: r.alsoIn,
        actions: r.status === "pending_review" && !r.verified && r.userId !== o.viewerId ? ["approve", "reject"] : [],
        viewUrl: `/admin/moderation/${r.id}?from=${encodeURIComponent(pick.slug)}`,
      });
    }
    const wf = await part(async () => (await db.query(`SELECT ${WF_COLS} FROM cw_contributions c WHERE c.proposed->>'sector' = $1 ORDER BY c.submitted_at DESC, c.id DESC`, [pick.slug])).rows, [] as any[], absent, "workflow");
    for (const r of wf) out.rows.push(workflowRow(r, names, "moderation"));
    out.rows.sort((a, b) => String(b.sentAt ?? "").localeCompare(String(a.sentAt ?? "")));
    await withDecisions(db, out.rows, absent);
    if (form) out.exportUrl = `/api/review/export?${new URLSearchParams({ sector: pick.slug, tab: "all" }).toString()}`;
    const sf = await sectorForm(db as never, pick.slug).catch(() => null);
    if (sf && sf.robotsReady) {
      const src = await fieldSources(db, sf.sector, sf.robots.map((x) => x.name));
      out.fields = sf.robots.map((x) => ({ slug: x.slug, name: x.name, active: x.active, source: src.get(x.name.toLowerCase()) ?? "admin", pluginName: "" }));
    }
    return out;
  }

  // the Admin's views: the requests waiting for a decision (and the rest of the workflow for the other tabs)
  const wf = await part(async () => (await db.query(`SELECT ${WF_COLS} FROM cw_contributions c ORDER BY c.submitted_at DESC, c.id DESC`)).rows, [] as any[], absent, "workflow");
  const verified = await part(async () => (await db.query(
    "SELECT c.id, c.title, c.submitted_at, c.user_id, u.full_name, u.role, " +
    "(SELECT r.created_at FROM contribution_reviews r WHERE r.contribution_id = c.id AND r.action = 'verify' ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS verified_at, " +
    "(SELECT ru.full_name FROM contribution_reviews r LEFT JOIN users ru ON ru.id = r.reviewer_id WHERE r.contribution_id = c.id AND r.action = 'verify' ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS verifier, " +
    "COALESCE((SELECT json_agg(json_build_object('slug', s.slug, 'name', s.name) ORDER BY s.sort_order, s.slug) FROM contribution_scopes cs JOIN sectors s ON s.id = cs.sector_id WHERE cs.contribution_id = c.id AND NOT s.is_demo), '[]'::json) AS sectors " +
    `FROM contributions c LEFT JOIN users u ON u.id = c.user_id WHERE c.status = 'pending_review' AND NOT c.is_demo AND ${VERIFIED} ORDER BY c.submitted_at DESC`)).rows, [] as any[], absent, "form");
  const formSlugs = new Map<string, string[]>(); // an item sent with the current form can be in several sectors
  const formRows: PortalRow[] = verified.map((r) => {
    const secs = (j(r.sectors) ?? []) as { slug: string; name: string }[];
    formSlugs.set(`f-${r.id}`, secs.map((s) => s.slug));
    const first = String(r.full_name ?? "").trim().split(/\s+/)[0] ?? "";
    const vFirst = String(r.verifier ?? "").trim().split(/\s+/)[0] ?? "";
    return {
      key: `f-${r.id}`, source: "form", id: Number(r.id), code: `C-${r.id}`, title: String(r.title ?? ""), contributor: first || "A member",
      contributorType: "", status: "pending_review", display: "requested", note: "Verified by a reviewer", sentAt: iso(r.verified_at) ?? iso(r.submitted_at),
      approvedBy: vFirst || null, sector: secs[0]?.slug ?? "", sectorName: secs.map((s) => s.name).join(", "), categories: [], alsoIn: secs.slice(1).map((s) => s.name),
      actions: [], viewUrl: `/admin/moderation/${r.id}`,
    };
  });
  const wfRows = wf.map((r) => workflowRow(r, names, "requests"));
  const inSector = (r: PortalRow) => !o.sector || (r.source === "workflow" ? r.sector === o.sector : (formSlugs.get(r.key) ?? []).includes(o.sector));

  if (o.view === "requests") {
    const s = sectors.find((x) => x.slug === o.sector) ?? null;
    out.sector = s ? { slug: s.slug, name: s.name } : null;
    out.rows = [...wfRows.filter((r) => r.display !== "pending"), ...formRows].filter(inSector)
      .sort((a, b) => String(b.sentAt ?? "").localeCompare(String(a.sentAt ?? "")));
    await withDecisions(db, out.rows, absent);
    return out;
  }

  // the Overview: four numbers and the sector grid (publish requests per sector)
  const week = Date.now() - 7 * 864e5, month = Date.now() - 30 * 864e5;
  const formStats = await part(async () => (await db.query(
    "SELECT count(*) FILTER (WHERE status = 'published' AND published_at >= $1)::int AS published_week, count(*) FILTER (WHERE status = 'rejected')::int AS rejected " +
    "FROM contributions WHERE NOT is_demo", [new Date(week).toISOString()])).rows[0], { published_week: 0, rejected: 0 }, absent, "form");
  const since = new Date(month).toISOString();
  const people = new Set<string>();
  for (const sql of ["SELECT DISTINCT user_id FROM contributions WHERE NOT is_demo AND status <> 'draft' AND submitted_at >= $1", "SELECT DISTINCT user_id FROM cw_contributions WHERE submitted_at >= $1"]) {
    for (const r of await part(async () => (await db.query(sql, [since])).rows, [] as any[], absent, "active")) people.add(String(r.user_id));
  }
  out.totals = {
    requests: wfRows.filter((r) => r.display === "requested").length + formRows.length,
    publishedThisWeek: wf.filter((r) => r.status === "published" && r.published_at && new Date(r.published_at).getTime() >= week).length + Number(formStats.published_week ?? 0),
    rejected: wf.filter((r) => r.status === "rejected").length + Number(formStats.rejected ?? 0),
    activeContributors: people.size,
  };
  return out;
}
