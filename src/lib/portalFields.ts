// Contribution Portal: Sector Forms' data as far as the database shows it today (Phase A adds no tables):
//   * a sector's fields = its robot types (sectorForms.ts), with how many contributions chose each one;
//   * where a field came from: "member" (Suggested by member) when a member's "Suggest a field" has the same name, otherwise "admin".
//     A "Suggest a field" is a Share Your Idea item of kind "Suggestion" about the page "Robots by Sector › <Sector>". "plugin" (Added by
//     plugin) needs the plugin registry; the source itself is stored from Phase B on;
//   * the suggested fields still waiting: those suggestions, not rejected, whose name is not a field of the sector yet.
import { fieldUseCounts, listSectorForms, sectorForm } from "./sectorForms";
import { questionsOf } from "./sectorQuestions";
import { workflowToPortal } from "../../public/cw/js/portal-status.js";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
export const SUGGEST_PREFIX = "Robots by Sector › ";
export type Suggestion = { id: number; code: string; name: string; by: string; reason: string; sentAt: string | null; status: string; display: string };
export type PortalField = { id: number; slug: string; name: string; active: boolean; order: number; source: "admin" | "member" | "plugin"; pluginName: string; contributions: number };

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
        sentAt: r.submitted_at ? new Date(r.submitted_at).toISOString() : null, status: String(r.status), display: workflowToPortal(String(r.status)),
      });
      out.set(norm(sector), list);
    }
  } catch (e) { if (!missing(e)) throw e; }
  return out;
}

/** Field name (lower case) -> "member" for the fields a member suggested; the rest are "admin". */
export async function fieldSources(db: Db, sector: { name: string }, names: string[]): Promise<Map<string, "member" | "admin">> {
  const sugg = (await allSuggestions(db)).get(norm(sector.name)) ?? [];
  const suggested = new Set(sugg.filter((s) => s.status !== "rejected").map((s) => norm(s.name)));
  return new Map(names.map((n) => [norm(n), suggested.has(norm(n)) ? "member" : "admin"]));
}

export type SectorFormsPortal = {
  sectors: { slug: string; name: string; active: boolean; fields: number; suggestions: number }[];
  sector: { slug: string; name: string; active: boolean } | null; fields: PortalField[]; suggestions: Suggestion[];
  questionsOn: number | null; robotsReady: boolean;
};

/** Sector Forms: every sector with "n fields · m suggestions", and one sector's fields and waiting suggestions. */
export async function sectorFormsPortal(db: Db, slug: string): Promise<SectorFormsPortal> {
  const { sectors, robotsReady } = await listSectorForms(db as never);
  const sugg = await allSuggestions(db);
  const forms = new Map<string, Awaited<ReturnType<typeof sectorForm>>>();
  for (const s of sectors) forms.set(s.slug, await sectorForm(db as never, s.slug));
  const waitingOf = (s: { slug: string; name: string }) => {
    const names = new Set((forms.get(s.slug)?.robots ?? []).map((r) => norm(r.name)));
    return (sugg.get(norm(s.name)) ?? []).filter((x) => x.status !== "rejected" && !names.has(norm(x.name)));
  };
  const out: SectorFormsPortal = {
    sectors: sectors.map((s) => ({ slug: s.slug, name: s.name, active: s.active, fields: s.robots, suggestions: waitingOf(s).length })),
    sector: null, fields: [], suggestions: [], questionsOn: null, robotsReady,
  };
  const pick = sectors.find((s) => s.slug === slug) ?? sectors[0];
  if (!pick) return out;
  const f = forms.get(pick.slug);
  if (!f) return out;
  out.sector = f.sector;
  const counts = await fieldUseCounts(db as never, pick.slug);
  const member = new Set((sugg.get(norm(pick.name)) ?? []).filter((x) => x.status !== "rejected").map((x) => norm(x.name)));
  out.fields = f.robots.map((r) => ({ id: r.id, slug: r.slug, name: r.name, active: r.active, order: r.order, source: member.has(norm(r.name)) ? "member" : "admin", pluginName: "", contributions: counts.get(r.id) ?? 0 }));
  out.suggestions = waitingOf(pick);
  const qs = await questionsOf(db as never, pick.slug).catch(() => null);
  out.questionsOn = qs ? qs.filter((q) => q.active).length : null;
  return out;
}
