// Safe server-side diagnostics for unexpected errors.
//
// WHY: routes answer unexpected failures with a generic 500 so clients never see internals. That also hid the real
// cause from the logs. This turns an error into a short, SAFE description for console.error:
//   * error name, a PostgreSQL / network error code (e.g. 42P01 = table missing, ECONNREFUSED, 28P01 = bad password),
//     and the table / constraint name when the database reports one;
//   * a message that is shortened and has anything sensitive masked: connection URLs, email addresses, API keys,
//     6-digit codes and long token-like strings.
// It never logs request bodies, environment variables, passwords, OTP codes or tokens.

import { randomUUID } from "node:crypto";

/**
 * Short id that appears in the log line AND in the 500 response, so one can be matched to the other.
 * Format "a1b2-c3d4-e5f6": the dashes guarantee it can never contain a run of six digits, which could be
 * mistaken for (or flagged as) an OTP code.
 */
export const newRequestId = (): string => {
  const h = randomUUID().replace(/-/g, "");
  return `${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}`;
};

export function redact(text: string): string {
  return text
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"<>]+/gi, "[url]") // postgres://user:pass@host/db, https://...
    .replace(/[^\s@'"<>()[\]]+@[^\s@'"<>()[\]]+/g, "[email]")
    .replace(/\bre_[A-Za-z0-9_]{8,}\b/g, "[api-key]") // Resend keys
    .replace(/\b\d{6}\b/g, "[6-digits]") // OTP-looking numbers
    .replace(/[A-Za-z0-9+/_=-]{32,}/g, "[long-token]"); // hashes, tokens, secrets
}

const ident = (v: unknown): string | undefined =>
  typeof v === "string" && /^[A-Za-z0-9_.$-]{1,63}$/.test(v) ? v : undefined;

/** Vercel request ids look like "bom1::abcde-1792760917805-7e89d3b41bd6" (letters, digits, "-", "_", ":"). */
const vercelId = (v: string | null): string | undefined => (v && /^[A-Za-z0-9:_.-]{1,120}$/.test(v) ? v : undefined);

export type ErrorSummary = {
  name: string;
  code?: string;
  table?: string;
  constraint?: string;
  routine?: string;
  message: string;
};

export function describeError(err: unknown): ErrorSummary {
  const e = (err ?? {}) as Record<string, unknown>;
  const first = Array.isArray(e.errors) ? (e.errors[0] as Record<string, unknown> | undefined) : undefined; // AggregateError (e.g. IPv4+IPv6 connect failures)
  return {
    name: ident(e.name) ?? typeof err,
    code: ident(e.code) ?? ident(first?.code),
    table: ident(e.table),
    constraint: ident(e.constraint),
    routine: ident(e.routine),
    message: redact(String(e.message ?? "")).slice(0, 200),
  };
}

/** One-line JSON log entry for an unexpected failure. `context` must contain only non-sensitive facts. */
export function logUnexpected(event: string, requestId: string, req: Request, err: unknown, context: Record<string, string | number | boolean> = {}): void {
  console.error(
    event,
    JSON.stringify({ requestId, vercelId: vercelId(req.headers.get("x-vercel-id")), ...context, error: describeError(err) })
  );
}
