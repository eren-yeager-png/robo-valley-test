// Contribution Portal: Sector Forms' data.
//   * a sector's fields = its robot types (sectorForms.ts), with how many contributions chose each one and whether it may be deleted
//     (no contribution of any status uses it and no plugin manages it; otherwise the reason, and Archive is offered);
//   * from migration 030 on: each field's stored source ("admin", "member" = Suggested by member, "plugin" = Added by plugin, with the
//     plugin's name), status (active, hidden, archived), description and icon, and the suggested fields as their own records
//     (field_suggestions: the pending ones);
//   * before 030 (Phase A): the source is worked out ("member" when a member's "Suggest a field" has the same name) and the suggested
//     fields are those suggestions, not rejected, whose name is not a field of the sector yet. A "Suggest a field" is a Share Your Idea
//     item of kind "Suggestion" about the page "Robots by Sector › <Sector>".
import { fieldAnyUses, fieldUseCounts, listSectorForms, sectorBySlug, sectorForm, type FieldStatus } from "./sectorForms";
import { questionsOf } from "./sectorQuestions";
import { workflowToPortal } from "../../public/cw/js/portal-status.js";
import { portalReady } from "./portalAudit";
import { sectorSuggestions } from "./fieldSuggestions";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
export const SUGGEST_PREFIX = "Robots by Sector › ";
/** record: true = a stored suggestion (030; decided with /api/admin/portal/field-suggestions/<id>); false = worked out from an idea (Phase A). */
export type Suggestion = { id: number; code: string; name: string; by: string; reason: string; sentAt: string | null; status: string; display: string; record: boolean };
export type PortalField = {
  id: number; slug: string; name: string; active: boolean; order: number; source: "admin" | "member" | "plugin"; pluginName: string; contributions: number;
  status: FieldStatus; description: string; icon: string; deletable: boolean; deleteBlock: string;
};

const missing = (e: unknown) => ["42P01", "42703"].includes((e as { code?: string } | null)?.code ?? "");
const j = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** Every "Suggest a field" of every sector, newest first, by sector name (the page name in the suggestion). */
async function allSuggestions(db: Db): Promise<Map<string, Suggestion[]>> {
  const out = new Map<string, Suggestion[]>();
  try {
    const { rows } = await db.query(
      "SELECT id, status, original, contributor_name, submitted_at, resource->>'path' AS path FROM cw_contributions " +
      "WHERE kind = 'Suggestion' AND left(resource->>'path', $2) = $1 ORDER BY submitted_at DESC, id DESC", [SUGGEST_PREFIX, SUGGEST_PREFIX.length]);
    for (const r of rows) {
      const o = j(r.original) ?? {};
      const sector = String(r.path).slice(SUGGEST_PREFIX.length).trim();
      const list = out.get(norm(sector)) ?? [];
      list.push({
        id: Number(r.id), code: `RV-${r.id}`, name: String(o.title ?? ""), by: String(r.contributor_name ?? ""), reason: String(o.description ?? ""),
        sentAt: r.submitted_at ? new Date(r.submitted_at).toISOString() : null, status: String(r.status), display: workflowToPortal(String(r.status)), record: false,
      });
      out.set(norm(sector), list);
    }
  } catch (e) { if (!missing(e)) throw e; }
  return out;
}

/** Field name (lower case) -> "member" for the fields a member suggested; the rest are "admin" (before 030: worked out). */
export async function fieldSources(db: Db, sector: { name: string }, names: string[]): Promise<Map<string, "member" | "admin">> {
  const sugg = (await allSuggestions(db)).get(norm(sector.name)) ?? [];
  const suggested = new Set(sugg.filter((s) => s.status !== "rejected").map((s) => norm(s.name)));
  return new Map(names.map((n) => [norm(n), suggested.has(norm(n)) ? "member" : "admin"]));
}

/** plugin key -> its name (030). */
async function pluginNames(db: Db): Promise<Map<string, string>> {
  try { return new Map((await db.query("SELECT plugin_key, name FROM plugins")).rows.map((r) => [String(r.plugin_key), String(r.name)])); } catch (e) { if (missing(e)) return new Map(); throw e; }
}

