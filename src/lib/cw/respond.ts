// Shared answers of the contribution workflow's API routes: never cached, CORS like every other contribution route, and plain
// messages only (never a database error).
import { json } from "../http";
import { withCors } from "../cors";
import { NotSetUp, type Fail } from "./store";
import { MESSAGES } from "./shared";

export const NO_STORE = { "Cache-Control": "no-store" };
export const ok = (req: Request, body: unknown, methods: string, status = 200) => withCors(req, json({ success: true, ...(body as object) }, status, NO_STORE), methods);
export const failed = (req: Request, f: Fail, methods: string) => withCors(req, json({ success: false, error: f.error, message: f.message }, f.status, NO_STORE), methods);

/** A thrown error: "not set up yet" (migration 027 or 028 missing) or a plain server error. Logs only a label, never data. */
export function crashed(req: Request, e: unknown, methods: string, label: string) {
  if (e instanceof NotSetUp) return withCors(req, json({ success: false, error: "NOT_SET_UP", message: "The contribution workflow is not set up yet. Please try again later." }, 503, NO_STORE), methods);
  console.error(`cw ${label} failed: server error`);
  return withCors(req, json({ success: false, error: "SERVER_ERROR", message: MESSAGES.failed }, 500, NO_STORE), methods);
}
