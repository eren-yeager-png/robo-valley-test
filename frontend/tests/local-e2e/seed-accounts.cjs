// Seeds the throw-away rvp_audit database: an admin, a moderator, a regular member, and one submitted contribution. Passwords come from files, never printed.
const path = require('path'); const fs = require('fs');
const root = process.argv[2], S = process.argv[3];
const bcrypt = require(path.join(root, 'node_modules', 'bcryptjs'));
const { Pool } = require(path.join(root, 'node_modules', 'pg'));
const pw = (n) => fs.readFileSync(path.join(S, 'pw-' + n + '.txt'), 'utf8').trim();
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const mk = async (name, email, role, pass, mod) => (await pool.query(
    `INSERT INTO users (full_name, email, role, password_hash, email_verification, must_change_password, is_moderator) VALUES ($1,$2,$3,$4,'email',false,$5) RETURNING id`,
    [name, email, role, await bcrypt.hash(pass, 4), !!mod])).rows[0].id;
  const admin = await mk('Audit Admin', 'audit-admin@example.com', 'admin', pw('admin'), false);
  const mod = await mk('Audit Moderator', 'audit-mod@example.com', 'TC', pw('mod'), true);
  const member = await mk('Audit Member', 'audit-member@example.com', 'ST', pw('member'), false);
  const c = (await pool.query(`INSERT INTO contributions (user_id, type, title, body, is_demo) VALUES ($1,'problem','Milking by hand takes hours every day','Cows are milked by hand every morning and it takes hours.',false) RETURNING id`, [member])).rows[0].id;
  await pool.query(`INSERT INTO contribution_scopes (contribution_id, sector_id) SELECT $1, id FROM sectors WHERE slug='agriculture-dairy'`, [c]);
  await pool.query(`UPDATE contributions SET status='pending_review', submitted_at=now() WHERE id=$1`, [c]);
  console.log('seeded users', admin, mod, member, 'contribution', c);
  await pool.end();
})().catch((e) => { console.error('SEED FAILED', e.message); process.exit(1); });
