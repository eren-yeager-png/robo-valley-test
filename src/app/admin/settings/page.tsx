import type { Metadata } from "next";
import { pool } from "../../../lib/db";
import { requireAdminPage } from "../../../lib/adminPage";
import { tableExists } from "../../../lib/adminStats";
import { RETENTION_DAYS } from "../../../lib/loginEvents";
import { REMEMBER_TTL_SECONDS, SESSION_TTL_SECONDS } from "../../../lib/session";
import ChangePasswordForm from "../dashboard/ChangePasswordForm";
import { PageHeader } from "../_components/ui";

export const metadata: Metadata = { title: "Settings | RoboValley admin", robots: { index: false, follow: false } };

export default async function SettingsPage() {
  const admin = await requireAdminPage();
  if (admin.mustChangePassword) return null;
  const [events, files] = await Promise.all([tableExists(pool, "login_events"), tableExists(pool, "upload_attachments")]);
  const status = (ok: boolean) => <span className={"adm-pill" + (ok ? "" : " warn")}>{ok ? "Ready" : "Not set up yet"}</span>;
  return (
    <>
      <PageHeader title="Settings" lead="Your administrator account and the state of the optional features." />
      <div className="adm-grid two">
        <section className="adm-card">
          <h3>Your account</h3>
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px" }}>
            <dt className="muted">Name</dt><dd style={{ margin: 0 }}>{admin.fullName}</dd>
            <dt className="muted">Email</dt><dd style={{ margin: 0, overflowWrap: "anywhere" }}>{admin.email}</dd>
            <dt className="muted">Role</dt><dd style={{ margin: 0 }}>Administrator</dd>
            <dt className="muted">Sign-in lasts</dt><dd style={{ margin: 0 }}>{SESSION_TTL_SECONDS / 3600} hours, or {REMEMBER_TTL_SECONDS / 86400} days with &ldquo;Remember me&rdquo;</dd>
          </dl>
        </section>
        <section className="adm-card"><ChangePasswordForm voluntary /></section>
        <section className="adm-card">
          <h3>Features that need a database update</h3>
          <table className="adm-table"><tbody>
            <tr><td>Login activity and sign-in charts (migration 008)</td><td>{status(events)}</td></tr>
            <tr><td>Stored files and downloads (migration 009)</td><td>{status(files)}</td></tr>
          </tbody></table>
          <p className="muted" style={{ marginTop: 10 }}>Migrations are applied by a developer with the migration runner. This page only reports what exists.</p>
        </section>
        <section className="adm-card">
          <h3>Data handling</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>Login events are deleted automatically after {RETENTION_DAYS} days.</li>
            <li>They never contain passwords, one-time codes or IP addresses.</li>
            <li>Uploaded files up to 4 MB: xlsx, csv, pdf, docx, png, jpg, txt.</li>
            <li>One live dataset per category; uploading to one category never changes another.</li>
          </ul>
        </section>
      </div>
    </>
  );
}
