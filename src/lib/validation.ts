import {
  GUARDIAN_RELATIONSHIPS,
  LANGUAGES,
  MINOR_ALLOWED_ROLES,
  ROLE_CODES,
  ROLE_FIELDS,
} from "./roles";

export type FieldErrors = Record<string, string>;

export const LIMITS = { body: 32 * 1024, name: 100, email: 254, district: 80, text: 150, passwordBytes: 72, passwordMin: 8 };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Accepts "9876543210", "+91 98765-43210", "919876543210". Returns the 10 digits, or null. */
export function normalizeMobile(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let s = v.replace(/[\s-]/g, "");
  if (s.startsWith("+91")) s = s.slice(3);
  else if (s.length === 12 && s.startsWith("91")) s = s.slice(2);
  return /^[6-9]\d{9}$/.test(s) ? s : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Trim + lower-case. Returns null if it is not a plausible email address. */
export function normalizeEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return s && s.length <= LIMITS.email && EMAIL_RE.test(s) ? s : null;
}

export type SignupInput = {
  role: string;
  fullName: string;
  mobile: string;
  email: string;
  password: string;
  district: string;
  language: string;
  ageCategory: "adult" | "minor";
  guardian: { name: string; relationship: string; mobile: string; email: string } | null;
  consents: { privacy: true; terms: true; whatsapp: boolean; email: boolean; photo: boolean };
  profile: Record<string, string | string[]>;
  profileSkipped: boolean;
  verification: { signup: unknown; guardian: unknown };
};

/**
 * Validates role-specific profile answers against the allowlist in roles.ts (shared by signup and
 * the account settings API). Writes "profile.<key>" messages into `errors` and returns the cleaned answers.
 */
export function validateProfile(role: string, rawProfile: unknown, errors: FieldErrors): Record<string, string | string[]> {
  const profile: Record<string, string | string[]> = {};
  if (!ROLE_CODES.includes(role)) return profile;
  const fields = ROLE_FIELDS[role] ?? [];
  const p = isObj(rawProfile) ? rawProfile : {};
  const known = new Set(fields.map((f) => f.key));
  for (const k of Object.keys(p)) if (!known.has(k)) errors[`profile.${k}`] = "Unknown profile field.";
  for (const f of fields) {
    const v = p[f.key];
    const key = `profile.${f.key}`;
    if (f.type === "txt") {
      const t = str(v);
      if (v !== undefined && typeof v !== "string") errors[key] = "Invalid answer.";
      else if (t.length > LIMITS.text) errors[key] = "Answer is too long.";
      else if (!t && f.required) errors[key] = `Please answer: ${f.label}.`;
      else if (t) profile[f.key] = t;
    } else if (f.type === "sel") {
      const t = str(v);
      if (v !== undefined && typeof v !== "string") errors[key] = "Invalid answer.";
      else if (t && !f.options.includes(t)) errors[key] = "Choose one of the listed options.";
      else if (!t && f.required) errors[key] = `Please answer: ${f.label}.`;
      else if (t) profile[f.key] = t;
    } else {
      const arr = v === undefined ? [] : v;
      if (!Array.isArray(arr) || arr.length > f.options.length || arr.some((x) => typeof x !== "string" || !f.options.includes(x))) {
        errors[key] = "Choose from the listed options.";
      } else if (arr.length === 0 && f.required) errors[key] = `Please answer: ${f.label}.`;
      else if (arr.length) profile[f.key] = [...new Set(arr as string[])];
    }
  }
  return profile;
}

