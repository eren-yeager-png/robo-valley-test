// The fixed list of Find a Service categories. A category can only ever be one of these names: it is chosen from this list
// (never typed free-hand), checked against it on every request, and stored as its slug. The names are plain text; every page
// that shows one inserts it with textContent. `aliases` are the extra words a visitor may type in the Service search box (matched by
// word prefix, never shown as results). The page gets them from GET /api/services/categories, so no widget repeats this list.
export const CATEGORIES = [
  { slug: "atl-labs", name: "ATL Labs", aliases: ["atl", "atal tinkering", "tinkering"] },
  { slug: "robotics-labs", name: "Robotics Labs", aliases: ["robot", "robotics", "lab", "labs"] },
  { slug: "stem-labs", name: "STEM Labs", aliases: ["stem", "science", "lab", "labs"] },
  { slug: "3d-printing-facilities", name: "3D Printing Facilities", aliases: ["3d", "printing", "printer"] },
  { slug: "robotics-training-centres", name: "Robotics Training Centres", aliases: ["robot", "training", "coaching"] },
  { slug: "innovation-centres", name: "Innovation Centres", aliases: ["innovation"] },
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]["slug"];
export const CATEGORY_SLUGS: readonly string[] = CATEGORIES.map((c) => c.slug);
export const DEFAULT_CATEGORY: CategorySlug = "atl-labs";

/** Exact slug from the allow-list, or null. Nothing is trimmed, lower-cased or guessed. */
export function parseCategory(raw: unknown): CategorySlug | null {
  return typeof raw === "string" && CATEGORY_SLUGS.includes(raw) ? (raw as CategorySlug) : null;
}

export function categoryName(slug: string): string | null {
  return CATEGORIES.find((c) => c.slug === slug)?.name ?? null;
}
