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
// Functions and triggers (012-019) are checked exactly, never by name alone, and only in current_schema() like everything else:
//   function - schema + name + the exact argument types, so another overload of the same name does not count;
//   trigger  - schema + table + trigger name + the function it calls (with that function's schema and argument types);
//              internal triggers (the ones PostgreSQL makes for foreign keys) are never counted, and neither is a DISABLED trigger
//              (ALTER TABLE ... DISABLE TRIGGER, tgenabled = 'D'): it does not fire, so its migration is partial and the trigger is
//              listed as "exists but is disabled". Running the migration again does not enable it (the files only create a missing one).

/** @typedef {{ kind: 'table', table: string } | { kind: 'column', table: string, column: string } | { kind: 'index', name: string } | { kind: 'constraint', name: string } | { kind: 'old-index-removed', name: string, table: string } | { kind: 'function', name: string, args: string[] } | { kind: 'trigger', table: string, name: string, calls: string }} Check */
// `calls` is the function the trigger runs, written as in a function check: "name(argument types)", e.g. "rv_review_round()".
const fn = (name, args = []) => ({ kind: "function", name, args });
const trigger = (table, name, calls) => ({ kind: "trigger", table, name, calls });
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
    fn("rv_contribution_needs_scope"),                                                                // 012_contributions.sql:81
    fn("rv_scope_keep_last"),                                                                         // 012_contributions.sql:89
    trigger("contributions", "contributions_needs_scope", "rv_contribution_needs_scope()"),         // 012_contributions.sql:102-103
    trigger("contribution_scopes", "contribution_scopes_keep_last", "rv_scope_keep_last()"),        // 012_contributions.sql:106-107
  ] },
  { id: "013", title: "contribution photos", feature: "Up to 3 photos (JPG or PNG, 4 MB, with alt text) on a contribution", requires: ["012"], checks: [
    ...["contribution_photos", "contribution_photo_blobs"].map((table) => ({ kind: "table", table })),
    ...["contribution_photos_position_uq", "contribution_photos_position_ck", "contribution_photos_mime_ck", "contribution_photos_size_ck", "contribution_photos_alt_ck", "contribution_photos_sha_ck"].map((name) => ({ kind: "constraint", name })),
    fn("rv_photo_blob_matches"),                                                                      // 013_contribution_photos.sql:57
    trigger("contribution_photo_blobs", "contribution_photo_blobs_match", "rv_photo_blob_matches()"), // 013_contribution_photos.sql:82-83
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
    fn("rv_moderator_audit"),                                                                         // 015_moderator_flag.sql:51
    trigger("users", "users_moderator_audit_upd", "rv_moderator_audit()"),                          // 015_moderator_flag.sql:66-68
    trigger("users", "users_moderator_audit_ins", "rv_moderator_audit()"),                          // 015_moderator_flag.sql:71-73
  ] },
  { id: "016", title: "first sector", feature: "The Agriculture & Dairy sector for the Contribute hub, and unique sector names", requires: ["012"], checks: [
    { kind: "index", name: "sectors_name_lower_uq" },
  ] },
  { id: "017", title: "review statuses", feature: "Rejected and unpublished statuses and the moderators' append-only audit trail", requires: ["012"], checks: [
    { kind: "table", table: "contribution_reviews" },
    { kind: "constraint", name: "contribution_reviews_action_ck" },
    { kind: "index", name: "contribution_reviews_item_idx" },
    fn("rv_review_append_only"),                                                                      // 017_review_statuses.sql:102
    trigger("contribution_reviews", "contribution_reviews_append_only", "rv_review_append_only()"), // 017_review_statuses.sql:114-115
  ] },
  { id: "018", title: "duplicate safeguard", feature: "One live contribution per normalised title and sector; verify and remove review actions", requires: ["017"], checks: [
    { kind: "table", table: "contribution_title_keys" },
    { kind: "constraint", name: "contribution_title_keys_pkey" },
    { kind: "index", name: "contribution_title_keys_item_idx" },
    fn("rv_title_key", ["text"]),                                                                     // 018_contribution_dedupe.sql:51 (t text)
    fn("rv_sync_title_keys", ["bigint"]),                                                             // 018_contribution_dedupe.sql:64 (cid bigint)
    fn("rv_title_keys_from_contribution"),                                                            // 018_contribution_dedupe.sql:73
    fn("rv_title_keys_from_scope"),                                                                   // 018_contribution_dedupe.sql:79
    trigger("contributions", "contributions_title_keys", "rv_title_keys_from_contribution()"),      // 018_contribution_dedupe.sql:93-94
    trigger("contribution_scopes", "contribution_scopes_title_keys", "rv_title_keys_from_scope()"), // 018_contribution_dedupe.sql:97-98
  ] },
  { id: "019", title: "moderation portal", feature: "Replies to contributors, internal notes, who opened what, structured directory categories and the work log", requires: ["017"], checks: [
    ...["contribution_replies", "contribution_notes", "contribution_views", "contribution_categories", "contribution_category_links", "contribution_work_log"].map((table) => ({ kind: "table", table })),
    { kind: "column", table: "contributions", column: "review_round_at" },
    ...["contribution_replies_message_ck", "contribution_notes_note_ck", "contribution_categories_category_ck", "contribution_category_links_type_ck"].map((name) => ({ kind: "constraint", name })),
    ...["contribution_replies_item_idx", "contribution_notes_item_idx", "contribution_views_first_idx"].map((name) => ({ kind: "index", name })),
    fn("rv_portal_append_only"),                                                                      // 019_moderation_portal.sql:66
    fn("rv_review_round"),                                                                            // 019_moderation_portal.sql:137
    trigger("contribution_replies", "contribution_replies_append_only", "rv_portal_append_only()"), // 019_moderation_portal.sql:86-87
    trigger("contribution_notes", "contribution_notes_append_only", "rv_portal_append_only()"),     // 019_moderation_portal.sql:90-91
    trigger("contributions", "contributions_review_round", "rv_review_round()"),                    // 019_moderation_portal.sql:148-149
  ] },
  { id: "020", title: "password reset", feature: "Forgot password: single-use reset links, and signing out other sessions after a reset", requires: [], checks: [
    { kind: "table", table: "password_reset_tokens" },
    { kind: "column", table: "users", column: "password_changed_at" },
    { kind: "constraint", name: "password_reset_tokens_hash_uq" },
    { kind: "index", name: "password_reset_tokens_user_idx" },
  ] },
  { id: "021", title: "contact through the profile", feature: "The Contribute form's \"Let moderators contact me using my profile details\" choice", requires: ["012"], checks: [
    { kind: "column", table: "contributions", column: "share_contact_with_moderators" },
  ] },
  { id: "022", title: "where a contribution was started", feature: "Edit (after \"changes requested\") showing a contribution started from a sector page with its sector as fixed text", requires: ["012"], checks: [
    { kind: "column", table: "contributions", column: "from_sector_page" },
  ] },
  { id: "023", title: "the type the member chose", feature: "The Contribute form's \"What would you like to share?\" (Describe a problem / Share an idea / Share a video or resource), shown in Moderation and the CSV", requires: ["012"], checks: [
    { kind: "column", table: "contributions", column: "type_chosen" },
  ] },
  { id: "024", title: "robot types per sector", feature: "Sector forms: each sector's robot types, entered by an administrator (the Contribute form asks for them from P3)", requires: ["012"], checks: [
    { kind: "table", table: "sector_robot_types" },
    { kind: "index", name: "sector_robot_types_name_uq" },
  ] },
  { id: "025", title: "the robot a contribution is about", feature: "The Contribute form's \"Which robot is it about?\" for each chosen sector, and a fixed robot from a robot card (shown in Moderation and the CSV)", requires: ["012", "024"], checks: [
    { kind: "column", table: "contribution_scopes", column: "robot_type_id" },
    { kind: "column", table: "contributions", column: "from_robot_page" },
    { kind: "constraint", name: "sector_robot_types_id_sector_uq" },
    { kind: "constraint", name: "contribution_scopes_robot_fk" },
    { kind: "index", name: "contribution_scopes_robot_idx" },
  ] },
  { id: "026", title: "questions per sector", feature: "Sector forms: each sector's questions (up to 5 on, at most 2 required), written by an administrator (the Contribute form asks them from P6)", requires: ["012"], checks: [
    { kind: "table", table: "sector_questions" },
    { kind: "constraint", name: "sector_questions_options_ck" },
    { kind: "index", name: "sector_questions_order_idx" },
  ] },
  { id: "027", title: "contribution workflow", feature: "The Contribution Publishing Workflow: Share Your Idea, Moderator Workspace, Admin Approval Dashboard with Publish Preview, and Community Ideas", requires: [], checks: [
    { kind: "table", table: "cw_contributions" },
    { kind: "table", table: "cw_contribution_versions" },
    { kind: "table", table: "cw_contribution_feedback" },
    { kind: "table", table: "cw_contribution_history" },
    { kind: "table", table: "cw_contribution_attachments" },
    { kind: "table", table: "cw_public_contributions" },
    { kind: "constraint", name: "cw_contributions_status_ck" },
    { kind: "constraint", name: "cw_contribution_attachments_ck" },
    { kind: "index", name: "cw_contributions_status_idx" },
    { kind: "index", name: "cw_public_contributions_sector_idx" },
    fn("cw_write_once"),
    fn("cw_append_only"),
    trigger("cw_contributions", "cw_contributions_write_once", "cw_write_once()"),
    trigger("cw_contribution_history", "cw_contribution_history_append_only", "cw_append_only()"),
    trigger("cw_contribution_versions", "cw_contribution_versions_append_only", "cw_append_only()"),
    trigger("cw_contribution_feedback", "cw_contribution_feedback_append_only", "cw_append_only()"),
    trigger("cw_contribution_attachments", "cw_contribution_attachments_append_only", "cw_append_only()"),
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
    case "function": return `function ${c.name}(${c.args.join(", ")})`;
    case "trigger": return `trigger ${c.name} on ${c.table} calling ${c.calls}`;
    default: return "?";
  }
}

