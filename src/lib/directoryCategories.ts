// Structured directory categories (migration 019; portal PR2). The member form (plugin 0.1.5) sends the chosen categories, their
// remarks and links as `directory` AND still folds the same text into the description, as agreed, so nothing older breaks. This file:
//   readDirectory   checks what the form sent (only the form's own categories and link types, http(s) links, the form's limits)
//   saveDirectory   replaces an item's rows inside the caller's transaction
//   directoryFor    reads them back (reviewers' detail view, the member's Edit)
//   splitFold       separates the member's own words from the folded text; for an item saved before PR2 it also reads the categories
//                   back out of that text, so the member's Edit can fill the form in (reviewers then still see the description as-is).
// The folded format is the plugin's own (rv-contribution-v2.js, folded()):
//   <description>\n\nDirectory categories: A, B\n[A] Remarks: ...\n[A] Link 1 (Website): https://... - what it shows
import { hasControlChars } from "./validation";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export const DIRECTORY_CATEGORIES = ["Projects", "Services", "Events", "Robo Clubs", "Labs & Makerspaces", "Training & Workshops", "Not sure"] as const;
export const LINK_TYPES = ["Image", "News article", "LinkedIn", "Subcategory item", "Technical", "Architectural", "Functional", "Website", "Video", "Document", "Other"] as const;
export const DIR_LIMITS = { remarks: 2000, links: 5, url: 2048, gist: 180 } as const;

export type DirectoryLink = { type: string; url: string; gist: string };
export type DirectoryEntry = { category: string; remarks: string; links: DirectoryLink[] };

const oneLine = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
const isCategory = (c: string) => (DIRECTORY_CATEGORIES as readonly string[]).includes(c);
const isLinkType = (t: string) => (LINK_TYPES as readonly string[]).includes(t);
const isUrl = (u: string) => {
  if (u.length > DIR_LIMITS.url || !/^https?:\/\/\S+$/i.test(u)) return false;
  try { return ["http:", "https:"].includes(new URL(u).protocol); } catch { return false; }
};

export type DirectoryRead = { present: false } | { present: true; ok: true; value: DirectoryEntry[] } | { present: true; ok: false; message: string };

/** What the form sent as `directory`. Absent (an older form): nothing to change. Present: checked strictly, all or nothing. */
export function readDirectory(raw: unknown): DirectoryRead {
  if (raw === undefined) return { present: false };
  const bad = (message: string): DirectoryRead => ({ present: true, ok: false, message });
  if (!Array.isArray(raw)) return bad("The directory categories could not be read. Please reload the page and try again.");
  if (raw.length > DIRECTORY_CATEGORIES.length) return bad("Too many directory categories.");
  const out: DirectoryEntry[] = [];
  for (const item of raw) {
    const o = typeof item === "object" && item !== null && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
    const category = oneLine(o?.category);
    if (!o || !isCategory(category)) return bad("Choose directory categories from the list.");
    if (out.some((e) => e.category === category)) return bad("Each directory category can be chosen once.");
    const remarks = oneLine(o.remarks);
    if (remarks.length > DIR_LIMITS.remarks || hasControlChars(remarks)) return bad(`Keep the remarks for ${category} to ${DIR_LIMITS.remarks} characters, without special characters.`);
    const linksRaw = o.links === undefined ? [] : o.links;
    if (!Array.isArray(linksRaw) || linksRaw.length > DIR_LIMITS.links) return bad(`Add up to ${DIR_LIMITS.links} links for ${category}.`);
    const links: DirectoryLink[] = [];
    for (const l of linksRaw) {
      const lo = typeof l === "object" && l !== null && !Array.isArray(l) ? (l as Record<string, unknown>) : {};
      const type = oneLine(lo.type), url = typeof lo.url === "string" ? lo.url.trim() : "", gist = oneLine(lo.gist);
      if (!isLinkType(type)) return bad(`Choose a type for each link under ${category}.`);
      if (!isUrl(url)) return bad(`Each link under ${category} must begin with https:// or http://.`);
      if (!gist || gist.length > DIR_LIMITS.gist || hasControlChars(gist)) return bad(`Say in a few words what each link under ${category} provides (up to ${DIR_LIMITS.gist} characters).`);
      links.push({ type, url, gist });
    }
    out.push({ category, remarks, links });
  }
  return { present: true, ok: true, value: out };
}