export function validateSignup(raw: unknown): { ok: true; data: SignupInput } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  if (!isObj(raw)) return { ok: false, errors: { _form: "Invalid request." } };

  const role = str(raw.role);
  if (!ROLE_CODES.includes(role)) errors.role = "Choose a valid role.";

  const fullName = str(raw.fullName);
  if (!fullName) errors.fullName = "Enter your full name.";
  else if (fullName.length > LIMITS.name) errors.fullName = "Name is too long.";

  const mobile = normalizeMobile(raw.mobile);
  if (!mobile) errors.mobile = "Enter a 10-digit mobile number starting with 6, 7, 8 or 9.";

  const email = normalizeEmail(raw.email) ?? "";
  if (!email) errors.email = str(raw.email) ? "Enter a valid email address." : "Enter your email address.";

  const password = typeof raw.password === "string" ? raw.password : "";
  if (password.length < LIMITS.passwordMin) errors.password = "Password must contain at least 8 characters.";
  else if (new TextEncoder().encode(password).length > LIMITS.passwordBytes) errors.password = "Password is too long (max 72 bytes).";
  else if (raw.confirmPassword !== password) errors.confirmPassword = "Passwords do not match.";

  const district = str(raw.district);
  if (!district) errors.district = "Enter your district.";
  else if (district.length > LIMITS.district) errors.district = "District is too long.";

  const language = raw.language === undefined || raw.language === "" ? "Telugu" : str(raw.language);
  if (!(LANGUAGES as readonly string[]).includes(language)) errors.language = "Choose a supported language.";

  const ageCategory = raw.ageCategory;
  if (ageCategory !== "adult" && ageCategory !== "minor") errors.ageCategory = "Tell us whether you are 18 or older.";
  else if (ageCategory === "minor" && !MINOR_ALLOWED_ROLES.includes(role) && !errors.role) {
    errors.ageCategory = "Members under 18 can join only as a student.";
  }

  // guardian
  let guardian: SignupInput["guardian"] = null;
  if (ageCategory === "minor") {
    const g = isObj(raw.guardian) ? raw.guardian : {};
    const gName = str(g.name);
    const gRel = str(g.relationship);
    const gMobile = normalizeMobile(g.mobile);
    const gEmail = normalizeEmail(g.email);
    if (!gName) errors["guardian.name"] = "Enter your parent or guardian's name.";
    else if (gName.length > LIMITS.name) errors["guardian.name"] = "Name is too long.";
    if (!(GUARDIAN_RELATIONSHIPS as readonly string[]).includes(gRel)) errors["guardian.relationship"] = "Choose the relationship.";
    if (!gMobile) errors["guardian.mobile"] = "Enter a valid 10-digit mobile number for your parent.";
    else if (gMobile === mobile) errors["guardian.mobile"] = "Your parent's number must be different from yours.";
    if (!gEmail) errors["guardian.email"] = "Enter a valid email address for your parent.";
    else if (gEmail === email) errors["guardian.email"] = "Your parent's email must be different from yours.";
    if (gMobile && gEmail && gName && !errors["guardian.name"] && !errors["guardian.relationship"] && !errors["guardian.email"] && !errors["guardian.mobile"]) {
      guardian = { name: gName, relationship: gRel, mobile: gMobile, email: gEmail };
    }
  } else if (ageCategory === "adult" && raw.guardian != null) {
    errors.guardian = "Guardian details apply only to members under 18.";
  }

  // consents
  const c = isObj(raw.consents) ? raw.consents : {};
  if (c.privacy !== true || c.terms !== true) {
    errors.consents = "Please agree to the Privacy Notice, Terms of Use and Community Rules to continue.";
  }

  // profile
  const profileSkipped = raw.profileSkipped === true;
  const profile = profileSkipped ? {} : validateProfile(role, raw.profile, errors);

  const v = isObj(raw.verification) ? raw.verification : {};
  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    data: {
      role, fullName, mobile: mobile!, email, password, district, language,
      ageCategory: ageCategory as "adult" | "minor",
      guardian,
      consents: { privacy: true, terms: true, whatsapp: c.whatsapp === true, email: c.email === true, photo: c.photo === true },
      profile, profileSkipped,
      verification: { signup: v.signup, guardian: v.guardian },
    },
  };
}