// The argument types of a function, in order, as format_type writes them ("bigint", "text"; "" for none). Types only: the argument
// names do not make a different function, the types do.
const ARG_TYPES = (procAlias) =>
  `array_to_string(ARRAY(SELECT format_type(a.typ, NULL) FROM unnest(${procAlias}.proargtypes::oid[]) WITH ORDINALITY AS a(typ, ord) ORDER BY a.ord), ', ')`;

/**
 * Reads the schema. `query(sql)` must return { rows }. Only SELECTs on system catalogs are issued.
 * functions: "name(type, type)" for every function in current_schema() (each overload separately).
 * triggers:  "table.trigger -> function(types)" for every non-internal, not disabled trigger on a table in current_schema(); the
 *            function is written with its schema when that is not current_schema(), so a trigger calling a same-named function elsewhere
 *            does not match.
 * disabledTriggers: the same, for the triggers that are there but disabled (tgenabled = 'D'). They do not count as present.
 * @returns {Promise<{ tables: Set<string>, columns: Set<string>, indexes: Set<string>, constraints: Set<string>, functions: Set<string>, triggers: Set<string>, disabledTriggers: Set<string> }>}
 */
export async function readSnapshot(query) {
  const cols = await query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()");
  const idx = await query("SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()");
  const con = await query("SELECT c.conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = current_schema()");
  const fns = await query(`SELECT p.proname, ${ARG_TYPES("p")} AS args FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = current_schema()`);
  const trg = await query(
    `SELECT c.relname AS table_name, t.tgname, CASE WHEN fn.nspname = current_schema() THEN '' ELSE fn.nspname || '.' END || p.proname AS calls, ${ARG_TYPES("p")} AS args,
            t.tgenabled::text AS enabled
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace fn ON fn.oid = p.pronamespace
      WHERE n.nspname = current_schema() AND NOT t.tgisinternal`);
  const triggerKey = (r) => `${r.table_name}.${r.tgname} -> ${r.calls}(${r.args})`;
  return {
    tables: new Set(cols.rows.map((r) => r.table_name)),
    columns: new Set(cols.rows.map((r) => `${r.table_name}.${r.column_name}`)),
    indexes: new Set(idx.rows.map((r) => r.indexname)),
    constraints: new Set(con.rows.map((r) => r.conname)),
    functions: new Set(fns.rows.map((r) => `${r.proname}(${r.args})`)),
    triggers: new Set(trg.rows.filter((r) => r.enabled !== "D").map(triggerKey)),
    disabledTriggers: new Set(trg.rows.filter((r) => r.enabled === "D").map(triggerKey)),
  };
}

