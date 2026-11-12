import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../lib/db";
import { allowedOrigins } from "../../../../lib/cors";
import { sameOrigin } from "../../../../lib/http";
import { firstNameOf, getCurrentUser } from "../../../../lib/currentUser";
import { reviewerOf } from "../../../../lib/moderators";
import { ROLES } from "../../../../lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The header account menu (public/rv-header-menu.js, on techytree.in and on the app's own pages) asks here who is signed in.
 * It gets only what the menu draws: the menu role, the first name and its initial, the stakeholder label (members) and the one
 * count that role's menu shows. No email, no id, no full name. Display only: every admin and moderation page and API checks the
 * role again on the server, so a changed answer here opens nothing.
 * Same origin rule as /api/auth/session: the configured site origins (ALLOWED_ORIGINS) and this app itself; anything else gets 403.
 */
export type MenuRole = "member" | "moderator" | "admin";
export type MenuCounts = { myContributions: number } | { reviewQueue: number };
export type MenuAnswer =
  | { authenticated: false }
  | { authenticated: true; role: MenuRole; firstName: string; initial: string; stakeholder: string | null; counts: MenuCounts | null };

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

/** The number next to "My contributions" (the rows My Contributions lists) or "Review queue" (the "Pending review" tile on /moderation). */
async function countsFor(role: MenuRole, userId: number): Promise<MenuCounts | null> {
  try {
    if (role === "member") {
      const r = await pool.query("SELECT count(*)::int AS n FROM contributions WHERE user_id = $1", [userId]);
      return { myContributions: Number(r.rows[0]?.n ?? 0) };
    }
    const r = await pool.query("SELECT count(*)::int AS n FROM contributions WHERE status = 'pending_review' AND NOT is_demo");
    return { reviewQueue: Number(r.rows[0]?.n ?? 0) };
  } catch {
    console.error("header menu: the count could not be read"); // the menu is then shown without its badge
    return null;
  }
}

export async function GET(req: NextRequest) {
  const origin = allowedOrigin(req);
  if (origin === false) return reply({ authenticated: false, error: "ORIGIN_NOT_ALLOWED" }, 403, null);
  try {
    const user = await getCurrentUser(); // verifies the signed cookie and re-reads the account (role, verification, password change)
    if (!user) return reply({ authenticated: false } satisfies MenuAnswer, 200, origin);
    const id = Number(user.id);
    const role: MenuRole = user.role === "admin" ? "admin" : (await reviewerOf(pool as never, id)).ok ? "moderator" : "member";
    const firstName = firstNameOf(user.fullName) ?? "";
    const initial = (Array.from(firstName)[0] ?? "?").toLocaleUpperCase("en-IN");
    const stakeholder = role === "member" ? (ROLES.find((r) => r[0] === user.role)?.[1] ?? null) : null;
    const body: MenuAnswer = { authenticated: true, role, firstName, initial, stakeholder, counts: await countsFor(role, id) };
    return reply(body, 200, origin);
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
