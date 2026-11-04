// Sample data for LOCAL DEVELOPMENT ONLY: users, the six categories' datasets (history, live, staged), login activity,
// upload history and real downloadable files, so the admin dashboard and its charts have something to show.
//
//   npm run seed:sample -- --expect-db robovalley_dev                        # dry run: shows what would be added, connects to nothing
//   npm run seed:sample -- --expect-db robovalley_dev --apply                # add it (safe to repeat: nothing is duplicated)
//   npm run seed:sample -- --expect-db robovalley_dev --apply --with-admin   # also give the sample admin a known local password
//   npm run seed:sample -- --expect-db robovalley_dev --reset --apply        # remove ONLY sample records
//
// SAFETY (all checked before any connection is made, and again after):
//   * DATABASE_URL must point at this computer (localhost / 127.0.0.1 / ::1). A remote database is refused, always.
//   * NODE_ENV must not be "production".
//   * --expect-db must equal the database name, like the migration runner.
//   * Every migration must already be applied (checked with the read-only status probes); nothing here changes the schema.
//   * Dry run is the default; --apply is needed to write.
//
// HOW SAMPLE RECORDS ARE TOLD APART FROM REAL ONES (so --reset can never touch real data):
//   * users:      e-mail ends with @sample.robovalley.test (a reserved, undeliverable domain)
//   * everything else: the row id is in the reserved range 9,000,000,000,000 .. 9,000,001,000,000, far above any id the
//     database's own counters will reach. Real ids are never in that range.
// A real live dataset is never replaced: if a category already has its own live dataset, the sample one is stored as an
// older (superseded) version instead.

import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { dbNameFromUrl } from "./migrate.mjs";
import { migrationStatus, pending } from "./migration-status.mjs";

export const SAMPLE_DOMAIN = "sample.robovalley.test";
export const SAMPLE_PASSWORD = "SamplePass#2025"; // local development only; the sample admin gets it only with --with-admin
export const ID_BASE = 9_000_000_000_000;
export const ID_END = ID_BASE + 1_000_000;
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/;

// ---- safety -------------------------------------------------------------------------------------------------------
/** Throws a plain-English Error unless the target is a local, non-production database the operator named. */
export function assertSafeTarget({ url, expectDb, env = process.env }) {
  if (env.NODE_ENV === "production") throw new Error("Refusing: NODE_ENV is production. Sample data is for local development only.");
  if (!expectDb) throw new Error('Missing --expect-db <database name>. Type the name of the local database you mean, e.g. --expect-db robovalley_dev');
  if (!url) throw new Error("DATABASE_URL is not set in this window.");
  let host;
  try { host = new URL(url).hostname; } catch { throw new Error("DATABASE_URL could not be read."); }
  if (!LOOPBACK.test(host)) throw new Error("Refusing: the database is not on this computer. Sample data is only ever added to a local development database.");
  const name = dbNameFromUrl(url);
  if (!name) throw new Error("Could not read a database name from DATABASE_URL.");
  if (name !== expectDb) throw new Error(`DATABASE_URL points to database "${name}" but you confirmed "${expectDb}".`);
  return name;
}

// ---- deterministic generator --------------------------------------------------------------------------------------
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const sha = (s) => createHash("sha256").update(s).digest("hex");
const DAY = 86_400_000;

// ---- the plan (pure data, no database) ----------------------------------------------------------------------------
const STUDENTS = ["Aarav Reddy", "Diya Naidu", "Rohan Varma", "Ananya Rao", "Kabir Sharma", "Meera Pillai", "Vihaan Das", "Ishita Menon", "Arjun Patel", "Saanvi Gupta", "Advait Joshi", "Navya Iyer"];
const PARENTS = ["Lakshmi Reddy", "Suresh Naidu", "Padma Varma", "Ramesh Rao", "Sunita Sharma", "Kiran Pillai"];
const TEACHERS = ["Mrs. Radha Krishnan", "Mr. Venkat Prasad", "Ms. Anjali Mehta", "Mr. Sanjay Kulkarni", "Mrs. Fatima Sheikh", "Mr. Gopal Nair"];
const DISTRICTS = ["Guntur", "Visakhapatnam", "Krishna", "Chittoor", "Kurnool", "Nellore"];

