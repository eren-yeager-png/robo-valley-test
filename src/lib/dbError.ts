// What went wrong with a database call: one word for the friendly message, and one safe line for the server log.
//
// The log line carries the real cause so an operator can act on it ("relation \"sectors\" does not exist" means a migration is missing),
// but never data: it holds the SQLSTATE / network code, and Postgres' own message ONLY for the "something is missing from the schema"
// codes, whose messages name a table, column, function or schema and nothing else. Every other message is left out on purpose (a
// constraint or type error can quote a value), as are connection strings, host names and stack traces.

export type DbProblem = "not_set_up" | "unreachable" | "error";

// undefined_table, undefined_column, undefined_function, invalid_schema_name: the database has not had the needed migration yet
const SCHEMA_MISSING = new Set(["42P01", "42703", "42883", "3F000"]);
// connection_exception (08xxx), insufficient_resources (53xxx), admin/crash shutdown and cannot_connect_now (57P01-57P03)
const UNREACHABLE_SQLSTATE = /^(08...|53...|57P0[1-3])$/;
const UNREACHABLE_NODE = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "EPIPE"]);

const codeOf = (e: unknown): string => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" && /^[A-Z0-9_]{2,20}$/.test(c) ? c : "";
};

/** not_set_up = a table or column is missing (apply the migrations); unreachable = no connection; error = anything else. */
export function dbProblem(e: unknown): DbProblem {
  const c = codeOf(e);
  if (SCHEMA_MISSING.has(c)) return "not_set_up";
  if (UNREACHABLE_SQLSTATE.test(c) || UNREACHABLE_NODE.has(c)) return "unreachable";
  const m = String((e as { message?: unknown } | null)?.message ?? "");
  if (!c && /connection (terminated|timeout)|timeout exceeded when trying to connect/i.test(m)) return "unreachable"; // pg's own pool timeouts carry no code
  return "error";
}

/** One line for the server log. Example: `admin sector counts: database error 42P01 (relation "sectors" does not exist)`. */
export function dbLogLine(where: string, e: unknown): string {
  const c = codeOf(e), kind = dbProblem(e);
  const msg = String((e as { message?: unknown } | null)?.message ?? "").replace(/\s+/g, " ").trim();
  const detail = kind === "not_set_up" && msg ? msg.slice(0, 160) : kind === "unreachable" ? "the database could not be reached" : "details left out of the log";
  return `${where}: database error ${c || "without a code"} (${detail})`;
}

export function logDbError(where: string, e: unknown): DbProblem {
  console.error(dbLogLine(where, e));
  return dbProblem(e);
}
