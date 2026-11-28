// Notifications of the contribution workflow, sent through Resend (lib/email.ts) AFTER a change has been saved. They never block,
// slow down or undo the change: a failed email is logged with a label only (never an address or a title) and forgotten.
//   submitted -> the Moderators (if there are none yet: the Admins)
//   sent      -> the Admins (a publishing request or a resubmission)
//   changes   -> the Moderator of the idea (if none: the Moderators)
//   reopened  -> the Moderator of the idea (if none: the Moderators): an Admin reopened a rejected idea
//   published / rejected -> the contributor, when the account still exists
// Emails hold the RV number and a link to the right page; the contributor's own email adds the title of their idea.
import { after } from "next/server";
import { pool as defaultPool } from "../db";
import { sendWorkflowEmail } from "../email";
import { moderatorEmails } from "../moderators";
import { appBaseUrl } from "../passwordReset";
import { esc } from "../../../public/cw/js/utils.js";

export type NotifyEvent = "submitted" | "sent" | "changes" | "reopened" | "published" | "rejected";
type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
type Send = (to: string, subject: string, text: string, html: string) => Promise<unknown>;
type Mail = { to: string; subject: string; text: string; html: string };

const valid = (list: string[]) => list.map((e) => e.trim()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
const emails = async (db: Q, sql: string, params: unknown[] = []) => valid((await db.query(sql, params)).rows.map((r) => String(r.email ?? "")));
const moderators = async (db: Q) => valid(await moderatorEmails(db)); // the moderator flag is only read in lib/moderators.ts
const admins = (db: Q) => emails(db, "SELECT email FROM users WHERE role = 'admin' ORDER BY id");

/** The emails for an event (exported for tests). [] when the idea does not exist. */
export async function buildNotices(event: NotifyEvent, id: number, db: Q = defaultPool as never, base = appBaseUrl() ?? ""): Promise<Mail[]> {
  const c = (await db.query("SELECT id, user_id, status, original, moderator_id FROM cw_contributions WHERE id = $1", [id])).rows[0];
  if (!c) return [];
  const code = `RV-${c.id}`;
  const link = (path: string) => (base ? base + path : "");
  const mail = (to: string[], subject: string, line: string, path: string) => {
    const url = link(path);
    return to.map((addr) => ({
      to: addr, subject,
      text: `${line}${url ? `\n\nOpen it: ${url}` : ""}\n\nRoboValley`,
      html: `<p>${esc(line)}</p>${url ? `<p><a href="${esc(url)}">Open it</a></p>` : ""}<p style="color:#56675f">RoboValley</p>`,
    }));
  };
  switch (event) {
    case "submitted": {
      let to = await moderators(db);
      if (!to.length) to = await admins(db);
      return mail(to, `New idea ${code} to review`, `A new idea (${code}) was shared and waits for review in the Moderator Workspace.`, "/admin/workspace");
    }
    case "sent":
      return mail(await admins(db), `Publishing request for ${code}`, `A Moderator sent a publishing request for ${code}. It waits for you in the Admin Approval Dashboard.`, "/admin/approvals");
    case "changes":
    case "reopened": {
      let to = c.moderator_id ? await emails(db, "SELECT email FROM users WHERE id = $1", [c.moderator_id]) : [];
      if (!to.length) to = await moderators(db);
      return event === "changes"
        ? mail(to, `Changes requested for ${code}`, `An Admin asked for changes to ${code}. It is back in the Moderator Workspace with the Admin's feedback.`, "/admin/workspace")
        : mail(to, `${code} reopened for review`, `An Admin reopened ${code}. It is back in the Moderator Workspace (Under Moderator Review) with the Admin's reason.`, "/admin/workspace");
    }
    case "published":
    case "rejected": {
      if (!c.user_id) return [];
      const to = await emails(db, "SELECT email FROM users WHERE id = $1", [c.user_id]);
      const title = String((typeof c.original === "string" ? JSON.parse(c.original) : c.original)?.title ?? "");
      const line = event === "published"
        ? `Good news: your idea "${title}" (${code}) has been published on RoboValley's Community Ideas page.`
        : `Your idea "${title}" (${code}) was reviewed and will not be published this time. Thank you for sharing it.`;
      return mail(to, event === "published" ? `Your idea ${code} is published` : `About your idea ${code}`, line, "/my-contributions");
    }
    default:
      return [];
  }
}

/** Sends the notices for an event now; resolves to the number sent. Errors are swallowed (logged as a label). */
export async function notifyNow(event: NotifyEvent, id: number, opts: { db?: Q; send?: Send; base?: string } = {}): Promise<number> {
  const send: Send = opts.send ?? ((to, subject, text, html) => sendWorkflowEmail(to, subject, text, html));
  let sent = 0;
  try {
    for (const m of await buildNotices(event, id, opts.db ?? (defaultPool as never), opts.base ?? appBaseUrl() ?? "")) {
      try { await send(m.to, m.subject, m.text, m.html); sent++; } catch { console.error(`cw notify ${event}: an email could not be sent`); }
    }
  } catch {
    console.error(`cw notify ${event}: could not prepare the notices`);
  }
  return sent;
}

/** After the change is saved: the response never waits for email. Uses Next's after() (finished even on serverless once the response
 *  is sent); outside a request (tests, scripts) it simply runs in the background. */
export function notifyAfter(event: NotifyEvent, id: number): void {
  const job = () => notifyNow(event, id).catch(() => 0);
  try { after(job); } catch { void job(); }
}
