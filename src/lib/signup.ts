import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import { claimVerification, isWellFormedToken, type Queryable, type VerifiedVia } from "./otp";
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
  // Cheap checks first: a malformed token never reaches the database or the (slow) password hash.
  if (!isWellFormedToken(input.verification.signup)) throw new VerificationRequiredError("signup");
  if (input.guardian && !isWellFormedToken(input.verification.guardian)) throw new VerificationRequiredError("guardian");

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    try {
      // Server-side proof of email verification. The single-use tokens are consumed INSIDE this transaction
      // (one DELETE ... RETURNING each, so two parallel signups cannot share a token). If anything below fails
      // and the transaction rolls back, the tokens are automatically valid again. They are bound to the
      // normalised email, so the stored email is always the verified one.
      const q = client as unknown as Queryable;
      const own = await claimVerification(input.verification.signup, "signup", input.email, undefined, q);
      if (!own) throw new VerificationRequiredError("signup");

      let guardianVia: VerifiedVia = "mock";
      if (input.guardian) {
        const gc = await claimVerification(input.verification.guardian, "guardian", input.guardian.email, undefined, q);
        if (!gc) throw new VerificationRequiredError("guardian");
        guardianVia = gc.via;
      }

      // Only now (proof of verification exists) spend the time on hashing the password.
      const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

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
    const e = err as { code?: string; constraint?: string };
    if (e?.code === "23505" && /email/i.test(e.constraint ?? "")) throw new DuplicateEmailError();
    throw err;
  } finally {
    client.release();
  }
}
