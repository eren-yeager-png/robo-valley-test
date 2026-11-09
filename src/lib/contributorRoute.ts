// Turns a contributionApi result into the HTTP answer (with CORS), so every route reads the same.
import { json } from "./http";
import { withCors } from "./cors";
import type { Fail } from "./contributionApi";

export function answer(req: Request, methods: string, r: ({ ok: true } & Record<string, unknown>) | Fail, okStatus = 200): Response {
  if (r.ok) {
    const { ok: _ok, ...rest } = r as { ok: true } & Record<string, unknown>;
    return withCors(req, json({ success: true, ...rest }, okStatus), methods);
  }
  const f = r as Fail;
  return withCors(req, json({ success: false, error: f.error, message: f.message, ...(f.fieldErrors ? { fieldErrors: f.fieldErrors } : {}) }, f.status), methods);
}
