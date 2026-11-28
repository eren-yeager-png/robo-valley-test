// DEMO data for the contribution workflow, for a LOCAL or PREVIEW copy of the site ONLY, so no page is empty: dashboards, sectors and
// their fields, contributions in every status (at least 2 each, with moderators' feedback on the rejected ones), the moderation queue,
// the Moderator Workspace, the Admin Approval Dashboard and its publish preview, Community Ideas, users for every role, and every demo
// user's "My Contributions" (current-form items that can still be edited, and new-workflow ideas that are View only).
//
//   DEMO_MODE=1 npm run seed:contribution-demo -- --expect-db <database name>                    # dry run: the plan; connects to nothing
//   DEMO_MODE=1 npm run seed:contribution-demo -- --expect-db <database name> --apply            # add it (safe to repeat)
//   DEMO_MODE=1 npm run seed:contribution-demo -- --expect-db <database name> --reset --apply    # remove ONLY the demo records
//   ... --preview-host <host>   a PREVIEW database (not on this computer): only that exact host name is accepted
//
// SAFETY: it is never run automatically (no build step, no deploy hook calls it), and it refuses unless ALL of these hold:
//   * DEMO_MODE=1 is set in this window, and neither NODE_ENV nor VERCEL_ENV is "production";
//   * --expect-db equals the database name in DATABASE_URL;
//   * the database is on this computer (localhost), or its host is exactly the one given with --preview-host;
//   * after connecting: every migration up to 029 is applied, and the database holds at most 25 accounts that are not demo or
//     sample accounts (more looks like a live site: it refuses).
// HOW DEMO RECORDS ARE TOLD APART (so --reset never touches real data):
//   * users: e-mail ends with @demo.robovalley.test (a reserved, undeliverable domain); their passwords are made up on each run and
//     printed once at the end, never stored anywhere else;
//   * new-workflow ideas: cw_contributions.is_demo = true (migration 029; it hides nothing);
//   * current-form contributions: ids in the reserved range 8,000,000,000,000 .. 8,000,001,000,000 (contributions.is_demo already
//     exists and means "hidden from the counts and the moderation queue", which would leave those pages empty);
//   * robot types: added by a demo account (updated_by); sectors are ordinary rows that are kept.
import bcrypt from "bcryptjs";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { dbNameFromUrl } from "./migrate.mjs";
import { migrationStatus, pending } from "./migration-status.mjs";
import * as R from "../public/cw/js/rules.js";
import { STATUS } from "../public/cw/js/lists.js";

export const DEMO_DOMAIN = "demo.robovalley.test";
export const OLD_ID_BASE = 8_000_000_000_000;
export const OLD_ID_END = OLD_ID_BASE + 1_000_000;
export const MAX_REAL_USERS = 25;
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/;

// ---- safety ----------------------------------------------------------------------------------------------------------------
/** Throws a plain-English Error unless this is a demo run against a local (or the named preview) database. Before connecting. */
export function assertDemoTarget({ url, expectDb, previewHost = "", env = process.env }) {
  if (!/^(1|true|yes)$/i.test(String(env.DEMO_MODE ?? ""))) throw new Error("Refusing: DEMO_MODE=1 is not set. Demo data is only for local and preview copies of the site.");
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") throw new Error("Refusing: this is a production environment. Demo data never goes there.");
  if (!expectDb) throw new Error("Missing --expect-db <database name>.");
  if (!url) throw new Error("DATABASE_URL is not set in this window.");
  let host;
  try { host = new URL(url).hostname; } catch { throw new Error("DATABASE_URL could not be read."); }
  if (!LOOPBACK.test(host) && !(previewHost && host === previewHost)) {
    throw new Error("Refusing: the database is not on this computer. For a PREVIEW database name its exact host with --preview-host <host>.");
  }
  const name = dbNameFromUrl(url);
  if (name !== expectDb) throw new Error(`DATABASE_URL points to database "${name}" but you confirmed "${expectDb}".`);
  return name;
}

