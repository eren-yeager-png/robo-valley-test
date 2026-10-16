import { cookies } from "next/headers";
import { pool } from "./db";
import { canSignIn, SESSION_COOKIE, verifySessionToken } from "./session";

export type CurrentUser = { id: string; fullName: string; email: string; role: string };

/**
 * The authoritative "who is logged in" check for Server Components. It verifies the signed
 * cookie AND re-reads the user from PostgreSQL, so a deleted user, a changed role, or an
 * account that no longer satisfies the verification policy loses access immediately.
 * The role always comes from the database, never from the client.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = await cookies();
  const session = verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  try {
    const { rows } = await pool.query(
      "SELECT id, full_name, email, role, email_verification FROM users WHERE id = $1",
      [session.sub]
    );
    const u = rows[0];
    if (!u || !canSignIn(u.email_verification)) return null;
    return { id: String(u.id), fullName: u.full_name, email: u.email, role: u.role };
  } catch {
    console.error("currentUser: database lookup failed");
    return null;
  }
}
