import { cookies } from "next/headers";
import { pool } from "./db";
import { canSignIn, SESSION_COOKIE, sessionRevoked, verifySessionToken } from "./session";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/**
 * The user row for a session, INCLUDING users.password_changed_at, in ONE query (the column rides along with the columns the caller
 * already reads, so the session check adds no database round trip). `columns` is a constant written in code, never user input.
 * Before migration 020 the column does not exist (42703): then the same query is run without it, so deploying this code first
 * signs nobody out and breaks nothing; the extra attempt only happens until the migration is applied.
 */
export async function selectSessionUser(db: Db, columns: string, id: string): Promise<any | undefined> {
  try {
    return (await db.query(`SELECT ${columns}, password_changed_at FROM users WHERE id = $1`, [id])).rows[0];
  } catch (e) {
    if ((e as { code?: string })?.code !== "42703") throw e;
    return (await db.query(`SELECT ${columns} FROM users WHERE id = $1`, [id])).rows[0];
  }
}

export type CurrentUser = { id: string; fullName: string; email: string; role: string };

/** The first word of a full name (at most 40 characters), or null when there is none. Used for the website header label. */
export function firstNameOf(fullName: unknown): string | null {
  if (typeof fullName !== "string") return null;
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  return first ? first.slice(0, 40) : null;
}

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
    const u = await selectSessionUser(pool, "id, full_name, email, role, email_verification", session.sub);
    if (!u || !canSignIn(u.email_verification)) return null;
    if (sessionRevoked(session, u.password_changed_at)) return null; // the password was changed after this session was issued
    return { id: String(u.id), fullName: u.full_name, email: u.email, role: u.role };
  } catch {
    console.error("currentUser: database lookup failed");
    return null;
  }
}
