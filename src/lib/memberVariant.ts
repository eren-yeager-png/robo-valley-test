// Which view of the Contribution Portal a Member portal shows (public/cw/js/sectors.js: opts.variant), from the member's stakeholder
// role and its group in roles.ts: a Student, a Parent / guardian, the Schools group (teacher view: classroom picks) and everyone else
// (the Partners & providers group: contributor view). One place, so every page agrees.
import { GROUPS } from "./roles";

export type MemberVariant = "student" | "teacher" | "parent" | "contributor";
const groupOf = (code: string) => GROUPS.find(([, codes]) => codes.includes(code))?.[0] ?? "";

export function memberVariant(roleCode: unknown): MemberVariant {
  const code = String(roleCode ?? "");
  if (code === "ST") return "student";
  if (code === "PA") return "parent";
  if (groupOf(code) === "Schools") return "teacher";
  return "contributor";
}

/** The short form in a dialog for contributors: only once the portal takes ideas itself (CW_PORTAL_FORM=on, set at the switch-over). */
export const portalQuickForm = (env: NodeJS.ProcessEnv = process.env) => env.CW_PORTAL_FORM?.trim().toLowerCase() === "on";
