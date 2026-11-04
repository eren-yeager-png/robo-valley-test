// Server-side client for the WordPress "RoboValley Projects" bridge (wp-content/plugins/robovalley-projects/includes/bridge.php).
// The members-only project fields live in WordPress; this is the ONLY code that fetches them. It must never be imported by a
// client component, and the secret must never reach a browser.
//
// Every request is signed:  HMAC-SHA256(secret, "RVP1\nMETHOD\nROUTE\nTIMESTAMP\nNONCE\nSHA256(canonical query)")
// with headers X-RVP-Timestamp / X-RVP-Nonce / X-RVP-Signature. See bridge.php for the exact rules.
//
// Configuration (environment, never committed):
//   RVP_BRIDGE_URL     address of the WordPress site as THIS SERVER reaches it, no trailing slash (e.g. https://techytree.in)
//   RVP_BRIDGE_SECRET  the same value as the RVP_BRIDGE_SECRET constant in wp-config.php; at least 32 characters
// If either is missing or invalid the bridge counts as unavailable: callers get { ok: false, reason: "unavailable" } and must
// fail closed. Nothing here logs the secret, a signature or any project data.

import { createHash, createHmac, randomBytes } from "node:crypto";

export type BridgeReason = "not_found" | "unavailable";
export type BridgeResult<T> = { ok: true; data: T } | { ok: false; reason: BridgeReason };

export type Term = { slug: string; name: string };
export type Thumbnail = { url: string; width: number; height: number; alt: string; srcset?: string };
export type ProjectDetails = {
  id: number;
  title: string;
  short_description: string;
  thumbnail: Thumbnail | null;
  technology: Term[];
  difficulty: { slug: string; label: string } | null;
  education: Term[];
  overview: string;
  subjects: Term[];
  skills: string[];
  components: string[];
  outcome: string;
};
export type SubjectIds = { ids: number[]; total: number; limit: number; truncated: boolean };

export const BRIDGE_TIMEOUT_MS = 4000;
const MAX_BODY_BYTES = 256 * 1024;
const REST_PREFIX = "/wp-json";

/** RFC 3986 percent-encoding, the same as PHP's rawurlencode (encodeURIComponent also leaves ! ' ( ) * alone). */
const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

export const canonicalQuery = (query: Record<string, string>) =>
  Object.keys(query).sort().map((k) => `${rfc3986(k)}=${rfc3986(query[k])}`).join("&");

/** The three signature headers for one request. `now` (ms) and `nonce` are injectable for tests. */
export function signBridgeRequest(
  method: string, route: string, query: Record<string, string>, secret: string,
  now = Date.now(), nonce = randomBytes(16).toString("hex"),
): Record<string, string> {
  const ts = String(Math.floor(now / 1000));
  const toSign = ["RVP1", method, route, ts, nonce, createHash("sha256").update(canonicalQuery(query)).digest("hex")].join("\n");
  return {
    "X-RVP-Timestamp": ts,
    "X-RVP-Nonce": nonce,
    "X-RVP-Signature": createHmac("sha256", secret).update(toSign).digest("hex"),
  };
}

function config(env: NodeJS.ProcessEnv): { base: string; secret: string } | null {
  const secret = env.RVP_BRIDGE_SECRET;
  const raw = env.RVP_BRIDGE_URL?.trim();
  if (!secret || secret.length < 32 || !raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return { base: u.origin + u.pathname.replace(/\/+$/, ""), secret };
  } catch {
    return null;
  }
}

/** True when the bridge is configured (does not say whether WordPress is reachable). */
export const bridgeConfigured = (env: NodeJS.ProcessEnv = process.env) => config(env) !== null;

type Options = { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; timeoutMs?: number; now?: number };

async function bridgeGet(route: string, query: Record<string, string>, o: Options = {}): Promise<BridgeResult<unknown>> {
  const cfg = config(o.env ?? process.env);
  if (!cfg) {
    console.error("projects bridge: not configured");
    return { ok: false, reason: "unavailable" };
  }
  const qs = canonicalQuery(query);
  const url = `${cfg.base}${REST_PREFIX}${route}${qs ? "?" + qs : ""}`;
  try {
    const res = await (o.fetchImpl ?? fetch)(url, {
      method: "GET",
      headers: { Accept: "application/json", ...signBridgeRequest("GET", route, query, cfg.secret, o.now) },
      redirect: "manual", // never follow a redirect with signed headers attached
      cache: "no-store",
      signal: AbortSignal.timeout(o.timeoutMs ?? BRIDGE_TIMEOUT_MS),
    });
    if (res.status === 404) return { ok: false, reason: "not_found" };
    if (res.status !== 200) {
      console.error(`projects bridge: unexpected status ${res.status}`); // status only, never the body
      return { ok: false, reason: "unavailable" };
    }
    if (!/^application\/json/i.test(res.headers.get("content-type") ?? "")) {
      console.error("projects bridge: unexpected content type");
      return { ok: false, reason: "unavailable" };
    }
    const text = await res.text();
    if (text.length > MAX_BODY_BYTES) throw new Error("too large");
    return { ok: true, data: JSON.parse(text) };
  } catch {
    console.error("projects bridge: request failed"); // timeout, network error or bad JSON; no details
    return { ok: false, reason: "unavailable" };
  }
}

