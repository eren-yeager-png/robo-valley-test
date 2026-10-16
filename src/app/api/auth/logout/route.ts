import { NextResponse } from "next/server";
import { json, sameOrigin } from "../../../../lib/http";
import { SESSION_COOKIE, sessionCookieOptions } from "../../../../lib/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ success: false, error: "FORBIDDEN", message: "Request blocked." }, 403);
  const res = NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0)); // expire the cookie
  return res;
}
