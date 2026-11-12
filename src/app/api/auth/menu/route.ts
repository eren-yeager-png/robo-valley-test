import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../lib/db";
import { allowedOrigins } from "../../../../lib/cors";
import { sameOrigin } from "../../../../lib/http";
import { getCurrentUser } from "../../../../lib/currentUser";
import { headerMenuFor } from "../../../../lib/headerMenu";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The shared header account menu (public/rv-header-menu.js, on techytree.in and on the app's own pages) asks here who is signed in.
 * The answer (src/lib/headerMenu.ts) has only what the menu draws: no email, no id, no full name. Never cached.
 * Same origin rule as /api/auth/session: the configured site origins (ALLOWED_ORIGINS) and this app itself; anything else gets 403.
 */
function allowedOrigin(req: Request): string | null | false {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  if (allowedOrigins().includes(origin)) return origin;
  if (sameOrigin(req)) return null;
  return false;
}

function reply(body: unknown, status: number, origin: string | null) {
  const res = NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  res.headers.append("Vary", "Origin");
  if (origin) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Access-Control-Allow-Credentials", "true");
  }
  return res;
}

export async function GET(req: NextRequest) {
  const origin = allowedOrigin(req);
  if (origin === false) return reply({ authenticated: false, error: "ORIGIN_NOT_ALLOWED" }, 403, null);
  try {
    // getCurrentUser verifies the signed cookie and re-reads the account (verification, password change); headerMenuFor reads the role.
    return reply(await headerMenuFor(pool as never, await getCurrentUser()), 200, origin);
  } catch {
    console.error("header menu: the account could not be read");
    return reply({ authenticated: false, error: "SERVICE_UNAVAILABLE" }, 503, origin);
  }
}

export async function OPTIONS(req: Request) {
  const origin = allowedOrigin(req);
  if (origin === false) return new NextResponse(null, { status: 403 });
  const headers = new Headers({ "Cache-Control": "no-store", Allow: "GET, OPTIONS", Vary: "Origin" });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Max-Age", "600");
  }
  return new NextResponse(null, { status: 204, headers });
}