export function userPlan(now = new Date()) {
  const r = rng(11);
  const mk = (names, role, prefix) => names.map((fullName, i) => ({
    fullName, role, email: `${prefix}${String(i + 1).padStart(2, "0")}@${SAMPLE_DOMAIN}`, district: DISTRICTS[i % DISTRICTS.length],
    mobile: `90000${role === "ST" ? "1" : role === "PA" ? "2" : "3"}${String(i).padStart(4, "0")}`,
    createdAt: new Date(now.getTime() - Math.floor(r() * 88 + 1) * DAY - Math.floor(r() * 20) * 3_600_000),
  }));
  return [...mk(STUDENTS, "ST", "student"), ...mk(PARENTS, "PA", "parent"), ...mk(TEACHERS, "TC", "teacher")];
}
export const ADMIN_EMAIL = `admin@${SAMPLE_DOMAIN}`;

const CAT = (slug, label, versions) => ({ slug, label, versions });
export const DATASET_PLAN = [
  CAT("atl-labs", "ATL Lab", [["2023", "superseded", 80], ["2024", "superseded", 45], ["2025", "active", 12], ["draft", "staged", 0.08]]),
  CAT("robotics-labs", "Robotics Lab", [["v1", "superseded", 60], ["v2", "active", 20]]),
  CAT("stem-labs", "STEM Lab", [["v1", "superseded", 70], ["v2", "active", 25], ["draft", "staged", 0.08], ["old-draft", "staged", 3]]),
  CAT("3d-printing-facilities", "3D Printing Facility", [["v1", "active", 30]]),
  CAT("robotics-training-centres", "Robotics Training Centre", [["v1", "superseded", 50], ["v2", "active", 15]]),
  CAT("innovation-centres", "Innovation Centre", [["v1", "active", 10]]),
];
const PLACES = [["Andhra Pradesh", "Guntur", "522001"], ["Andhra Pradesh", "Visakhapatnam", "530001"], ["Andhra Pradesh", "Krishna", "521001"], ["Andhra Pradesh", "Chittoor", "517001"], ["Andhra Pradesh", "Kurnool", "518001"], ["Andhra Pradesh", "Nellore", "524001"], ["Telangana", "Hyderabad", "500001"], ["Telangana", "Warangal", "506001"]];

/** Every dataset to create, with deterministic ids, file names and rows. */
export function datasetPlan(now = new Date()) {
  let n = 0;
  const out = [];
  for (const c of DATASET_PLAN) {
    for (const [key, status, daysAgo] of c.versions) {
      n++;
      const filename = `sample-${c.slug}-${key}.xlsx`;
      const rows = Array.from({ length: 6 }, (_, i) => {
        const [state, district, pincode] = PLACES[(n + i) % PLACES.length];
        return { rowNumber: i + 2, schoolName: `Sample ${c.label} ${n}-${i + 1}, ${district}`, state, district, pincode, udise: `99${String(n).padStart(3, "0")}${String(i).padStart(6, "0")}`.slice(0, 11) };
      });
      out.push({
        id: ID_BASE + 1000 + n, category: c.slug, key, status, filename, sha256: sha(filename), rows,
        invalid: (n % 3) === 0 ? 2 : 0,
        uploadedAt: new Date(now.getTime() - daysAgo * DAY),
        activatedAt: status === "staged" ? null : new Date(now.getTime() - daysAgo * DAY + 3_600_000),
      });
    }
  }
  return out;
}

// ---- real, valid sample files --------------------------------------------------------------------------------------
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const JPG_1X1 = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");

