import { getCurrentUser } from "../../../../lib/currentUser";
import { pool } from "../../../../lib/db";
import { json, readJson, sameOrigin } from "../../../../lib/http";
import { LANGUAGES } from "../../../../lib/roles";
import { LIMITS, validateProfile } from "../../../../lib/validation";

export const runtime = "nodejs";

// The ONLY fields a user may change here. Role, email, age category, ids and consents are not
// editable through this endpoint, and any other key is rejected.
const ALLOWED = new Set(["fullName", "district", "language", "profile"]);

export async function PATCH(req: Request) {
  if (!sameOrigin(req)) return json({ success: false, error: "FORBIDDEN", message: "Request blocked." }, 403);

  // Identity and role come from the verified session + database, never from the request body.
  const me = await getCurrentUser();
  if (!me) return json({ success: false, error: "UNAUTHENTICATED", message: "Please sign in." }, 401);

  const parsed = await readJson(req, 16 * 1024);
  if ("error" in parsed) return parsed.error;
  const b = parsed.body;
  if (typeof b !== "object" || b === null || Array.isArray(b)) {
    return json({ success: false, error: "BAD_REQUEST", message: "Invalid request." }, 400);
  }
  const body = b as Record<string, unknown>;
  const keys = Object.keys(body);
  const forbidden = keys.filter((k) => !ALLOWED.has(k));
  if (forbidden.length) {
    return json({ success: false, error: "FIELD_NOT_ALLOWED", message: "Some fields cannot be changed here.", fieldErrors: Object.fromEntries(forbidden.map((k) => [k, "This field cannot be changed."])) }, 400);
  }
  if (!keys.length) return json({ success: false, error: "BAD_REQUEST", message: "Nothing to update." }, 400);

  const errors: Record<string, string> = {};
  let fullName: string | null = null;
  let district: string | null = null;
  let language: string | null = null;
  let profile: Record<string, string | string[]> | null = null;

  if ("fullName" in body) {
    const v = typeof body.fullName === "string" ? body.fullName.trim() : "";
    if (!v) errors.fullName = "Enter your full name.";
    else if (v.length > LIMITS.name) errors.fullName = "Name is too long.";
    else fullName = v;
  }
  if ("district" in body) {
    const v = typeof body.district === "string" ? body.district.trim() : "";
    if (!v) errors.district = "Enter your district.";
    else if (v.length > LIMITS.district) errors.district = "District is too long.";
    else district = v;
  }
  if ("language" in body) {
    if (typeof body.language === "string" && (LANGUAGES as readonly string[]).includes(body.language)) language = body.language;
    else errors.language = "Choose a supported language.";
  }
  if ("profile" in body) profile = validateProfile(me.role, body.profile, errors); // validated against the DB role
  if (Object.keys(errors).length) {
    return json({ success: false, error: "VALIDATION_FAILED", message: "Please fix the highlighted fields.", fieldErrors: errors }, 400);
  }

  try {
    const { rows } = await pool.query(
      `UPDATE users SET
         full_name = COALESCE($2, full_name),
         district = COALESCE($3, district),
         preferred_language = COALESCE($4, preferred_language),
         profile = COALESCE($5::jsonb, profile),
         consents = CASE WHEN $5::jsonb IS NULL THEN consents ELSE consents - 'profileSkipped' END
       WHERE id = $1
       RETURNING full_name, district, preferred_language`,
      [me.id, fullName, district, language, profile ? JSON.stringify(profile) : null]
    );
    if (!rows[0]) return json({ success: false, error: "UNAUTHENTICATED", message: "Please sign in." }, 401);
    return json({ success: true, user: { fullName: rows[0].full_name, district: rows[0].district, language: rows[0].preferred_language } });
  } catch {
    console.error("profile update failed");
    return json({ success: false, error: "SERVER_ERROR", message: "We could not save your changes. Please try again." }, 500);
  }
}
