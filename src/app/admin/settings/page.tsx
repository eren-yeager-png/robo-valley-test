import type { Metadata } from "next";
import { pool } from "../../../lib/db";
import { requireAdminPage } from "../../../lib/adminPage";
import { RETENTION_DAYS } from "../../../lib/loginEvents";
import { REMEMBER_TTL_SECONDS, SESSION_TTL_SECONDS } from "../../../lib/session";
import { migrationStatus } from "../../../../scripts/migration-status.mjs";
import ChangePasswordForm from "../dashboard/ChangePasswordForm";
import { DataTable, PageHeader } from "../_components/ui";
import { logError } from "../../../lib/logger";

export const metadata: Metadata = { title: "Settings | RoboValley admin", robots: { index: false, follow: false } };

type Row = { id: string; title: string; feature: string; status: "applied" | "missing" | "partial"; absent: string[]; blockedBy: string[] };

export default async function SettingsPage() {
  const admin = await requireAdminPage();
  if (admin.mustChangePassword) return null;

  // Read-only look at which optional features the database can support. A failure shows a plain message and is reported
  // in the server terminal (with the reason); the database error itself is never shown here.
  let features: { name: string; status: "available" | "partial" | "missing" }[] | null = null;
  try {
    const all = (await migrationStatus((sql: string) => pool.query(sql))) as Row[];
    const of = (id: string) => { const st = all.find((m) => m.id === id)?.status ?? "missing"; return st === "applied" ? "available" as const : st; };
    features = [
      { name: "Login activity and sign-in charts", status: of("008") },
      { name: "Stored files and downloads", status: of("009") },
    ];
  } catch (err) { logError({ category: "MIGRATION", where: "admin/settings", what: "Could not read which database migrations are applied", err }); }

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
          <ChangePasswordForm voluntary />
        </div>
      </section>

      <section id="features" aria-labelledby="features-h" style={{ marginTop: 8 }}>
        <h2 id="features-h" style={{ fontSize: "1.15rem", margin: "0 0 12px" }}>Feature availability</h2>
        {features === null ? (
          <div className="adm-note">Feature availability could not be checked right now. Try again in a moment.</div>
        ) : (
          <DataTable caption="Feature availability" head={["Feature", "Status"]}
            rows={features.map((f) => (
              <tr key={f.name}>
                <td>{f.name}</td>
                <td><span className={"adm-pill" + (f.status === "available" ? "" : f.status === "partial" ? " warn" : " mute")}>{f.status === "available" ? "Available" : f.status === "partial" ? "Partly available" : "Not available yet"}</span></td>
              </tr>
            ))} />
        )}
        {features !== null && features.some((f) => f.status !== "available") && (
          <p className="muted" style={{ marginTop: 10 }}>Features marked as not available are waiting for a system update. Please contact your technical team; this page updates by itself once it is done.</p>
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
