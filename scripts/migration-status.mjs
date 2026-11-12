// Which migrations does a database already have? Answered by looking at the REAL schema (tables, columns, indexes,
// constraints) - there is no tracking table, so nothing has to be written to a database to know. Read-only: this
// module only runs SELECTs on the system catalogs and never applies anything.
//
//   applied  - every object the migration creates is there
//   missing  - none of them is there
//   partial  - some are (an interrupted or hand-edited database): the migration files are written to be re-run safely,
//              so applying that one migration finishes the job
//
// The checks name only objects the migration files themselves create (see db/migrations). 005's pg_trgm indexes are
// not checked (they are optional), and 005's old "one active dataset overall" index is not checked (007 replaces it).

/** @typedef {{ kind: 'table', table: string } | { kind: 'column', table: string, column: string } | { kind: 'index', name: string } | { kind: 'constraint', name: string } | { kind: 'old-index-removed', name: string, table: string }} Check */
/** @type {{ id: string, title: string, feature: string, requires: string[], checks: Check[] }[]} */
export const MIGRATIONS = [
  { id: "001", title: "signup additions", feature: "Sign-up profile fields", requires: [], checks: [
    ...["age_category", "profile", "consents", "mobile_verification"].map((column) => ({ kind: "column", table: "users", column })),
    ...["mobile_verification", "consent_mode"].map((column) => ({ kind: "column", table: "guardian_details", column })),
    { kind: "index", name: "users_email_lower_key" },
  ] },
  { id: "002", title: "email verification", feature: "Email one-time-code sign-up", requires: [], checks: [
    { kind: "column", table: "users", column: "email_verification" },
    { kind: "column", table: "guardian_details", column: "guardian_email" },
    { kind: "column", table: "guardian_details", column: "email_verification" },
  ] },
  { id: "003", title: "OTP and login throttle", feature: "One-time codes and login throttling", requires: [], checks: [
    ...["otp_challenges", "email_verifications", "login_attempts"].map((table) => ({ kind: "table", table })),
    ...["otp_challenges_expires_idx", "email_verifications_expires_idx", "login_attempts_window_idx"].map((name) => ({ kind: "index", name })),
  ] },
  { id: "004", title: "admin support", feature: "Admin accounts (forced password change)", requires: [], checks: [
    { kind: "column", table: "users", column: "must_change_password" },
  ] },
  { id: "005", title: "service datasets", feature: "Find a Service school directory and upload history", requires: [], checks: [
    ...["service_datasets", "service_dataset_rows", "upload_audit_log"].map((table) => ({ kind: "table", table })),
    ...["service_datasets_status_idx", "service_dataset_rows_dataset_idx", "service_dataset_rows_pincode_idx", "upload_audit_log_created_idx"].map((name) => ({ kind: "index", name })),
  ] },
  { id: "006", title: "pincode locations", feature: "Distance search by PIN code", requires: [], checks: [
    { kind: "table", table: "pincode_locations" },
    { kind: "index", name: "pincode_locations_latlng_idx" },
  ] },
  { id: "007", title: "service categories", feature: "One live dataset per category", requires: ["005"], checks: [
    { kind: "column", table: "service_datasets", column: "category" },
    { kind: "constraint", name: "service_datasets_category_check" },
    { kind: "index", name: "service_datasets_one_active_per_category" },
    { kind: "old-index-removed", name: "service_datasets_one_active", table: "service_datasets" },
  ] },
  { id: "008", title: "login events", feature: "Login Activity page and sign-in/OTP charts", requires: [], checks: [
    { kind: "table", table: "login_events" },
    { kind: "constraint", name: "login_events_purpose_ck" },
    { kind: "constraint", name: "login_events_reason_ck" },
    { kind: "index", name: "login_events_created_idx" },
    { kind: "index", name: "login_events_type_created_idx" },
  ] },
  { id: "009", title: "upload attachments", feature: "Stored files, downloads and richer upload history", requires: ["005"], checks: [
    { kind: "table", table: "upload_attachments" },
    { kind: "table", table: "upload_attachment_blobs" },
    ...["kind", "file_size", "file_sha256", "attachment_id"].map((column) => ({ kind: "column", table: "upload_audit_log", column })),
    { kind: "constraint", name: "upload_audit_log_attachment_kind_ck" },
    ...["upload_attachments_sha_idx", "upload_attachments_uploaded_idx", "upload_audit_log_user_created_idx", "upload_audit_log_attachment_idx"].map((name) => ({ kind: "index", name })),
  ] },
  { id: "010", title: "no duplicate schools", feature: "Duplicate handling for uploaded files and the upload report", requires: ["005"], checks: [
    { kind: "column", table: "service_dataset_rows", column: "dedupe_key" },
    ...["dedupe_version", "rows_read", "duplicate_row_count", "filled_row_count", "possible_duplicate_count", "report", "is_demo"].map((column) => ({ kind: "column", table: "service_datasets", column })),
    { kind: "index", name: "service_dataset_rows_dedupe_key_uq" },
  ] },
  { id: "011", title: "search rate limit", feature: "Per-visitor request limit for the Find a Service search and categories", requires: [], checks: [
    { kind: "table", table: "api_rate_limits" },
    { kind: "index", name: "api_rate_limits_window_idx" },
  ] },
  { id: "012", title: "contributions", feature: "Sectors, contributions and their sector scopes (foundation for the Contribute pages)", requires: [], checks: [
    ...["sectors", "contributions", "contribution_scopes"].map((table) => ({ kind: "table", table })),
    ...["contributions_user_status_idx", "contributions_public_idx", "contribution_scopes_sector_idx"].map((name) => ({ kind: "index", name })),
  ] },
  { id: "013", title: "contribution photos", feature: "Up to 3 photos (JPG or PNG, 4 MB, with alt text) on a contribution", requires: ["012"], checks: [
    ...["contribution_photos", "contribution_photo_blobs"].map((table) => ({ kind: "table", table })),
    ...["contribution_photos_position_uq", "contribution_photos_position_ck", "contribution_photos_mime_ck", "contribution_photos_size_ck", "contribution_photos_alt_ck", "contribution_photos_sha_ck"].map((name) => ({ kind: "constraint", name })),
  ] },
  { id: "014", title: "contribution contacts", feature: "Private contact details for a contribution (owner only, or a moderator when shared)", requires: ["012"], checks: [
    { kind: "table", table: "contribution_contacts" },
    ...["contribution_contacts_name_ck", "contribution_contacts_email_ck", "contribution_contacts_phone_ck", "contribution_contacts_reach_ck"].map((name) => ({ kind: "constraint", name })),
  ] },
  { id: "015", title: "moderator flag", feature: "Moderator flag on users (reads shared contact details) and its audit trail", requires: ["012"], checks: [
    { kind: "column", table: "users", column: "is_moderator" },
    { kind: "table", table: "moderator_audit" },
    { kind: "constraint", name: "moderator_audit_not_self_ck" },
    { kind: "index", name: "moderator_audit_target_idx" },
  ] },
  { id: "016", title: "first sector", feature: "The Agriculture & Dairy sector for the Contribute hub, and unique sector names", requires: ["012"], checks: [
    { kind: "index", name: "sectors_name_lower_uq" },
  ] },
  { id: "017", title: "review statuses", feature: "Rejected and unpublished statuses and the moderators' append-only audit trail", requires: ["012"], checks: [
    { kind: "table", table: "contribution_reviews" },
    { kind: "constraint", name: "contribution_reviews_action_ck" },
    { kind: "index", name: "contribution_reviews_item_idx" },
  ] },
  { id: "018", title: "duplicate safeguard", feature: "One live contribution per normalised title and sector; verify and remove review actions", requires: ["017"], checks: [
    { kind: "table", table: "contribution_title_keys" },
    { kind: "constraint", name: "contribution_title_keys_pkey" },
    { kind: "index", name: "contribution_title_keys_item_idx" },
  ] },
  { id: "020", title: "password reset", feature: "Forgot password: single-use reset links, and signing out other sessions after a reset", requires: [], checks: [
    { kind: "table", table: "password_reset_tokens" },
    { kind: "column", table: "users", column: "password_changed_at" },
    { kind: "constraint", name: "password_reset_tokens_hash_uq" },
    { kind: "index", name: "password_reset_tokens_user_idx" },
  ] },
];

