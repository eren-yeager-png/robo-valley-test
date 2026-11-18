import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../lib/db";
import { allowedOrigins } from "../../../../lib/cors";
import { sameOrigin } from "../../../../lib/http";
import {
  assertSessionConfigured,
  canSignIn,
  SESSION_COOKIE,
  SessionConfigError,
  verifySessionToken,
} from "../../../../lib/session";
import { logError } from "../../../../lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


function getAllowedOrigin(req: Request): string | null | false {
  const origin = req.headers.get("origin");

  if (!origin) return null;
  if (allowedOrigins().includes(origin)) return origin;
  if (sameOrigin(req)) return null;

  return false;
}

function reply(
  body: unknown,
  status: number,
  origin: string | null
) {
  const res = NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

  res.headers.append("Vary", "Origin");

  if (origin) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Access-Control-Allow-Credentials", "true");
  }

  return res;
}

export async function GET(req: NextRequest) {
  const origin = getAllowedOrigin(req);

  if (origin === false) {
    return reply({ authenticated: false, error: "ORIGIN_NOT_ALLOWED" }, 403, null);
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;

  if (!token) {
    return reply({ authenticated: false }, 401, origin);
  }

  try {
    assertSessionConfigured();
  } catch (error) {
    if (error instanceof SessionConfigError) {
      logError({ category: "ENV", where: "api/auth/session", what: "SESSION_SECRET is not set or is too short, so the session check is unavailable", hint: "Set SESSION_SECRET (32 or more random characters) in .env.local, then restart the server." });
      return reply({ authenticated: false, error: "SERVICE_UNAVAILABLE" }, 503, origin);
    }
    throw error;
  }

  const session = verifySessionToken(token);

  if (!session) {
    return reply({ authenticated: false }, 401, origin);
  }

  try {
    const { rows } = await pool.query(
      "SELECT full_name, role, email_verification FROM users WHERE id = $1",
      [session.sub]
    );

    const user = rows[0];

    if (!user || !canSignIn(user.email_verification)) {
      return reply({ authenticated: false }, 401, origin);
    }

    return reply(
      {
        authenticated: true,
        user: {
          fullName: user.full_name,
          role: user.role,
        },
      },
      200,
      origin
    );
  } catch (err) {
    logError({ category: "DATABASE", where: "api/auth/session", what: "The session check could not look the account up", err });
    return reply({ authenticated: false, error: "SERVICE_UNAVAILABLE" }, 503, origin);
  }
}

export async function OPTIONS(req: Request) {
  const origin = getAllowedOrigin(req);

  if (origin === false) {
    return new NextResponse(null, { status: 403 });
  }

  const headers = new Headers({
    "Cache-Control": "no-store",
    "Allow": "GET, OPTIONS",
    "Vary": "Origin",
  });

  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Max-Age", "600");
  }

  return new NextResponse(null, { status: 204, headers });
}