/** The seven approved types as real files (these pass the same content check as a real upload). */
export async function buildSampleFiles() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Schools");
  ws.addRow(["School name", "State", "District", "PIN code"]);
  ws.addRow(["Sample Government High School", "Andhra Pradesh", "Guntur", "522001"]);
  ws.addRow(["Sample Zilla Parishad School", "Andhra Pradesh", "Krishna", "521001"]);
  const xlsx = Buffer.from(await wb.xlsx.writeBuffer());

  const docx = Buffer.from(await new JSZip()
    .file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    .file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    .file("word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Sample RoboValley document</w:t></w:r></w:p></w:body></w:document>')
    .generateAsync({ type: "nodebuffer" }));

  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R/Size 4>>\n%%EOF\n");
  return [
    { filename: "sample-schools.csv", type: "csv", contentType: "text/csv", bytes: Buffer.from("School name,State,District,PIN code\nSample Government High School,Andhra Pradesh,Guntur,522001\nSample Zilla Parishad School,Andhra Pradesh,Krishna,521001\n") },
    { filename: "sample-schools.xlsx", type: "xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: xlsx },
    { filename: "sample-guidelines.pdf", type: "pdf", contentType: "application/pdf", bytes: pdf },
    { filename: "sample-report.docx", type: "docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: docx },
    { filename: "sample-logo.png", type: "png", contentType: "image/png", bytes: PNG_1X1 },
    { filename: "sample-photo.jpg", type: "jpg", contentType: "image/jpeg", bytes: JPG_1X1 },
    { filename: "sample-notes.txt", type: "txt", contentType: "text/plain", bytes: Buffer.from("Sample notes for the RoboValley admin dashboard.\nThis file is development sample data.\n") },
  ];
}

/** Login activity spread over 90 days. Only the fixed event types / reasons / purposes from migration 008. */
export function eventPlan(now, userIds) {
  const r = rng(2025);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const ua = () => pick(["chrome", "chrome", "chrome", "edge", "safari", "firefox", "other"]);
  const ev = [];
  // never in the future
  const at = (daysAgo) => new Date(Math.min(now.getTime() - 60_000, now.getTime() - daysAgo * DAY + Math.floor(r() * 12 * 3_600_000) - 6 * 3_600_000));
  for (let d = 0; d < 90; d++) {
    const busy = 1 + Math.floor(r() * 4) + (d < 30 ? 2 : 0);
    for (let i = 0; i < busy; i++) {
      const u = pick(userIds);
      ev.push({ type: "login_success", user: u, created: at(d), ua: ua() });
      if (r() < 0.6) ev.push({ type: "logout", user: u, created: at(d - 0.1), ua: ua() });
    }
    const fails = Math.floor(r() * 3);
    for (let i = 0; i < fails; i++) ev.push({ type: "login_failed", user: r() < 0.5 ? pick(userIds) : null, reason: pick(["bad_credentials", "bad_credentials", "bad_credentials", "throttled", "not_verified"]), created: at(d), ua: ua() });
    if (r() < 0.45) {
      const purpose = r() < 0.75 ? "signup" : "guardian";
      ev.push({ type: "otp_sent", purpose, created: at(d), ua: ua() });
      const roll = r();
      if (roll < 0.75) ev.push({ type: "otp_verified", purpose, created: at(d - 0.01), ua: ua() });
      else ev.push({ type: "otp_failed", purpose, reason: pick(["wrong_code", "wrong_code", "expired", "rate_limited", "locked", "send_failed"]), created: at(d), ua: ua() });
    }
  }
  userIds.forEach((u, i) => ev.push({ type: "signup", user: u, created: at(1 + ((i * 7) % 85)), ua: ua() }));
  ev.sort((a, b) => a.created - b.created);
  return ev.map((e, i) => ({ ...e, id: ID_BASE + 100_000 + i }));
}

export const summary = () => ({
  users: userPlan().length + 1, datasets: datasetPlan().length, datasetRows: datasetPlan().reduce((n, d) => n + d.rows.length, 0),
  attachments: 7, loginEvents: "about 600 over the last 90 days",
});

// ---- writing ------------------------------------------------------------------------------------------------------
/** `db` is a single connection with query(sql, params). Everything runs inside the caller's transaction. */
export async function seed(db, { now = new Date(), withAdmin = false, rounds = 10 } = {}) {
  const pw = await bcrypt.hash(SAMPLE_PASSWORD, rounds);
  const unusable = await bcrypt.hash(sha("never-used-" + ID_BASE), 4); // nobody knows a password for this hash
  const report = { users: 0, datasets: 0, datasetRows: 0, attachments: 0, events: 0, audit: 0, realLiveKept: [] };

  // users
  const users = userPlan(now);
  for (const u of users) {
    const r = await db.query(
      `INSERT INTO users (full_name, email, mobile, role, district, preferred_language, age_category, password_hash, profile, consents, email_verification, created_at)
       VALUES ($1, $2, $3, $4, $5, 'English', 'adult', $6, '{}'::jsonb, '{}'::jsonb, 'email', $7) ON CONFLICT DO NOTHING`,
      [u.fullName, u.email, u.mobile, u.role, u.district, pw, u.createdAt]);
    report.users += r.rowCount ?? 0;
  }
  const ar = await db.query(
    `INSERT INTO users (full_name, email, mobile, role, district, preferred_language, age_category, password_hash, profile, consents, email_verification, must_change_password, created_at)
     VALUES ('Sample Admin', $1, '9000009999', 'admin', 'Guntur', 'English', 'adult', $2, '{}'::jsonb, '{}'::jsonb, 'email', false, $3) ON CONFLICT DO NOTHING`,
    [ADMIN_EMAIL, withAdmin ? pw : unusable, new Date(now.getTime() - 89 * DAY)]);
  report.users += ar.rowCount ?? 0;
  if (withAdmin) await db.query("UPDATE users SET password_hash = $2 WHERE email = $1", [ADMIN_EMAIL, pw]);
  const ids = (await db.query("SELECT id, email, role FROM users WHERE email LIKE $1 ORDER BY id", [`%@${SAMPLE_DOMAIN}`])).rows;
  const adminId = String(ids.find((x) => x.email === ADMIN_EMAIL).id);
  const memberIds = ids.filter((x) => x.role !== "admin").map((x) => String(x.id));

  // datasets (a real live dataset is never displaced)
  const realLive = new Set((await db.query("SELECT category FROM service_datasets WHERE status = 'active' AND NOT (id BETWEEN $1 AND $2)", [ID_BASE, ID_END])).rows.map((r) => r.category));
  const cols = JSON.stringify([{ label: "School name" }, { label: "State" }, { label: "District" }, { label: "PIN code" }]);
  const dsPlan = datasetPlan(now);
  for (const d of dsPlan) {
    let status = d.status;
    if (status === "active" && realLive.has(d.category)) { status = "superseded"; report.realLiveKept.push(d.category); }
    const r = await db.query(
      `INSERT INTO service_datasets (id, uploaded_by, uploaded_at, original_filename, file_sha256, row_count, invalid_row_count, columns, status, activated_at, category)
       OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11) ON CONFLICT (id) DO NOTHING`,
      [d.id, adminId, d.uploadedAt, d.filename, d.sha256, d.rows.length, d.invalid, cols, status, status === "staged" ? null : d.activatedAt, d.category]);
    if (r.rowCount) {
      report.datasets++;
      for (const [i, row] of d.rows.entries()) {
        await db.query(
          `INSERT INTO service_dataset_rows (id, dataset_id, row_number, school_name, state, district, pincode, udise_code, data, search_name, search_loc)
           OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11) ON CONFLICT (id) DO NOTHING`,
          [d.id * 100 + i, d.id, row.rowNumber, row.schoolName, row.state, row.district, row.pincode, row.udise,
            JSON.stringify({ school_name: row.schoolName, state: row.state, district: row.district, pincode: row.pincode }), row.schoolName.toLowerCase(), `${row.state} ${row.district} ${row.pincode}`.toLowerCase()]);
        report.datasetRows++;
      }
    }
  }

  // upload history for the datasets
  let auditId = ID_BASE + 50_000;
  const audit = async (a) => {
    const r = await db.query(
      `INSERT INTO upload_audit_log (id, created_at, user_id, action, result, dataset_id, filename, detail, kind, file_size, file_sha256, attachment_id)
       OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (id) DO NOTHING`,
      [auditId++, a.at, adminId, a.action, a.result, a.datasetId ?? null, a.filename, a.detail, a.kind ?? "dataset", a.size ?? null, a.sha ?? null, a.attachmentId ?? null]);
    report.audit += r.rowCount ?? 0;
  };
  for (const d of dsPlan) {
    await audit({ at: d.uploadedAt, action: "upload", result: "success", datasetId: d.id, filename: d.filename, detail: `${d.category}: ${d.rows.length} rows, ${d.invalid} invalid (staged)` });
    if (d.status !== "staged") await audit({ at: d.activatedAt, action: "confirm", result: "success", datasetId: d.id, filename: d.filename, detail: `${d.category}: ${d.rows.length} rows now live` });
  }
  await audit({ at: new Date(now.getTime() - 40 * DAY), action: "upload", result: "rejected", filename: "sample-missing-pincode.xlsx", detail: "MISSING_COLUMNS: Required column PIN code was not found." });
  await audit({ at: new Date(now.getTime() - 18 * DAY), action: "upload", result: "rejected", filename: "sample-too-big.xlsx", detail: "FILE_TOO_LARGE: The file is larger than the limit." });
  await audit({ at: new Date(now.getTime() - 5 * DAY), action: "upload", result: "error", filename: "sample-broken.xlsx", detail: "server error" });

  // stored files: real bytes, real hashes, so every download works
  const files = await buildSampleFiles();
  for (const [i, f] of files.entries()) {
    const id = ID_BASE + 20_000 + i;
    const sum = createHash("sha256").update(f.bytes).digest("hex");
    const at = new Date(now.getTime() - (60 - i * 8) * DAY);
    const r = await db.query(
      `INSERT INTO upload_attachments (id, storage_key, uploaded_by, uploaded_at, original_filename, detected_type, content_type, size_bytes, file_sha256)
       OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
      [id, sha("storage-" + f.filename).slice(0, 32), adminId, at, f.filename, f.type, f.contentType, f.bytes.length, sum]);
    if (r.rowCount) {
      await db.query("INSERT INTO upload_attachment_blobs (attachment_id, content) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, f.bytes]);
      report.attachments++;
      await audit({ at, action: "upload", result: "success", filename: f.filename, detail: `${f.type}, ${f.bytes.length} bytes`, kind: "attachment", size: f.bytes.length, sha: sum, attachmentId: id });
    } else { auditId++; }
  }
  await audit({ at: new Date(now.getTime() - 3 * DAY), action: "upload", result: "rejected", filename: "sample-renamed.pdf", detail: "CONTENT_MISMATCH: The contents of this file do not look like a real .pdf file.", kind: "attachment" });

  // login activity
  const events = eventPlan(now, memberIds);
  for (let i = 0; i < events.length; i += 100) {
    const chunk = events.slice(i, i + 100);
    const params = [];
    const tuples = chunk.map((e, k) => {
      params.push(e.id, e.created, e.type, e.user ?? null, e.reason ?? null, e.purpose ?? null, e.ua);
      const b = k * 7;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`;
    });
    const r = await db.query(`INSERT INTO login_events (id, created_at, event_type, user_id, reason, purpose, ua_family) OVERRIDING SYSTEM VALUE VALUES ${tuples.join(", ")} ON CONFLICT (id) DO NOTHING`, params);
    report.events += r.rowCount ?? 0;
  }
  return report;
}

/** Removes sample records only: reserved-id rows, and sample users that nothing else refers to. */
export async function reset(db) {
  const range = [ID_BASE, ID_END];
  const del = async (sql, p = range) => Number((await db.query(sql, p)).rowCount ?? 0);
  const out = {};
  out.audit = await del("DELETE FROM upload_audit_log WHERE id BETWEEN $1 AND $2");
  out.events = await del("DELETE FROM login_events WHERE id BETWEEN $1 AND $2");
  out.attachments = await del("DELETE FROM upload_attachments WHERE id BETWEEN $1 AND $2"); // the file bytes go with them
  out.datasetRows = await del("DELETE FROM service_dataset_rows WHERE dataset_id BETWEEN $1 AND $2");
  out.datasets = await del("DELETE FROM service_datasets WHERE id BETWEEN $1 AND $2");
  // Sample users are removed only when no non-sample row points at them (for example an upload made while testing as the sample admin).
  out.users = await del(
    `DELETE FROM users u WHERE u.email LIKE $1
       AND NOT EXISTS (SELECT 1 FROM service_datasets d WHERE d.uploaded_by = u.id)
       AND NOT EXISTS (SELECT 1 FROM upload_attachments a WHERE a.uploaded_by = u.id)`, [`%@${SAMPLE_DOMAIN}`]);
  out.usersKept = Number((await db.query("SELECT count(*)::int AS n FROM users WHERE email LIKE $1", [`%@${SAMPLE_DOMAIN}`])).rows[0].n);
  return out;
}

// ---- command line -------------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const a = { apply: false, reset: false, withAdmin: false, expectDb: undefined };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--apply") a.apply = true;
    else if (t === "--reset") a.reset = true;
    else if (t === "--with-admin") a.withAdmin = true;
    else if (t === "--expect-db") a.expectDb = argv[++i];
    else throw new Error(`Unknown option: ${t}`);
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const name = assertSafeTarget({ url: process.env.DATABASE_URL, expectDb: args.expectDb });
  console.log("Target database name :", name, "(this computer)");
  console.log("Action               :", args.reset ? "REMOVE sample records only" : "add sample records");
  if (!args.apply) {
    if (!args.reset) console.log("Would add            :", JSON.stringify(summary()));
    console.log("\nDRY RUN: nothing was connected or changed. Add --apply to do it.");
    return;
  }
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query("select current_database() as d");
    if (rows[0].d !== args.expectDb) throw new Error(`Connected to database "${rows[0].d}" but you confirmed "${args.expectDb}".`);
    const todo = pending(await migrationStatus((sql) => client.query(sql)));
    if (todo.length) throw new Error(`These migrations are not applied yet: ${todo.map((m) => m.id).join(", ")}. Run "npm run db:migrate -- --expect-db ${name} --status" first. Nothing was changed.`);
    await client.query("BEGIN");
    try {
      const result = args.reset ? await reset(client) : await seed(client, { withAdmin: args.withAdmin });
      await client.query("COMMIT");
      console.log(args.reset ? "Removed:" : "Added (rows that already existed were left alone):", JSON.stringify(result));
      if (!args.reset) console.log(`Sample accounts use the e-mail domain @${SAMPLE_DOMAIN}.` + (args.withAdmin ? ` Sample admin: ${ADMIN_EMAIL} / ${SAMPLE_PASSWORD}` : " The sample admin cannot sign in unless you use --with-admin."));
    } catch (e) { await client.query("ROLLBACK"); throw e; }
  } finally { await client.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    const unreachable = e && ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT"].includes(e.code);
    console.error("\n✖ " + (unreachable ? `Could not connect to the database (${e.code}).` : String(e && e.message ? e.message : "Unexpected error").split("\n")[0]) + "\nNothing further was changed.");
    process.exit(1);
  });
}
