import { pool } from "../../../../lib/db";
import { json, readJson } from "../../../../lib/http";
import { createAccount, DuplicateEmailError, VerificationRequiredError } from "../../../../lib/signup";
import { LIMITS, validateSignup } from "../../../../lib/validation";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const parsed = await readJson(req, LIMITS.body);
  if ("error" in parsed) return parsed.error;

  const v = validateSignup(parsed.body);
  if (!v.ok && "errors" in v) {
    return json({ success: false, error: "VALIDATION_FAILED", message: "Please fix the highlighted fields.", fieldErrors: v.errors }, 400);
  }

  try {
    const user = await createAccount(pool, (v as { data: Parameters<typeof createAccount>[1] }).data);
    return json({ success: true, message: "Account created.", user }, 201);
  } catch (err) {
    if (err instanceof VerificationRequiredError) {
      const who = err.which === "guardian" ? "your parent or guardian's" : "your";
      return json({ success: false, error: "VERIFICATION_REQUIRED", which: err.which, message: `Please verify ${who} email address first.` }, 403);
    }
    if (err instanceof DuplicateEmailError) {
      return json({ success: false, error: "EMAIL_TAKEN", message: "An account with this email already exists.", fieldErrors: { email: "An account with this email already exists." } }, 409);
    }
    console.error("signup failed:", (err as { code?: string })?.code ?? "unknown error"); // no SQL, values or stack
    return json({ success: false, error: "SERVER_ERROR", message: "We could not create your account. Please try again." }, 500);
  }
}
