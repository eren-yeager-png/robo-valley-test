// Cross-origin access for the WordPress site. Allowed origins come ONLY from the ALLOWED_ORIGINS environment variable
// (comma-separated, e.g. "https://techytree.in,https://www.techytree.in,http://localhost:8080"). Nothing is hard-coded,
// and when it is unset no cross-origin browser request is allowed. Credentials (the session cookie) are only ever
// allowed for these exact origins, never with a wildcard.

/** The configured origins, normalised to scheme://host[:port]. Invalid entries are ignored. */
export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  for (const raw of (env.ALLOWED_ORIGINS ?? "").split(",")) {
    const s = raw.trim();
    if (!s) continue;
    try {
      const u = new URL(s);
      if (u.protocol === "http:" || u.protocol === "https:") out.push(u.origin);
    } catch { /* ignore a malformed entry */ }
  }
  return out;
}

/** True when the browser's Origin header is this app itself (same host) or one of the configured origins. No Origin = not a browser cross-site call. */
export function originAllowed(req: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    if (new URL(origin).host === req.headers.get("host")) return true;
    return allowedOrigins(env).includes(new URL(origin).origin);
  } catch {
    return false;
  }
}

/** The origin to echo back in Access-Control-Allow-Origin, or null (same-origin / non-browser / not allowed). */
export function corsOrigin(req: Request, env: NodeJS.ProcessEnv = process.env): string | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  try {
    const o = new URL(origin).origin;
    return allowedOrigins(env).includes(o) ? o : null;
  } catch {
    return null;
  }
}

/** Adds the CORS headers (with credentials) to a response for an allowed origin. Always varies on Origin. */
export function withCors<T extends Response>(req: Request, res: T, methods = "GET, OPTIONS"): T {
  res.headers.append("Vary", "Origin");
  const o = corsOrigin(req);
  if (o) {
    res.headers.set("Access-Control-Allow-Origin", o);
    res.headers.set("Access-Control-Allow-Credentials", "true");
    res.headers.set("Access-Control-Allow-Methods", methods);
    res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  }
  return res;
}

/** Answer to a CORS preflight (OPTIONS): 204 for an allowed origin, 403 for any other browser origin. */
export function preflight(req: Request, methods: string): Response {
  if (req.headers.get("origin") && !originAllowed(req)) return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  const res = new Response(null, { status: 204, headers: { "Cache-Control": "no-store", Allow: methods } });
  res.headers.set("Access-Control-Max-Age", "600");
  return withCors(req, res, methods);
}