function holds(snap, c) {
  switch (c.kind) {
    case "table": return snap.tables.has(c.table);
    case "column": return snap.columns.has(`${c.table}.${c.column}`);
    case "index": return snap.indexes.has(c.name);
    case "constraint": return snap.constraints.has(c.name);
    case "old-index-removed": return !snap.indexes.has(c.name);
    case "function": return snap.functions.has(`${c.name}(${c.args.join(", ")})`);
    case "trigger": return snap.triggers.has(`${c.table}.${c.name} -> ${c.calls}`);
    default: return false;
  }
}

// A trigger check that fails only because the trigger is disabled says so: the trigger is there, but it does not fire.
const disabled = (snap, c) => c.kind === "trigger" && Boolean(snap.disabledTriggers?.has(`${c.table}.${c.name} -> ${c.calls}`));
/** Appended (after a space) to the description of a trigger that is there but disabled, in `absent`. The runner looks for it too. */
export const DISABLED_NOTE = "(exists but is disabled; running the migration again does not enable it)";

/**
 * @param {{ tables: Set<string>, columns: Set<string>, indexes: Set<string>, constraints: Set<string>, functions: Set<string>, triggers: Set<string>, disabledTriggers?: Set<string> }} snap
 * @returns {{ id: string, title: string, feature: string, status: 'applied'|'missing'|'partial', present: string[], absent: string[], blockedBy: string[] }[]}
 */
