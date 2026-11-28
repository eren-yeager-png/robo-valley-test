// "My Contributions" (every portal): the signed-in person's OWN items in one read-only list: their ideas in the contribution workflow
// (cw_contributions) and what they sent with the current form (contributions). Each part tolerates a database without its tables, so
// the list works before or after any migration. Nothing here changes data.
import * as R from "./shared";
import { loadSectors } from "./lookups";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
export type MineItem = {
  code: string; source: "workflow" | "form"; title: string; description: string; sector: string; sectorName: string; field: string;
  type: string; submittedAt: string | null; publishedAt: string | null; status: string; statusLabel: string; feedback: string; editUrl: string;
};

const missing = (e: unknown) => ["42P01", "42703"].includes((e as { code?: string })?.code ?? "");
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const j = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v) ?? {};
const FORM_TYPE: Record<string, string> = { problem: "Describe a problem", improve: "Share an idea", resource: "Share a video or resource" };

/** The list, newest first. `editUrl` is where the current form edits a pending item ("Your contributions" on the website). */
export async function myContributions(db: Db, userId: number, links: { editUrl: string }): Promise<MineItem[]> {
  const sectors = await loadSectors(db);
  const items: MineItem[] = [];
  try {
    const rows = (await db.query("SELECT id, kind, original, status, submitted_at, published_at FROM cw_contributions WHERE user_id = $1", [userId])).rows;
    const rejected = rows.filter((r) => r.status === R.STATUS.REJECTED).map((r) => Number(r.id));
    const reasons = new Map<number, string>();
    if (rejected.length) {
      for (const f of (await db.query(
        `SELECT DISTINCT ON (contribution_id) contribution_id, text FROM cw_contribution_feedback WHERE contribution_id = ANY($1::bigint[]) AND type IN ('decline', 'reject') ORDER BY contribution_id, id DESC`, [rejected])).rows) {
        reasons.set(Number(f.contribution_id), String(f.text));
      }
    }
    for (const r of rows) {
      const o = j(r.original), st = R.mineStatus("workflow", String(r.status));
      items.push({
        code: R.codeOf(r.id), source: "workflow", title: String(o.title ?? ""), description: String(o.description ?? ""),
        sector: String(o.sector ?? R.NOT_SURE), sectorName: R.sectorLabel(o.sector, sectors), field: o.robotType && o.robotType !== R.NOT_SURE ? R.robotLabel(o.sector, o.robotType, sectors) : "",
        type: String(r.kind), submittedAt: iso(r.submitted_at), publishedAt: r.status === R.STATUS.PUBLISHED ? iso(r.published_at) : null,
        status: st.key, statusLabel: st.label, feedback: reasons.get(Number(r.id)) ?? "", editUrl: "", // new ideas: View only (written once)
      });
    }
  } catch (e) { if (!missing(e)) throw e; }
  try {
    const rows = (await db.query(
      `SELECT c.id, c.title, c.body, c.type, c.status, c.submitted_at, c.created_at, c.published_at, c.robot_type,
              (SELECT s.slug FROM contribution_scopes cs JOIN sectors s ON s.id = cs.sector_id WHERE cs.contribution_id = c.id ORDER BY s.sort_order, s.id LIMIT 1) AS sector_slug,
              (SELECT string_agg(s.name, ', ' ORDER BY s.sort_order, s.id) FROM contribution_scopes cs JOIN sectors s ON s.id = cs.sector_id WHERE cs.contribution_id = c.id) AS sector_names
         FROM contributions c WHERE c.user_id = $1`, [userId])).rows;
    const replies = new Map<number, string>();
    try {
      for (const f of (await db.query(
        "SELECT DISTINCT ON (contribution_id) contribution_id, message FROM contribution_replies WHERE contribution_id = ANY($1::bigint[]) ORDER BY contribution_id, created_at DESC", [rows.map((r) => Number(r.id))])).rows) {
        replies.set(Number(f.contribution_id), String(f.message));
      }
    } catch (e) { if (!missing(e)) throw e; } // replies came with 019
    for (const r of rows) {
      const st = R.mineStatus("form", String(r.status));
      const robot = r.robot_type ? R.robotLabel(String(r.sector_slug ?? ""), String(r.robot_type), sectors) : "";
      items.push({
        code: `C-${r.id}`, source: "form", title: String(r.title), description: String(r.body ?? ""), sector: String(r.sector_slug ?? ""),
        sectorName: String(r.sector_names ?? ""), field: robot, type: FORM_TYPE[String(r.type)] ?? "Contribution",
        submittedAt: iso(r.submitted_at ?? r.created_at), publishedAt: r.status === "published" ? iso(r.published_at) : null,
        status: st.key, statusLabel: st.label, feedback: replies.get(Number(r.id)) ?? "",
        editUrl: st.key === "pending" || st.key === "draft" ? links.editUrl : "", // the current form edits pending items itself
      });
    }
  } catch (e) { if (!missing(e)) throw e; }
  return items.sort((a, b) => String(b.submittedAt ?? "").localeCompare(String(a.submittedAt ?? "")));
}
