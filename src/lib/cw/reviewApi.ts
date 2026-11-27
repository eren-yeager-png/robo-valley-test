// Shared by the reviewing routes of the contribution workflow: the signed-in reviewer as an "actor" (id, real name, administrator or
// not), read from the database on every call. guardReviewer has already checked the account is an administrator or flagged reviewer.
import { pool } from "../db";

export async function actorOf(g: { userId: number; isAdmin: boolean }) {
  const r = (await pool.query("SELECT full_name FROM users WHERE id = $1", [g.userId])).rows[0];
  return { userId: g.userId, name: String(r?.full_name ?? "").trim() || `User ${g.userId}`, isAdmin: g.isAdmin };
}