/** A plain-text description of a check, for messages. */
export function describeCheck(c) {
  switch (c.kind) {
    case "table": return `table ${c.table}`;
    case "column": return `column ${c.table}.${c.column}`;
    case "index": return `index ${c.name}`;
    case "constraint": return `constraint ${c.name}`;
    case "old-index-removed": return `old index ${c.name} replaced`;
    default: return "?";
  }
}

/**
 * Reads the schema. `query(sql)` must return { rows }. Only SELECTs on system catalogs are issued.
 * @returns {Promise<{ tables: Set<string>, columns: Set<string>, indexes: Set<string>, constraints: Set<string> }>}
 */
export async function readSnapshot(query) {
  const cols = await query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()");
  const idx = await query("SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()");
  const con = await query("SELECT c.conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = current_schema()");
  return {
    tables: new Set(cols.rows.map((r) => r.table_name)),
    columns: new Set(cols.rows.map((r) => `${r.table_name}.${r.column_name}`)),
    indexes: new Set(idx.rows.map((r) => r.indexname)),
    constraints: new Set(con.rows.map((r) => r.conname)),
  };
}

function holds(snap, c) {
  switch (c.kind) {
    case "table": return snap.tables.has(c.table);
    case "column": return snap.columns.has(`${c.table}.${c.column}`);
    case "index": return snap.indexes.has(c.name);
    case "constraint": return snap.constraints.has(c.name);
    case "old-index-removed": return !snap.indexes.has(c.name);
    default: return false;
  }
}