/* ---------- strict shaping: only known fields, only the expected types, bounded sizes ---------- */

const str = (v: unknown, max: number): string | null => (typeof v === "string" ? v.slice(0, max) : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
const terms = (v: unknown): Term[] | null => {
  if (!Array.isArray(v) || v.length > 50) return null;
  const out: Term[] = [];
  for (const t of v) {
    const slug = str((t as Term)?.slug, 100), name = str((t as Term)?.name, 200);
    if (slug === null || name === null) return null;
    out.push({ slug, name });
  }
  return out;
};
const lines = (v: unknown): string[] | null => {
  if (!Array.isArray(v) || v.length > 50) return null;
  const out: string[] = [];
  for (const l of v) { const s = str(l, 150); if (s === null) return null; out.push(s); }
  return out;
};
const httpUrl = (v: unknown): string | null => {
  const s = str(v, 2000);
  if (s === null) return null;
  try { const u = new URL(s); return u.protocol === "http:" || u.protocol === "https:" ? s : null; } catch { return null; }
};

export function parseProject(raw: unknown): ProjectDetails | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  const id = int(r.id), title = str(r.title, 300), shortDescription = str(r.short_description, 400);
  const overview = str(r.overview, 5000), outcome = str(r.outcome, 3000);
  const technology = terms(r.technology), education = terms(r.education), subjects = terms(r.subjects);
  const skills = lines(r.skills), components = lines(r.components);
  if (id === null || id < 1 || title === null || shortDescription === null || overview === null || outcome === null) return null;
  if (!technology || !education || !subjects || !skills || !components) return null;

  let difficulty: ProjectDetails["difficulty"] = null;
  if (r.difficulty !== null) {
    const d = r.difficulty as { slug?: unknown; label?: unknown };
    const slug = str(d?.slug, 40), label = str(d?.label, 80);
    if (slug === null || label === null) return null;
    difficulty = { slug, label };
  }
  let thumbnail: Thumbnail | null = null;
  if (r.thumbnail !== null && r.thumbnail !== undefined) {
    const t = r.thumbnail as Record<string, unknown>;
    const url = httpUrl(t.url), w = int(t.width), h = int(t.height), alt = str(t.alt, 300);
    if (url === null || w === null || h === null || alt === null) return null;
    thumbnail = { url, width: w, height: h, alt };
    const srcset = str(t.srcset, 2000);
    if (srcset) thumbnail.srcset = srcset;
  }
  return { id, title, short_description: shortDescription, thumbnail, technology, difficulty, education, overview, subjects, skills, components, outcome };
}

export function parseSubjectIds(raw: unknown): SubjectIds | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || !Array.isArray(r.ids) || r.ids.length > 5000) return null;
  const ids: number[] = [];
  for (const v of r.ids) { const n = int(v); if (n === null || n < 1) return null; ids.push(n); }
  const total = int(r.total), limit = int(r.limit);
  if (total === null || limit === null || typeof r.truncated !== "boolean") return null;
  return { ids, total, limit, truncated: r.truncated };
}

/** The restricted + public fields of one published project. "not_found" covers unknown, unpublished and protected projects. */
export async function getProject(id: number, o: Options = {}): Promise<BridgeResult<ProjectDetails>> {
  const res = await bridgeGet(`/rvp-bridge/v1/project/${id}`, {}, o);
  if ("reason" in res) return res;
  const project = parseProject(res.data);
  if (!project || project.id !== id) {
    console.error("projects bridge: unexpected response shape");
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, data: project };
}

/** Ids of published projects having ANY of these subject slugs (capped by the bridge; `truncated` says so). */
export async function getSubjectIds(slugs: string[], o: Options = {}): Promise<BridgeResult<SubjectIds>> {
  const res = await bridgeGet("/rvp-bridge/v1/subject-ids", { subjects: slugs.join(",") }, o);
  if ("reason" in res) return { ok: false, reason: "unavailable" }; // a 404 here means the plugin is missing, which is also "unavailable"
  const parsed = parseSubjectIds(res.data);
  if (!parsed) {
    console.error("projects bridge: unexpected response shape");
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, data: parsed };
}