/** Replaces the item's structured categories. Call inside the caller's transaction (the rows go with the item's other changes). */
export async function saveDirectory(db: Db, contributionId: number, entries: DirectoryEntry[]): Promise<void> {
  await db.query("DELETE FROM contribution_categories WHERE contribution_id = $1", [contributionId]); // their links go with them (ON DELETE CASCADE)
  for (const [i, e] of entries.entries()) {
    await db.query("INSERT INTO contribution_categories (contribution_id, category, remarks, position) VALUES ($1,$2,$3,$4)", [contributionId, e.category, e.remarks || null, i + 1]);
    for (const [j, l] of e.links.entries()) {
      await db.query("INSERT INTO contribution_category_links (contribution_id, category, position, link_type, url, gist) VALUES ($1,$2,$3,$4,$5,$6)", [contributionId, e.category, j + 1, l.type, l.url, l.gist]);
    }
  }
}

/** The structured categories of these items, in the member's order. Items without any are simply absent. Empty before migration 019. */
export async function directoryFor(db: Db, ids: number[]): Promise<Map<number, DirectoryEntry[]>> {
  const out = new Map<number, DirectoryEntry[]>();
  if (ids.length === 0) return out;
  try {
    const cats = await db.query("SELECT contribution_id, category, remarks FROM contribution_categories WHERE contribution_id = ANY($1::bigint[]) ORDER BY contribution_id, position", [ids]);
    const links = await db.query("SELECT contribution_id, category, link_type, url, gist FROM contribution_category_links WHERE contribution_id = ANY($1::bigint[]) ORDER BY contribution_id, category, position", [ids]);
    for (const r of cats.rows) {
      const k = Number(r.contribution_id);
      (out.get(k) ?? out.set(k, []).get(k)!).push({ category: String(r.category), remarks: r.remarks ? String(r.remarks) : "", links: [] });
    }
    for (const r of links.rows) {
      const e = out.get(Number(r.contribution_id))?.find((x) => x.category === r.category);
      if (e) e.links.push({ type: String(r.link_type), url: String(r.url), gist: String(r.gist) });
    }
  } catch (e) {
    if ((e as { code?: string })?.code !== "42P01") throw e;
  }
  return out;
}

const FOLD_START = "\n\nDirectory categories: ";

/**
 * The member's own words and the categories out of a folded description. Only text in exactly the plugin's format counts as a fold;
 * anything else is left alone (text = the whole description, entries = null).
 */
export function splitFold(description: string): { text: string; entries: DirectoryEntry[] | null } {
  const at = description.lastIndexOf(FOLD_START);
  if (at < 0) return { text: description, entries: null };
  const lines = description.slice(at + 2).split("\n");
  const names = lines[0]!.slice("Directory categories: ".length).split(", ").map((s) => s.trim()).filter(Boolean);
  if (names.length === 0 || !names.every(isCategory) || new Set(names).size !== names.length) return { text: description, entries: null };
  const entries: DirectoryEntry[] = names.map((category) => ({ category, remarks: "", links: [] }));
  for (const line of lines.slice(1)) {
    const m = /^\[([^\]]+)\] (?:Remarks: (.*)|Link (\d+) \(([^)]*)\): (\S+) - (.*))$/.exec(line);
    const e = m ? entries.find((x) => x.category === m[1]) : undefined;
    if (!m || !e) return { text: description, entries: null };
    if (m[2] !== undefined) e.remarks = m[2];
    else e.links.push({ type: m[4]!, url: m[5]!, gist: m[6]! });
  }
  return { text: description.slice(0, at), entries };
}
