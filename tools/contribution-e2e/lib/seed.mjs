// Made-up people and data for the throw-away database: an administrator, a moderator, an adult member, a member under 18, three
// sectors with robot types, and a few contributions sent with the current (old) form. Passwords come from the throw-away secrets.
import bcrypt from "bcryptjs";
import pg from "pg";
import { USERS, assertLocal, databaseUrl, secrets } from "./config.mjs";

export async function seed() {
  assertLocal(databaseUrl());
  const pool = new pg.Pool({ connectionString: databaseUrl() });
  const q = (text, params) => pool.query(text, params);
  try {
    const ids = {};
    for (const [key, u] of Object.entries(USERS)) {
      ids[key] = Number((await q(
        `INSERT INTO users (full_name, email, mobile, role, district, preferred_language, age_category, password_hash, email_verification, must_change_password, is_moderator)
         VALUES ($1, $2, '9876543210', $3, 'Guntur', 'English', $4, $5, 'email', false, $6)
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash RETURNING id`,
        [u.name, u.email, u.role, u.minor ? "minor" : "adult", await bcrypt.hash(secrets().users[key], 4), u.moderator])).rows[0].id);
    }
    for (const [slug, name, order] of [["agriculture-dairy", "Agriculture & Dairy", 10], ["education", "Education", 20], ["healthcare", "Healthcare", 30]]) {
      await q("INSERT INTO sectors (slug, name, sort_order) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING", [slug, name, order]);
    }
    for (const [sector, slug, name, order] of [["agriculture-dairy", "milking-robots", "Milking robots", 10], ["agriculture-dairy", "drone-sprayers", "Drone sprayers", 20],
      ["agriculture-dairy", "soil-sensors", "Soil sensors", 30], ["education", "classroom-kits", "Classroom kits", 10], ["education", "lab-robots", "Lab robots", 20]]) {
      await q("INSERT INTO sector_robot_types (sector_id, slug, name, sort_order, updated_by) SELECT id, $2, $3, $4, $5 FROM sectors WHERE slug = $1 ON CONFLICT DO NOTHING", [sector, slug, name, order, ids.admin]);
    }
    if (Number((await q("SELECT count(*)::int AS n FROM contributions WHERE user_id = $1", [ids.member])).rows[0].n) === 0) {
      const old = async (user, status, title) => {
        // a draft first (a contribution needs its sector before it is submitted), then the sector, then the status
        const id = Number((await q("INSERT INTO contributions (user_id, type, type_chosen, title, body) VALUES ($1, 'problem', true, $2, 'Made up for the end-to-end check.') RETURNING id", [user, title])).rows[0].id);
        await q("INSERT INTO contribution_scopes (contribution_id, sector_id) SELECT $1, id FROM sectors WHERE slug = 'agriculture-dairy'", [id]);
        await q("UPDATE contributions SET status = $2::varchar, submitted_at = now() - interval '2 days' WHERE id = $1", [id, status]);
      };
      await old(ids.member, "pending_review", "Shed cleaning robot for small dairies");
      await old(ids.member, "pending_review", "Drone spraying workshop for students");
      await old(ids.member, "rejected", "Cheap drone kits");
    }
    return ids;
  } finally {
    await pool.end();
  }
}