/** After connecting: every migration applied, and not a live site (at most MAX_REAL_USERS real accounts). */
export async function assertSafeDatabase(db) {
  const missing = pending(await migrationStatus((sql) => db.query(sql)));
  if (missing.length) throw new Error(`Refusing: these migrations are not applied yet: ${missing.map((m) => m.id).join(", ")}.`);
  const real = Number((await db.query(`SELECT count(*)::int AS n FROM users WHERE email NOT LIKE '%@${DEMO_DOMAIN}' AND email NOT LIKE '%@sample.robovalley.test'`)).rows[0].n);
  if (real > MAX_REAL_USERS) throw new Error(`Refusing: this database holds ${real} real accounts. It looks like a live site; demo data is only for local and preview copies.`);
}

// ---- the plan (pure data) --------------------------------------------------------------------------------------------------
export const DEMO_SECTORS = [
  { slug: "agriculture-dairy", name: "Agriculture & Dairy", order: 10, robots: [["milking-robots", "Milking robots"], ["drone-sprayers", "Drone sprayers"], ["weeding-robots", "Weeding robots"], ["soil-and-water-sensors", "Soil and water sensors"]] },
  { slug: "manufacturing", name: "Manufacturing", order: 40, robots: [["cobots", "Collaborative robots (cobots)"], ["welding-robots", "Welding robots"], ["agvs", "Automated guided vehicles"]] },
  { slug: "healthcare", name: "Healthcare", order: 30, robots: [["pharmacy-robots", "Pharmacy robots"], ["delivery-robots", "Delivery robots"], ["rehabilitation-robots", "Rehabilitation robots"]] },
  { slug: "education", name: "Education", order: 20, robots: [["robotic-arms", "Robotic arms"], ["humanoid-tutors", "Humanoid tutors"], ["coding-robots", "Coding robots for young learners"]] },
];
export const DEMO_USERS = [
  { key: "admin", name: "Demo Admin", role: "admin", label: "Administrator" },
  { key: "moderator", name: "Demo Moderator", role: "TC", label: "Teacher / lab in-charge", moderator: true },
  { key: "student", name: "Neha Demo", role: "ST", label: "Student", minor: true },
  { key: "teacher", name: "Kiran Demo", role: "TC", label: "Teacher / lab in-charge" },
  { key: "parent", name: "Meera Demo", role: "PA", label: "Parent / guardian" },
  { key: "contributor", name: "Rao Demo", role: "ME", label: "Mentor / subject expert" },
];
const idea = (user, status, title, sector, robot, extra = {}) => ({ user, status, title, sector, robot, kind: "New idea", categories: ["Robotics"], path: "Learn",
  description: `${title}: a demo idea so this page has something to show. It explains the idea in enough words for the Moderator's send rule.`, ...extra });
