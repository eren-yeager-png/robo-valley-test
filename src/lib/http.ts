import { NextResponse } from "next/server";

export const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

/**
 * CSRF defence in depth (the session cookie is also SameSite=Lax): if the browser sent an
 * Origin header it must match the Host. Non-browser clients send no Origin and are allowed.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

/** Reads and parses a JSON body, enforcing a size cap. Returns an error response on failure. */
export async function readJson(req: Request, maxBytes: number): Promise<{ body: unknown } | { error: NextResponse }> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return { error: json({ success: false, error: "REQUEST_TOO_LARGE", message: "Request is too large." }, 413) };
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { error: json({ success: false, error: "BAD_REQUEST", message: "Could not read the request." }, 400) };
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes) return { error: json({ success: false, error: "REQUEST_TOO_LARGE", message: "Request is too large." }, 413) };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { error: json({ success: false, error: "BAD_REQUEST", message: "Request body must be valid JSON." }, 400) };
  }
}