export type SectorFormsPortal = {
  sectors: { slug: string; name: string; active: boolean; archived: boolean; icon: string; color: string; fields: number; suggestions: number }[];
  sector: { slug: string; name: string; active: boolean } | null; fields: PortalField[]; suggestions: Suggestion[];
  questionsOn: number | null; robotsReady: boolean;
  /** fieldsData: 030 is applied (stored sources and statuses, archive, delete, descriptions, icons, suggestions as records) */
  features: { fieldsData: boolean };
};

/** Sector Forms: every sector with "n fields · m suggestions", and one sector's fields and waiting suggestions. */
export async function sectorFormsPortal(db: Db, slug: string): Promise<SectorFormsPortal> {
  const { sectors, robotsReady } = await listSectorForms(db as never);
  const ready = await portalReady(db);
  const forms = new Map<string, Awaited<ReturnType<typeof sectorForm>>>();
  for (const s of sectors) forms.set(s.slug, await sectorForm(db as never, s.slug));
  // before 030: the waiting suggestions are worked out from the ideas; from 030: the stored pending ones
  const sugg = ready ? new Map<string, Suggestion[]>() : await allSuggestions(db);
  const storedCounts = new Map<string, number>();
  if (ready) {
    for (const r of (await db.query("SELECT s.slug, count(*)::int AS n FROM field_suggestions f JOIN sectors s ON s.id = f.sector_id WHERE f.status = 'pending' GROUP BY s.slug")).rows) {
      storedCounts.set(String(r.slug), Number(r.n));
    }
  }
  const waitingOf = (s: { slug: string; name: string }) => {
    const names = new Set((forms.get(s.slug)?.robots ?? []).map((r) => norm(r.name)));
    return (sugg.get(norm(s.name)) ?? []).filter((x) => x.status !== "rejected" && !names.has(norm(x.name)));
  };
  const out: SectorFormsPortal = {
    sectors: sectors.map((s) => ({
      slug: s.slug, name: s.name, active: s.active, archived: s.archived, icon: s.icon, color: s.color, fields: s.robots,
      suggestions: ready ? storedCounts.get(s.slug) ?? 0 : waitingOf(s).length,
    })),
    sector: null, fields: [], suggestions: [], questionsOn: null, robotsReady, features: { fieldsData: ready },
  };
  const pick = sectors.find((s) => s.slug === slug) ?? sectors[0];
  if (!pick) return out;
  const f = forms.get(pick.slug);
  if (!f) return out;
  out.sector = f.sector;
  const row = await sectorBySlug(db as never, pick.slug);
  const counts = await fieldUseCounts(db as never, pick.slug);
  const uses = row ? await fieldAnyUses(db as never, { id: row.id, slug: row.slug }) : new Map<number, number>();
  const plugins = ready ? await pluginNames(db) : new Map<string, string>();
  const member = new Set((sugg.get(norm(pick.name)) ?? []).filter((x) => x.status !== "rejected").map((x) => norm(x.name)));
  out.fields = f.robots.map((r) => {
    const source = ready ? r.source : member.has(norm(r.name)) ? "member" : "admin";
    const pluginName = source === "plugin" ? plugins.get(r.pluginKey ?? "") ?? r.pluginKey ?? "a plugin" : "";
    const n = counts.get(r.id) ?? 0, any = uses.get(r.id) ?? 0;
    const deleteBlock = source === "plugin" ? `Managed by ${pluginName}: it cannot be deleted. Hide or archive it instead.`
      : n > 0 ? `Can't delete: ${n} contribution${n === 1 ? " uses" : "s use"} this field. Archive it instead.`
      : any > 0 ? "Can't delete: a draft or removed contribution still uses this field. Archive it instead." : "";
    return { id: r.id, slug: r.slug, name: r.name, active: r.active, order: r.order, source, pluginName, contributions: n,
      status: r.status, description: r.description, icon: r.icon, deletable: !deleteBlock, deleteBlock };
  });
  if (ready && row) {
    out.suggestions = ((await sectorSuggestions(db, row.id, "pending")) ?? []).map((x) => ({
      id: x.id, code: x.ideaCode ?? `S-${x.id}`, name: x.name, by: x.by, reason: x.reason, sentAt: x.sentAt, status: "pending", display: "pending", record: true }));
  } else {
    out.suggestions = waitingOf(pick);
  }
  const qs = await questionsOf(db as never, pick.slug).catch(() => null);
  out.questionsOn = qs ? qs.filter((q) => q.active).length : null;
  return out;
}