export const DEMO_IDEAS = [
  idea("student", "submitted", "Solar sensor kit for the school garden", "education", "", { path: "Make" }),
  idea("parent", "submitted", "Robot that reminds grandparents to drink water", "healthcare", ""),
  idea("teacher", "under_review", "Classroom robot arm challenge", "education", "robotic-arms"),
  idea("contributor", "under_review", "Field day for weeding robots", "agriculture-dairy", "weeding-robots"),
  idea("teacher", "draft", "Line-following robot workshop", "education", "robotic-arms", { edit: "One-day line-following robot workshop" }),
  idea("contributor", "draft", "Dairy shed cooling sensors", "agriculture-dairy", "milking-robots", { edit: "Cooling sensors for dairy sheds" }),
  idea("parent", "pending", "Holiday robotics camp for girls", "education", "humanoid-tutors"),
  idea("contributor", "pending", "Drone pilot course near the village", "agriculture-dairy", "drone-sprayers"),
  idea("student", "changes_requested", "Robot buddy for reading practice", "education", "humanoid-tutors", { feedback: "Please say how the robot keeps children's voices private." }),
  idea("teacher", "changes_requested", "Cobot safety poster for labs", "manufacturing", "cobots", { feedback: "Add which cobots the poster covers." }),
  idea("parent", "resubmitted", "Medicine delivery robot for small clinics", "healthcare", "delivery-robots", { feedback: "Which clinics could try it?" }),
  idea("contributor", "resubmitted", "Welding robot visit for ITI students", "manufacturing", "welding-robots", { feedback: "Name a factory that would host it." }),
  idea("student", "published", "Beach clean-up robot challenge", "education", "coding-robots", { path: "Make" }),
  idea("teacher", "published", "Robotic arms for the school lab", "education", "robotic-arms"),
  idea("parent", "failed", "Pharmacy robot open day", "healthcare", "pharmacy-robots", { error: "The website did not confirm the update within the time limit." }),
  idea("contributor", "failed", "Automated guided vehicles in small factories", "manufacturing", "agvs", { error: "The public website could not be updated." }),
  idea("student", "rejected", "Robot that does my homework", "education", "", { decision: "decline", feedback: "Not a contribution to RoboValley: it asks for a robot to do homework." }),
  idea("parent", "rejected", "Robot that drives the school bus", "education", "", { decision: "reject", feedback: "A robot must not drive a school bus with children on board." }),
  idea("teacher", "unpublished", "Rehabilitation robots in district hospitals", "healthcare", "rehabilitation-robots"),
  idea("contributor", "unpublished", "Soil and water sensors for small farms", "agriculture-dairy", "soil-and-water-sensors", { kind: "Suggestion" }),
];
const old = (n, user, status, title, sector, extra = {}) => ({ id: OLD_ID_BASE + n, user, status, title, sector, type: "problem", ...extra });
export const DEMO_FORM_ITEMS = [
  old(1, "parent", "draft", "Parents' robotics evening at school", "education"),
  old(2, "teacher", "draft", "Robot club attendance sheet", "education"),
  old(3, "student", "pending_review", "Robot kit lending library at school", "education"),
  old(4, "contributor", "pending_review", "Drone pilot training centres", "agriculture-dairy", { robot: "drone-sprayers" }),
  old(5, "teacher", "changes_requested", "Lab safety checklist for robot kits", "education", { reply: "Please add the names of the kits it covers." }),
  old(6, "parent", "changes_requested", "Robot toys for hospital play rooms", "healthcare", { reply: "Which hospitals did you ask?" }),
  old(7, "student", "published", "Line follower race day", "education"),
  old(8, "contributor", "published", "Soil test kit comparison", "agriculture-dairy"),
  old(9, "teacher", "rejected", "Old printer parts for robot arms", "manufacturing", { reply: "We already have a guide for this; please add to it instead." }),
  old(10, "contributor", "rejected", "Cheap moisture probe from a fork", "agriculture-dairy", { reply: "Not safe to recommend for fields with electric fencing." }),
  old(11, "parent", "unpublished", "Holiday robotics camp list", "education"),
  old(12, "student", "unpublished", "Robot repair cafe", "education"),
];

/** The whole plan, for the dry run and the tests. */
export const plan = () => ({ sectors: DEMO_SECTORS, users: DEMO_USERS, ideas: DEMO_IDEAS, formItems: DEMO_FORM_ITEMS });

// ---- apply ---------------------------------------------------------------------------------------------------------------
const email = (key) => `${key}@${DEMO_DOMAIN}`;
const sectorOptions = () => DEMO_SECTORS.map((s) => ({ slug: s.slug, name: s.name, robots: s.robots.map(([slug, name]) => ({ slug, name })) }));

/** Adds the demo records (safe to repeat: what exists is kept). Returns { users: {key: id}, passwords: {key: password}, added }. */
export async function seedDemo(db, { log = () => {} } = {}) {
  const passwords = {}, ids = {};
  await db.query("BEGIN");
  try {
    for (const s of DEMO_SECTORS) await db.query("INSERT INTO sectors (slug, name, sort_order) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING", [s.slug, s.name, s.order]);
    for (const u of DEMO_USERS) {
      const have = (await db.query("SELECT id FROM users WHERE lower(email) = $1", [email(u.key)])).rows[0];
      if (have) { ids[u.key] = Number(have.id); continue; }
      passwords[u.key] = randomBytes(9).toString("base64url");
      ids[u.key] = Number((await db.query(
        `INSERT INTO users (full_name, email, mobile, role, district, preferred_language, age_category, password_hash, email_verification, must_change_password, is_moderator, profile)
         VALUES ($1, $2, '9876543210', $3, 'Guntur', 'English', $4, $5, 'email', false, $6, '{"demo": true}'::jsonb) RETURNING id`,
        [u.name, email(u.key), u.role, u.minor ? "minor" : "adult", await bcrypt.hash(passwords[u.key], 8), u.moderator === true])).rows[0].id);
    }
    for (const s of DEMO_SECTORS) {
      for (const [i, [slug, name]] of s.robots.entries()) {
        await db.query(`INSERT INTO sector_robot_types (sector_id, slug, name, sort_order, updated_by) SELECT id, $2, $3, $4, $5 FROM sectors WHERE slug = $1
                        ON CONFLICT DO NOTHING`, [s.slug, slug, name, (i + 1) * 10, ids.admin]);
      }
    }
    let added = 0;
    for (const [n, it] of DEMO_IDEAS.entries()) if (await addIdea(db, it, n, ids)) added++;
    for (const f of DEMO_FORM_ITEMS) if (await addFormItem(db, f, ids)) added++;
    await db.query("COMMIT");
    log(`added ${added} demo records`);
    return { users: ids, passwords, added };
  } catch (e) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw e;
  }
}

