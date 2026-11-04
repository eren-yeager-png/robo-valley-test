import type { Metadata } from "next";
import { pool } from "../../../lib/db";
import { requireAdminPage } from "../../../lib/adminPage";
import { RETENTION_DAYS } from "../../../lib/loginEvents";
import { REMEMBER_TTL_SECONDS, SESSION_TTL_SECONDS } from "../../../lib/session";
import { migrationStatus, pending } from "../../../../scripts/migration-status.mjs";
import ChangePasswordForm from "../dashboard/ChangePasswordForm";
import { DataTable, PageHeader } from "../_components/ui";

export const metadata: Metadata = { title: "Settings | RoboValley admin", robots: { index: false, follow: false } };

type Row = { id: string; title: string; feature: string; status: "applied" | "missing" | "partial"; absent: string[]; blockedBy: string[] };
const PILL: Record<string, string> = { applied: "Applied", missing: "Missing", partial: "Partly applied" };

export default async function SettingsPage() {
  const admin = await requireAdminPage();
  if (admin.mustChangePassword) return null;

  // Read-only look at which migrations the database has. A failure here shows a plain message, never the database error.
  let rows: Row[] | null = null;
  try { rows = (await migrationStatus((sql: string) => pool.query(sql))) as Row[]; } catch { console.error("admin settings: could not read the schema status"); }
  const todo = rows ? (pending(rows) as Row[]) : [];

  return (
    <>
      <PageHeader title="Settings" lead="Your administrator profile and the state of this database." />

      <section id="profile" aria-labelledby="profile-h">
        <h2 id="profile-h" style={{ fontSize: "1.15rem", margin: "0 0 12px" }}>My profile</h2>
        <div className="adm-grid two">
          <div className="adm-card">
            <h3>Account</h3>
            <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px" }}>
              <dt className="muted">Name</dt><dd style={{ margin: 0 }}>{admin.fullName}</dd>
              <dt className="muted">Email</dt><dd style={{ margin: 0, overflowWrap: "anywhere" }}>{admin.email}</dd>
              <dt className="muted">Role</dt><dd style={{ margin: 0 }}>Administrator</dd>
              <dt className="muted">Sign-in lasts</dt><dd style={{ margin: 0 }}>{SESSION_TTL_SECONDS / 3600} hours, or {REMEMBER_TTL_SECONDS / 86400} days with &ldquo;Remember me&rdquo;</dd>
            </dl>
          </div>
          <div className="adm-card"><ChangePasswordForm voluntary /></div>
        </div>
      </section>

      <section id="database-setup" aria-labelledby="db-h" style={{ marginTop: 8 }}>
        <h2 id="db-h" style={{ fontSize: "1.15rem", margin: "0 0 12px" }}>Database setup</h2>
        {rows === null ? (
          <div className="adm-note">The database structure could not be checked right now. Try again in a moment.</div>
        ) : (
          <>
            <DataTable caption="Database migrations" head={["Migration", "What it enables", "Status"]}
              rows={rows.map((m) => (
                <tr key={m.id}>
                  <td><strong>{m.id}</strong> {m.title}</td>
                  <td>{m.feature}{m.status === "partial" && <div className="muted" style={{ fontSize: ".8rem" }}>Incomplete: {m.absent.join(", ")}</div>}</td>
                  <td><span className={"adm-pill" + (m.status === "applied" ? "" : m.status === "partial" ? " warn" : " bad")}>{PILL[m.status]}</span></td>
                </tr>
              ))} />
            {todo.length === 0 ? (
              <p className="muted" style={{ marginTop: 10 }}>Everything is applied. Nothing to do here.</p>
            ) : (
              <div className="adm-card" style={{ marginTop: 14 }}>
                <h3>For the developer: applying {todo.map((m) => m.id).join(", ")}</h3>
                <p className="muted" style={{ margin: "0 0 4px" }}>These steps change a database, so they are done by a person with access, never from this page. For a live database, get approval first.</p>
                <ol className="adm-steps">
                  <li>Check you are pointed at the right database, and that a recent backup exists.</li>
                  <li>See the current state (read-only):<div className="adm-code">npm run db:migrate -- --expect-db &lt;database name&gt; --status</div></li>
                  <li>Dry run, which shows what would run and changes nothing:<div className="adm-code">{todo.map((m) => `npm run db:migrate -- --expect-db <database name> --only ${m.id}`).join("\n")}</div></li>
                  <li>Apply, one migration at a time, in this order:<div className="adm-code">{todo.map((m) => `npm run db:migrate -- --expect-db <database name> --only ${m.id} --apply`).join("\n")}</div></li>
                  <li>Run <code>--status</code> again. This notice disappears by itself once everything shows Applied.</li>
                </ol>
              </div>
            )}
          </>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <div className="adm-card">
          <h3>Data handling</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>Login events are deleted automatically after {RETENTION_DAYS} days.</li>
            <li>They never contain passwords, one-time codes or IP addresses.</li>
            <li>Uploaded files up to 4 MB: xlsx, csv, pdf, docx, png, jpg, txt.</li>
            <li>One live dataset per category; uploading to one category never changes another.</li>
          </ul>
        </div>
      </section>
    </>
  );
}