/**
 * @param {{ tables: Set<string>, columns: Set<string>, indexes: Set<string>, constraints: Set<string> }} snap
 * @returns {{ id: string, title: string, feature: string, status: 'applied'|'missing'|'partial', present: string[], absent: string[], blockedBy: string[] }[]}
 */
export function evaluate(snap) {
  const results = MIGRATIONS.map((m) => {
    // "old index replaced" only means something once the table it belongs to exists
    const checks = m.checks.filter((c) => c.kind !== "old-index-removed" || snap.tables.has(c.table));
    const present = checks.filter((c) => holds(snap, c)).map(describeCheck);
    const absent = checks.filter((c) => !holds(snap, c)).map(describeCheck);
    const status = absent.length === 0 ? "applied" : present.length === 0 ? "missing" : "partial";
    return { id: m.id, title: m.title, feature: m.feature, status, present, absent, blockedBy: [] };
  });
  const byId = new Map(results.map((r) => [r.id, r]));
  for (const m of MIGRATIONS) {
    const r = byId.get(m.id);
    // A prerequisite is only a problem for a migration that still has work to do.
    if (r.status !== "applied") r.blockedBy = m.requires.filter((id) => byId.get(id).status === "missing");
  }
  return results;
}

/** Convenience: read + evaluate. */
export async function migrationStatus(query) {
  return evaluate(await readSnapshot(query));
}

/** The status of one migration by id ("008"), or undefined. */
export const statusOf = (results, id) => results.find((r) => r.id === id);

/** The migrations that exist in the files but whose objects are not all there, in order. */
export const pending = (results) => results.filter((r) => r.status !== "applied");

/** Human-readable table for the command line. Contains no connection details. */
export function formatStatus(results) {
  const lines = ["Migration status (read from the database's real schema; nothing was changed):", ""];
  for (const r of results) {
    const mark = r.status === "applied" ? "applied" : r.status === "missing" ? "MISSING" : "PARTIAL";
    lines.push(`  ${r.id}  ${mark.padEnd(8)} ${r.title}${r.status === "applied" ? "" : ` - affects: ${r.feature}`}`);
    if (r.status === "partial") lines.push(`           found ${r.present.length}, missing: ${r.absent.join(", ")}`);
    if (r.blockedBy.length) lines.push(`           needs ${r.blockedBy.join(", ")} first`);
  }
  const todo = pending(results);
  lines.push("");
  lines.push(todo.length ? `To do: ${todo.map((r) => r.id).join(", ")}. Dry run first: npm run db:migrate -- --expect-db <database name> --only <id>` : "Everything is applied.");
  return lines.join("\n");
}
