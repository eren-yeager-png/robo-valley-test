
import { NextResponse } from "next/server";
import { sameOrigin } from "../../../../lib/http";
import { SESSION_COOKIE, sessionCookieOptions } from "../../../../lib/session";

export const runtime = "nodejs";

const ALLOWED_ORIGINS = [
  "https://techytree.in",
  "https://www.techytree.in",
];

function isTrustedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");

  // Preserve existing same-origin and no-Origin behavior.
  if (!origin) return sameOrigin(req);

  // Allow only the exact WordPress origins.
  return ALLOWED_ORIGINS.includes(origin) || sameOrigin(req);
}

function addCorsHeaders(res: NextResponse, req: Request): NextResponse {
  const origin = req.headers.get("origin");

  res.headers.append("Vary", "Origin");

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Access-Control-Allow-Credentials", "true");
  }

  return res;
}

export async function OPTIONS(req: Request) {
  if (!isTrustedOrigin(req)) {
    return NextResponse.json(
      { success: false, error: "FORBIDDEN" },
      { status: 403 }
    );
  }

  const res = new NextResponse(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
      "Allow": "POST, OPTIONS",
    },
  });

  const origin = req.headers.get("origin");

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Access-Control-Allow-Credentials", "true");
    res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Content-Type");
    res.headers.set("Access-Control-Max-Age", "600");
  }

  res.headers.append("Vary", "Origin");
  return res;
}

export async function POST(req: Request) {
  if (!isTrustedOrigin(req)) {
    return NextResponse.json(
      { success: false, error: "FORBIDDEN", message: "Request blocked." },
      { status: 403 }
    );
  }

  const res = NextResponse.json(
    { success: true },
    { headers: { "Cache-Control": "no-store" } }
  );

  res.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));

  return addCorsHeaders(res, req);
}
