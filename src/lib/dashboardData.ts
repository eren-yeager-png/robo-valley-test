// Dashboard data. Everything here is scoped to ONE user id taken from the verified server session,
// never from a request parameter. Only the user's own `users` row and their own `guardian_details`
// row are read. Password hashes, OTP state and guardian contact details are never selected.

import { pool } from "./db";
import { ROLE_FIELDS } from "./roles";

export type GuardianStatus = {
  guardianName: string;
  relationship: string;
  consentStatus: string; // 'pending' | 'granted' | 'denied'
  consentMode: string; // 'test' = not legally verified consent
  recordedAt: string | null;
};

export type Account = {
  id: string;
  fullName: string;
  email: string;
  mobile: string | null;
  district: string | null;
  language: string | null;
  role: string;
  ageCategory: "adult" | "minor" | null;
  emailVerification: string;
  createdAt: string;
  profile: Record<string, string | string[]>;
  profileSkipped: boolean;
  guardian: GuardianStatus | null;
};

export type LoadResult = { ok: true; account: Account } | { ok: false; reason: "not_found" | "error" };

export async function loadAccount(userId: string): Promise<LoadResult> {
  try {
    const u = await pool.query(
      `SELECT id, full_name, email, mobile, district, preferred_language, role, age_category,
              email_verification, created_at, profile, consents
         FROM users WHERE id = $1`,
      [userId]
    );
    const row = u.rows[0];
    if (!row) return { ok: false, reason: "not_found" };

    let guardian: GuardianStatus | null = null;
    if (row.age_category === "minor") {
      const g = await pool.query(
        `SELECT guardian_name, guardian_relationship, consent_status, consent_mode, consent_recorded_at
           FROM guardian_details WHERE user_id = $1`,
        [userId]
      );
      const gr = g.rows[0];
      if (gr) {
        guardian = {
          guardianName: gr.guardian_name, relationship: gr.guardian_relationship,
          consentStatus: gr.consent_status, consentMode: gr.consent_mode,
          recordedAt: gr.consent_recorded_at ? new Date(gr.consent_recorded_at).toISOString() : null,
        };
      }
    }
    return {
      ok: true,
      account: {
        id: String(row.id), fullName: row.full_name, email: row.email, mobile: row.mobile,
        district: row.district, language: row.preferred_language, role: row.role,
        ageCategory: row.age_category === "adult" || row.age_category === "minor" ? row.age_category : null,
        emailVerification: row.email_verification,
        createdAt: new Date(row.created_at).toISOString(),
        profile: row.profile && typeof row.profile === "object" ? row.profile : {},
        profileSkipped: row.consents?.profileSkipped === true,
        guardian,
      },
    };
  } catch {
    console.error("dashboard: account lookup failed"); // no SQL, ids or details in logs
    return { ok: false, reason: "error" };
  }
}

const answered = (v: unknown) => (Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.trim() !== "");

/** Share of this role's profile questions that are answered, plus which required ones are missing. */
export function profileCompleteness(role: string, profile: Account["profile"]) {
  const fields = ROLE_FIELDS[role] ?? [];
  const done = fields.filter((f) => answered(profile[f.key])).length;
  return {
    total: fields.length,
    done,
    percent: fields.length ? Math.round((done / fields.length) * 100) : 100,
    missingRequired: fields.filter((f) => f.required && !answered(profile[f.key])).map((f) => f.label),
  };
}

export type Task = { id: string; title: string; detail: string; href?: string; tone: "action" | "info" };

/** Real tasks/notices derived from the user's own record. No invented items. */
export function deriveTasks(a: Account): Task[] {
  const tasks: Task[] = [];
  const c = profileCompleteness(a.role, a.profile);
  if (c.missingRequired.length) {
    tasks.push({
      id: "profile", tone: "action", href: "/dashboard/profile",
      title: "Complete your profile",
      detail: `Still needed: ${c.missingRequired.join(", ")}.`,
    });
  }
  if (a.ageCategory === "minor" && a.guardian && a.guardian.consentStatus !== "granted") {
    tasks.push({
      id: "consent", tone: "info", href: "/dashboard/profile",
      title: "Parent or guardian consent is pending",
      detail: "Until it is confirmed you can browse projects but cannot chat, book mentors or join teams.",
    });
  }
  if (a.emailVerification === "mock") {
    tasks.push({
      id: "mock-email", tone: "info",
      title: "Your email was verified in test mode",
      detail: "This account was created with the development mock code, so it is not a verified email address.",
    });
  }
  return tasks;
}
