// One place for server-side error reporting, so a failure shows up in the terminal (VS Code, or the host's logs) with
// WHAT failed, WHERE, WHY (when it can be told) and WHAT TO CHECK. Built on diagnostics.ts, which already masks URLs,
// e-mail addresses, API keys, 6-digit codes and long tokens.
//
//   * development (NODE_ENV=development, i.e. "npm run dev"): a readable block with a timestamp, category, location,
//     request id, the error's (masked) message, a hint and a short stack trace;
//   * everything else (production, tests): ONE JSON line with the error's name, database code, table and constraint,
//     but never its message or a stack trace (safe for hosted logs, where an error text could contain data);
//   * the same problem is not printed over and over: repeats within 30 seconds are counted and summarised;
//   * nothing from a request body, cookie, header or environment variable is ever included; callers pass only fixed facts.
import { describeError, type ErrorSummary, newRequestId, redact } from "./diagnostics";

export type LogCategory = "API" | "AUTH" | "DATABASE" | "MIGRATION" | "ENV" | "UPLOAD" | "DASHBOARD" | "RENDER" | "PROCESS";
type Level = "ERROR" | "WARN";
export type LogInput = {
  category: LogCategory;
  /** The route or module, e.g. "api/admin/attachments" or "admin/overview". */
  where: string;
  /** What failed, in plain words. */
  what: string;
  err?: unknown;
  requestId?: string;
  /** Only non-sensitive facts (a purpose, a stage, a file type). Never bodies, cookies, headers or secrets. */
  context?: Record<string, string | number | boolean>;
  /** Overrides the automatic "what to check" advice. */
  hint?: string;
};

const DEDUPE_MS = 30_000;
const MAX_KEYS = 200;
// Kept on globalThis so every bundled copy of this module (Next builds routes separately) shares one memory of what was printed.
const g = globalThis as typeof globalThis & { __rvLogSeen?: Map<string, { at: number; suppressed: number }> };
const seen = (g.__rvLogSeen ??= new Map());
export const resetLogDedupe = () => seen.clear();

/** Detailed output (message and stack) only on a developer's own machine. */
const isDevelopment = () => process.env.NODE_ENV === "development";

/** Plain-English advice for the failures that happen most, chosen from the error code. */
export function adviceFor(s: ErrorSummary): string | undefined {
  const where = s.table ? ` (table "${s.table}")` : "";
  switch (s.code) {
    case "42P01":
      return `A database table is missing${where}. If it is login_events or upload_attachments, migration 008 or 009 has not been applied to this database. Run "npm run db:migrate -- --expect-db <database name> --status" to see which migrations are missing.`;
    case "42703":
      return `A database column is missing. A migration has probably not been applied to this database. Run "npm run db:migrate -- --expect-db <database name> --status".`;
    case "ECONNREFUSED":
    case "ENOTFOUND":
    case "EAI_AGAIN":
    case "ETIMEDOUT":
    case "ECONNRESET":
      return "The database cannot be reached. Check that PostgreSQL is running and that the host and port in DATABASE_URL are correct.";
    case "28P01":
    case "28000":
      return "The database refused the user name or password. Check DATABASE_URL.";
    case "3D000":
      return "The database named in DATABASE_URL does not exist on that server.";
    case "57P01":
    case "57P03":
      return "The database server is shutting down or starting up. Try again in a moment.";
    case "53300":
    case "53400":
      return "The database has too many connections. If you use a pooled connection string, check the pool limits.";
    case "40P01":
      return "Two requests blocked each other in the database (a deadlock). It is safe to retry.";
    case "23505":
      return `A value that must be unique already exists${s.constraint ? ` (constraint "${s.constraint}")` : ""}.`;
    case "23503":
      return `A record points at something that does not exist${s.constraint ? ` (constraint "${s.constraint}")` : ""}.`;
    case "23514":
    case "23502":
      return `A value broke a database rule${s.constraint ? ` (constraint "${s.constraint}")` : ""}. Check the data being saved.`;
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
      return "The database's TLS certificate is not trusted. Check the sslmode setting in DATABASE_URL.";
    default:
      return undefined;
  }
}

/** A few stack frames with anything sensitive masked. Development only. */
function shortStack(err: unknown): string | undefined {
  const stack = (err as { stack?: unknown } | null)?.stack;
  if (typeof stack !== "string") return undefined;
  return redact(stack).split("\n").slice(0, 7).map((l) => l.trim()).join("\n      ");
}

export function formatEntry(level: Level, e: LogInput, now = new Date()): string {
  const summary = e.err !== undefined ? describeError(e.err) : undefined;
  const hint = e.hint ?? (summary ? adviceFor(summary) : undefined);
  if (!isDevelopment()) {
    const safe = summary ? { name: summary.name, code: summary.code, table: summary.table, constraint: summary.constraint, routine: summary.routine } : undefined;
    return JSON.stringify({ ts: now.toISOString(), level, category: e.category, where: e.where, what: e.what, requestId: e.requestId, ...(e.context ?? {}), error: safe, hint });
  }
  const lines = [`[${now.toISOString()}] ${level} ${e.category}  ${e.where}${e.requestId ? `  (request ${e.requestId})` : ""}`, `  What:   ${e.what}`];
  if (summary) {
    const bits = [summary.name, summary.code, summary.table && `table ${summary.table}`, summary.constraint && `constraint ${summary.constraint}`].filter(Boolean).join(" / ");
    lines.push(`  Why:    ${bits}${summary.message ? ` - ${summary.message}` : ""}`);
  }
  if (e.context && Object.keys(e.context).length) lines.push(`  Facts:  ${Object.entries(e.context).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  if (hint) lines.push(`  Check:  ${hint}`);
  const stack = shortStack(e.err);
  if (stack) lines.push(`  Stack:  ${stack}`);
  return lines.join("\n");
}

function emit(level: Level, e: LogInput): void {
  const key = [level, e.category, e.where, e.what, e.err !== undefined ? describeError(e.err).code ?? describeError(e.err).name : ""].join("|");
  const now = Date.now();
  const prev = seen.get(key);
  if (prev && now - prev.at < DEDUPE_MS) { prev.suppressed++; return; }
  const extra = prev && prev.suppressed > 0 ? `  (${prev.suppressed} similar message${prev.suppressed === 1 ? "" : "s"} in the last ${Math.round(DEDUPE_MS / 1000)}s not shown)` : "";
  if (seen.size >= MAX_KEYS) seen.clear();
  seen.set(key, { at: now, suppressed: 0 });
  const text = formatEntry(level, e) + (isDevelopment() ? (extra ? `\n${extra.trim()}` : "") : extra ? ` ${extra.trim()}` : "");
  (level === "ERROR" ? console.error : console.warn)(text);
}

/** Reports a failure. Returns the request id used (so it can be shown to the user), generating one when none was given. */
export function logError(e: LogInput): string {
  const requestId = e.requestId ?? newRequestId();
  emit("ERROR", { ...e, requestId });
  return requestId;
}

export function logWarn(e: LogInput): void {
  emit("WARN", e);
}