async function addIdea(db, it, n, ids) {
  if ((await db.query("SELECT 1 FROM cw_contributions WHERE is_demo AND original->>'title' = $1", [it.title])).rows.length) return false;
  const u = DEMO_USERS.find((x) => x.key === it.user), mod = DEMO_USERS.find((x) => x.key === "moderator"), adm = DEMO_USERS.find((x) => x.key === "admin");
  const original = { title: it.title, description: it.description, sector: it.sector, robotType: it.robot || "not-sure", categories: it.categories, suitableFor: [], learningPath: it.path };
  const S = STATUS, st = it.status, days = 40 - n;
  const opened = st !== S.SUBMITTED;
  const sent = [S.PENDING, S.CHANGES, S.RESUBMITTED, S.PUBLISHED, S.FAILED, S.UNPUBLISHED].includes(st) || (st === S.REJECTED && it.decision === "reject");
  const proposed = { ...original, ...(it.edit ? { title: it.edit } : {}) };
  const versions = sent ? (st === S.RESUBMITTED ? 2 : 1) : 0;
  const published = [S.PUBLISHED, S.UNPUBLISHED].includes(st);
  const row = (await db.query(
    `INSERT INTO cw_contributions (user_id, contributor_name, contributor_type, contributor_minor, kind, original, proposed, status, moderator_id, moderator_name,
       previewed_version, published_version, published_at, publish_error, publish_attempts, is_demo, submitted_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, true, now() - make_interval(days => $16)) RETURNING id`,
    [ids[u.key], u.name, u.role, u.minor === true, it.kind, JSON.stringify(original), JSON.stringify(proposed), st, opened ? ids.moderator : null, opened ? mod.name : null,
      [S.PUBLISHED, S.FAILED].includes(st) ? versions : null, published ? 1 : null, published ? new Date(Date.now() - (days - 2) * 86400000).toISOString() : null,
      st === S.FAILED ? it.error : null, [S.PUBLISHED, S.FAILED, S.UNPUBLISHED].includes(st) ? 1 : 0, days])).rows[0];
  const id = Number(row.id);
  const at = (h) => new Date(Date.now() - days * 86400000 + h * 3600000).toISOString();
  const hist = [[`${u.name} (${u.label})`, R.history.submitted(it.kind, null, 0), 0]];
  if (opened) hist.push([mod.name, R.history.opened(), 1]);
  if (it.edit) hist.push([mod.name, R.history.draft(["Title"]), 2]);
  for (let v = 1; v <= versions; v++) {
    await db.query("INSERT INTO cw_contribution_versions (contribution_id, v, by_user_id, by_name, role, data, notes, created_at) VALUES ($1, $2, $3, $4, 'Moderator', $5::jsonb, '', $6)",
      [id, v, ids.moderator, mod.name, JSON.stringify(proposed), at(2 + v)]);
    hist.push([mod.name, R.history.sent(v > 1, v, []), 2 + v]);
    if (v === 1 && [S.CHANGES, S.RESUBMITTED].includes(st)) {
      await db.query("INSERT INTO cw_contribution_feedback (contribution_id, type, text, by_user_id, by_name, created_at) VALUES ($1, 'changes', $2, $3, $4, $5)", [id, it.feedback, ids.admin, adm.name, at(3.5)]);
      hist.push([adm.name, R.history.changes(it.feedback), 3.5]);
    }
  }
  if (st === S.REJECTED) {
    const by = it.decision === "reject" ? adm : mod;
    await db.query("INSERT INTO cw_contribution_feedback (contribution_id, type, text, by_user_id, by_name, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [id, it.decision, it.feedback, ids[by.key], by.name, at(6)]);
    hist.push([by.name, it.decision === "reject" ? R.history.rejected(it.feedback) : R.history.declined(it.feedback), 6]);
  }
  if ([S.PUBLISHED, S.FAILED, S.UNPUBLISHED].includes(st)) {
    hist.push([adm.name, R.history.previewed(versions), 7], [adm.name, R.history.publishClick(1), 8]);
    hist.push(["System", st === S.FAILED ? R.history.failed(it.error) : R.history.published(1, R.sectorLabel(it.sector, sectorOptions())), 9]);
    if (st === S.UNPUBLISHED) hist.push([adm.name, R.history.unpublished(), 10]);
  }
  for (const [actor, text, h] of hist) await db.query("INSERT INTO cw_contribution_history (contribution_id, actor, text, created_at) VALUES ($1, $2, $3, $4)", [id, actor, text, at(h)]);
  if (st === S.PUBLISHED) {
    const rec = R.toPublicRecord({ id, code: R.codeOf(id), kind: it.kind, proposed, resource: null, references: [], contributor: { name: u.name, firstName: R.firstNameOf(u.name), typeLabel: u.label, minor: u.minor === true } }, { sectors: sectorOptions(), version: 1 });
    await db.query(
      `INSERT INTO cw_public_contributions (contribution_id, version, title, description, sector_slug, sector_name, robot_type_name, categories, suitable_for, learning_path, kind, resource, reference_links, contributor_first_name, contributor_type, contributor_minor, published_at)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, NULL, '[]'::jsonb, $11, $12, $13, $14)`,
      [id, rec.title, rec.description, rec.sector, rec.sectorName, rec.robotTypeName, JSON.stringify(rec.categories), JSON.stringify(rec.suitableFor), rec.learningPath, rec.kind,
        R.firstNameOf(u.name), u.label, u.minor === true, at(9)]);
  }
  return true;
}

async function addFormItem(db, f, ids) {
  if ((await db.query("SELECT 1 FROM contributions WHERE id = $1", [f.id])).rows.length) return false;
  // as the current form does it: a draft first, its sector, then the status (the database wants a sector before an item is sent)
  await db.query(
    `INSERT INTO contributions (id, user_id, type, type_chosen, title, body) OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, true, $4, $5)`,
    [f.id, ids[f.user], f.type, f.title, `${f.title}: a demo contribution sent with the current form.`]);
  await db.query("INSERT INTO contribution_scopes (contribution_id, sector_id) SELECT $1, id FROM sectors WHERE slug = $2", [f.id, f.sector]);
  if (f.status !== "draft") {
    await db.query("UPDATE contributions SET status = $2::varchar, submitted_at = now() - interval '20 days', published_at = CASE WHEN $2::varchar = 'published' THEN now() - interval '10 days' END WHERE id = $1", [f.id, f.status]);
  }
  if (f.robot) {
    await db.query(`UPDATE contribution_scopes cs SET robot_type_id = r.id FROM sector_robot_types r, sectors s
                    WHERE cs.contribution_id = $1 AND s.slug = $2 AND r.sector_id = s.id AND r.slug = $3 AND cs.sector_id = s.id`, [f.id, f.sector, f.robot]).catch(() => undefined);
  }
  if (f.reply) await db.query("INSERT INTO contribution_replies (contribution_id, author_id, message) VALUES ($1, $2, $3)", [f.id, ids.moderator, f.reply]);
  return true;
}

// ---- reset ---------------------------------------------------------------------------------------------------------------
const APPEND_ONLY = [["cw_contribution_versions", "cw_contribution_versions_append_only"], ["cw_contribution_feedback", "cw_contribution_feedback_append_only"],
  ["cw_contribution_history", "cw_contribution_history_append_only"], ["cw_contribution_attachments", "cw_contribution_attachments_append_only"], ["contribution_reviews", "contribution_reviews_append_only"]];

/** Removes ONLY the demo records (the append-only rules are paused for that, inside one transaction, and switched on again). */
export async function resetDemo(db) {
  await db.query("BEGIN");
  try {
    for (const [t, trg] of APPEND_ONLY) await db.query(`ALTER TABLE ${t} DISABLE TRIGGER ${trg}`);
    const demo = "SELECT id FROM cw_contributions WHERE is_demo";
    // migration 030 (when applied): the demo's suggested fields and its Audit Log rows go too (the log is append-only: paused the same way)
    const has030 = (await db.query("SELECT to_regclass('audit_log') IS NOT NULL AS ok")).rows[0]?.ok === true;
    if (has030) {
      await db.query(`DELETE FROM field_suggestions WHERE contribution_id IN (${demo}) OR suggested_by IN (SELECT id FROM users WHERE email LIKE '%@${DEMO_DOMAIN}')`);
      await db.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only");
      await db.query(`DELETE FROM audit_log WHERE (target_type = 'idea' AND target_id IN (${demo})) OR (target_type = 'contribution' AND target_id >= $1 AND target_id < $2)
                      OR actor_id IN (SELECT id FROM users WHERE email LIKE '%@${DEMO_DOMAIN}')`, [OLD_ID_BASE, OLD_ID_END]);
      await db.query("ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only");
    }
    for (const t of ["cw_public_contributions", "cw_contribution_attachments", "cw_contribution_feedback", "cw_contribution_history", "cw_contribution_versions"]) {
      await db.query(`DELETE FROM ${t} WHERE contribution_id IN (${demo})`);
    }
    const ideas = (await db.query("DELETE FROM cw_contributions WHERE is_demo")).rowCount ?? 0;
    const form = (await db.query("DELETE FROM contributions WHERE id >= $1 AND id < $2", [OLD_ID_BASE, OLD_ID_END])).rowCount ?? 0;
    for (const [t, trg] of APPEND_ONLY) await db.query(`ALTER TABLE ${t} ENABLE TRIGGER ${trg}`);
    await db.query(`DELETE FROM sector_robot_types r WHERE r.updated_by IN (SELECT id FROM users WHERE email LIKE '%@${DEMO_DOMAIN}')
                    AND NOT EXISTS (SELECT 1 FROM contribution_scopes s WHERE s.robot_type_id = r.id)` +
                    // 030: a field an idea points at, or one a plugin manages, is never deleted (the database refuses both)
                    (has030 ? " AND NOT EXISTS (SELECT 1 FROM cw_contributions c WHERE c.field_id = r.id) AND r.source <> 'plugin'" : ""));
    const users = (await db.query(`DELETE FROM users WHERE email LIKE '%@${DEMO_DOMAIN}'`)).rowCount ?? 0;
    await db.query("COMMIT");
    return { ideas, form, users };
  } catch (e) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw e;
  }
}

