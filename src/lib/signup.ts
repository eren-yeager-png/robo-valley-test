import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import { claimVerification, type VerifiedVia } from "./otp";
import type { SignupInput } from "./validation";

export const BCRYPT_ROUNDS = 12;

/** Anything with pg's Pool#connect shape (lets tests inject a fake). */
export type Db = { connect(): Promise<PoolClient> };

export class VerificationRequiredError extends Error {
  constructor(public which: "signup" | "guardian") {
    super("verification required");
  }
}
export class DuplicateEmailError extends Error {}

export type CreatedUser = { id: string; fullName: string; email: string; role: string; ageCategory: string };

export async function createAccount(db: Db, input: SignupInput): Promise<CreatedUser> {
  // Server-side proof of OTP verification. Tokens are claimed atomically (single use);
  // they are restored if the account could not be created.
  const claims: Array<{ restore: () => void }> = [];
  const restoreAll = () => claims.forEach((c) => c.restore());

  // Tokens are bound to the normalized email, so the stored email is always the verified one.
  const own = claimVerification(input.verification.signup, "signup", input.email);
  if (!own) throw new VerificationRequiredError("signup");
  claims.push(own);

  let guardianVia: VerifiedVia = "mock";
  if (input.guardian) {
    const gc = claimVerification(input.verification.guardian, "guardian", input.guardian.email);
    if (!gc) {
      restoreAll();
      throw new VerificationRequiredError("guardian");
    }
    claims.push(gc);
    guardianVia = gc.via;
  }

  let client: PoolClient | undefined;
  try {
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    client = await db.connect();
    await client.query("BEGIN");
    try {
      const u = await client.query(
        `INSERT INTO users
           (full_name, email, mobile, role, district, preferred_language, age, age_category,
            password_hash, guardian_consent, profile, consents, email_verification)
         VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10::jsonb,$11::jsonb,$12)
         RETURNING id, full_name, email, role, age_category`,
        [
          input.fullName, input.email, input.mobile, input.role, input.district, input.language,
          input.ageCategory, passwordHash,
          // never true from an OTP alone: real guardian consent is not established yet
          input.ageCategory === "minor" ? false : null,
          JSON.stringify(input.profileSkipped ? {} : input.profile),
          JSON.stringify({ ...input.consents, privacyNoticeVersion: "1.0", profileSkipped: input.profileSkipped }),
          own.via,
        ]
      );
      const row = u.rows[0];
      if (input.guardian) {
        await client.query(
          `INSERT INTO guardian_details
             (user_id, guardian_name, guardian_relationship, guardian_mobile, guardian_email,
              consent_status, email_verification, consent_mode)
           VALUES ($1,$2,$3,$4,$5,'pending',$6,'test')`,
          [row.id, input.guardian.name, input.guardian.relationship, input.guardian.mobile, input.guardian.email, guardianVia]
        );
      }
      await client.query("COMMIT");
      return { id: String(row.id), fullName: row.full_name, email: row.email, role: row.role, ageCategory: row.age_category };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    }
  } catch (err) {
    restoreAll();
    const e = err as { code?: string; constraint?: string };
    if (e?.code === "23505" && /email/i.test(e.constraint ?? "")) throw new DuplicateEmailError();
    throw err;
  } finally {
    client?.release();
  }
}