export function evaluate(snap) {
  const results = MIGRATIONS.map((m) => {
    // "old index replaced" only means something once the table it belongs to exists
    const checks = m.checks.filter((c) => c.kind !== "old-index-removed" || snap.tables.has(c.table));
    const present = checks.filter((c) => holds(snap, c)).map(describeCheck);
    const absent = checks.filter((c) => !holds(snap, c))
      .map((c) => (disabled(snap, c) ? `${describeCheck(c)} ${DISABLED_NOTE}` : describeCheck(c)));
    const status = absent.length === 0 ? "applied" : present.length === 0 ? "missing" : "partial";
    return { id: m.id, title: m.title, feature: m.feature, status, present, absent, blockedBy: [] };
  });
  const byId = new Map(results.map((r) => [r.id, r]));
  for (const m of MIGRATIONS) {
    const r = byId.get(m.id);
    // A prerequisite is only a problem for a migration that still has work to do. It must be fully applied: a partly applied one
    // blocks too (its missing objects may be exactly what this migration needs).
    if (r.status !== "applied") r.blockedBy = m.requires.filter((id) => byId.get(id).status !== "applied");
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

/**
 * The earlier migrations (lower numbers) that are not fully applied: what running only `id` would skip over.
 * Missing and partly applied ones both count. In number order.
 * @returns {{ id: string, title: string, status: 'missing'|'partial' }[]}
 */
export const earlierGaps = (results, id) =>
  results.filter((r) => r.id < id && r.status !== "applied").map((r) => ({ id: r.id, title: r.title, status: r.status }));

/** Human-readable table for the command line. Contains no connection details. */
export function formatStatus(results) {
  const lines = ["Migration status (read from the database's real schema; nothing was changed):", ""];
  for (const r of results) {
    const mark = r.status === "applied" ? "applied" : r.status === "missing" ? "MISSING" : "PARTIAL";
    lines.push(`  ${r.id}  ${mark.padEnd(8)} ${r.title}${r.status === "applied" ? "" : ` - affects: ${r.feature}`}`);
    if (r.status === "partial") lines.push(`           found ${r.present.length}, missing: ${r.absent.join(", ")}`);
    if (r.blockedBy.length) lines.push(`           needs ${r.blockedBy.map((id) => `${id}${statusOf(results, id).status === "partial" ? " (partly applied)" : ""}`).join(", ")} first`);
  }
  const todo = pending(results);
  lines.push("");
  lines.push(todo.length ? `To do: ${todo.map((r) => r.id).join(", ")}. Dry run first: npm run db:migrate -- --expect-db <database name> --only <id>` : "Everything is applied.");
  return lines.join("\n");
}