// ---- command line ------------------------------------------------------------------------------------------------------------
async function main(argv) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const apply = argv.includes("--apply"), reset = argv.includes("--reset");
  const name = assertDemoTarget({ url: process.env.DATABASE_URL, expectDb: arg("--expect-db"), previewHost: arg("--preview-host") });
  if (!apply) {
    const p = plan();
    console.log(`DRY RUN for database "${name}" (nothing was changed; add --apply to write${reset ? " the removal" : ""}).`);
    if (!reset) console.log(`Would add: ${p.users.length} demo users, ${p.sectors.length} sectors with ${p.sectors.reduce((a, s) => a + s.robots.length, 0)} fields, ${p.ideas.length} ideas (2 in every status), ${p.formItems.length} current-form contributions.`);
    return;
  }
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await assertSafeDatabase(db);
    if (reset) { const r = await resetDemo(db); console.log(`Removed ${r.ideas} demo ideas, ${r.form} demo contributions of the current form and ${r.users} demo users.`); return; }
    const r = await seedDemo(db, { log: console.log });
    const fresh = Object.entries(r.passwords);
    console.log(fresh.length ? "Demo accounts (passwords shown ONCE; they exist only in this database):" : "Demo accounts already existed (their passwords were shown when they were made).");
    for (const [k, pw] of fresh) console.log(`  ${k.padEnd(12)} ${email(k)}  ${pw}`);
  } finally {
    await db.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => { console.error(String(e && e.message ? e.message : e)); process.exit(1); });
}
