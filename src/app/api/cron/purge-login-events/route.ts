import { createHash, timingSafeEqual } from "node:crypto";
import { json } from "../../../../lib/http";
import { pool } from "../../../../lib/db";
import { purgeOldLoginEvents, RETENTION_DAYS } from "../../../../lib/loginEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sha = (s: string) => createHash("sha256").update(s).digest();

/**
 * Scheduled retention clean-up (see vercel.json): removes login events older than RETENTION_DAYS. Vercel Cron calls this
 * with "Authorization: Bearer <CRON_SECRET>". Not an admin session endpoint: without the secret nothing runs, and when
 * CRON_SECRET is not configured the route refuses everything (fail closed). It deletes only from login_events.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 16) return json({ success: false, error: "NOT_CONFIGURED", message: "CRON_SECRET is not set." }, 503);
  const given = req.headers.get("authorization") ?? "";
  if (!timingSafeEqual(sha(given), sha(`Bearer ${secret}`))) return json({ success: false, error: "UNAUTHORIZED", message: "Not allowed." }, 401);
  try {
    const removed = await purgeOldLoginEvents(pool);
    return json({ success: true, retentionDays: RETENTION_DAYS, removed, ...(removed === null ? { note: "login_events does not exist yet" } : {}) });
  } catch {
    console.error("login events clean-up failed");
    return json({ success: false, error: "SERVER_ERROR", message: "Clean-up failed. Nothing else was changed." }, 500);
  }
}
