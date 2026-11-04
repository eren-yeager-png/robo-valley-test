# RoboValley – Signup, Authentication & Email OTP

Next.js (App Router) + TypeScript + PostgreSQL (`pg`) + `bcryptjs` + Resend (email OTP).
Scope: **signup with email OTP** and **email + password login** (no SMS, no password reset yet).

## 1. Install

```bash
npm install
```

## 2. Environment variables

Put these in `.env.local` (git-ignored; never commit it or paste its values anywhere). All are read **server-side only**.

```
DATABASE_URL=postgresql://<user>:<password>@localhost:5433/robovalley_auth

# Which OTP provider to use. Choose ONE explicitly:
OTP_PROVIDER=resend        # real email through Resend
# OTP_PROVIDER=mock        # development/testing only; no email is sent; the code is shown in the UI

# Signs the login session cookie. Required for /login. At least 32 random characters.
# Generate one:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_SECRET=<random 32+ characters>

# Needed when OTP_PROVIDER=resend
RESEND_API_KEY=<your Resend API key>
RESEND_FROM_EMAIL=RoboValley <onboarding@resend.dev>   # optional; this is the default
```

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string used by `src/lib/db.ts`. |
| `SESSION_SECRET` | Server-only key used to sign the session cookie (min. 32 characters). If it is missing, `/api/auth/login` returns 503 and nobody can sign in; there is no insecure default. Changing it signs everyone out. |
| `OTP_PROVIDER` | `resend` or `mock`. Unset/unknown → OTP is disabled (501). There is **no automatic fallback** from one provider to the other. `mock` is refused when `NODE_ENV=production`. |
| `MOCK_OTP` | Legacy switch: `true` enables the mock provider only when `OTP_PROVIDER` is unset (and never in production). Prefer `OTP_PROVIDER=mock`. |
| `RESEND_API_KEY` | Resend API key. If missing in resend mode, `/api/auth/otp/request` returns 503 and nothing is sent. |
| `RESEND_FROM_EMAIL` | Sender address. Defaults to `RoboValley <onboarding@resend.dev>`. |

> **Resend sandbox limit:** `onboarding@resend.dev` can only deliver to the email address of your own Resend account. To email anyone else, verify a domain in Resend and set `RESEND_FROM_EMAIL` to an address on it. Restart `npm run dev` after changing `.env.local`.

## 3. Database migrations (review first; not applied automatically)

| File | Adds |
|---|---|
| `db/migrations/001_signup_additions.sql` | `users.age_category`, `profile`, `consents`, `mobile_verification`; `guardian_details.mobile_verification`, `consent_mode`; case-insensitive email index. |
| `db/migrations/002_email_verification.sql` | `users.email_verification`; `guardian_details.guardian_email`, `email_verification`. **Needed by email-OTP signup.** |
| `db/migrations/003_otp_and_login_throttle.sql` | Three **new** tables: `otp_challenges`, `email_verifications`, `login_attempts` (+ indexes). **Needed by email OTP, signup and login**: they hold the one-time codes (hashed), verification tokens (hashed) and login-failure counters that used to live in server memory, which does not work on serverless hosting. Touches no existing table or data. Undo: `db/rollback/003_down.sql` (drops only those three tables). |
| `db/migrations/004_admin_support.sql` | `users.must_change_password` (admin accounts). |
| `db/migrations/005_service_datasets.sql` | Three **new** tables for the Find a Service school directory: `service_datasets`, `service_dataset_rows`, `upload_audit_log` (+ indexes; `pg_trgm` is used if the role may create it). Touches no existing table. Undo: `db/rollback/005_down.sql`. See section 5d. |

All are additive (`IF NOT EXISTS`) and safe to re-run. Apply 001, then 002, then 003. Until 003 is applied, OTP requests and logins fail with a generic 500 (the code needs the tables). `users` is owned by `app_user`, so 001/002 must be run as that role; 003 only creates new tables.

**Database-name check (fails closed).** No migration hard-codes a database name. Each one refuses to run unless the operator has named the database they mean to change *and* it matches the database they are connected to. Use the runner, which never reads `.env.local` by itself and does a **dry run** unless you add `--apply`:

```powershell
# dry run: prints the target database name and the files, connects to nothing
node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 003
# really apply (only after checking the target name it printed)
node --env-file=.env.local scripts/migrate.mjs --expect-db <database name> --only 003 --apply
# for another database, set DATABASE_URL in that PowerShell window and use:  npm run db:migrate -- --expect-db <name> --apply
```

## 4. Run the app

```bash
npm run dev          # http://localhost:3000  → sign-up flow at /join
```

Check database connectivity: `http://localhost:3000/api/db-test`.

## 5. Try the OTP flow

**Real email (Resend):** set `OTP_PROVIDER=resend` and `RESEND_API_KEY`, restart, open `/join`, use your Resend-account email address, click **Send code to my email**, and enter the 6-digit code from your inbox. The API never returns the code in this mode.

**Mock (no email):** set `OTP_PROVIDER=mock`, restart. A yellow "Development mock OTP" box shows the code.

Under-18 students verify **their own email** and then **their parent's email** (separate codes).

### API

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/otp/request` | `{email, purpose: "signup"\|"guardian", studentEmail?}` → creates and emails a code. |
| `POST /api/auth/otp/verify` | `{email, purpose, code}` → single-use `verificationToken`. |
| `POST /api/auth/signup` | Validates everything, claims the verification tokens for the submitted email(s), hashes the password, writes `users` (+ `guardian_details` for minors) in one transaction. |
| `POST /api/auth/login` | `{email, password, remember?}` → sets the session cookie. Generic `401` for any bad email/password. |
| `POST /api/auth/logout` | Expires the session cookie. |
| `GET /api/db-test` | Connectivity check. |

Error codes from the request route: `RESEND_COOLDOWN` / `OTP_LOCKED` / `TOO_MANY_REQUESTS` (429), `EMAIL_SEND_FAILED` (502, provider error), `EMAIL_NOT_CONFIGURED` (503), `OTP_DISABLED` (501).

### OTP rules (both providers)

- 6-digit code from `crypto.randomInt`; only an HMAC-SHA256 hash is stored, in PostgreSQL; never logged. The hash key is derived from `SESSION_SECRET` (with a fixed label, separate from the session-signing key), so every server instance computes the same hash and **`SESSION_SECRET` is required for OTP** (without it the OTP endpoints answer 503).
- 10-minute expiry, 30 s resend cooldown, 5 wrong attempts → 30 min lockout, 6 sends/hour per address, single use.
- Bound to the **normalised (trimmed, lower-cased) email** and the purpose (`signup` / `guardian`).
- If Resend fails, the new code is discarded and the cooldown is not consumed, so the user can retry.
- Signup cannot be bypassed: it needs a server-issued token for the exact email being registered; client "verified" flags are ignored.
- Verification tokens are stored as SHA-256 hashes and consumed **inside the signup transaction**, so a failed signup (for example a duplicate email) leaves them valid for a retry, and two simultaneous submissions cannot share one.
- Parallel guesses are counted one by one (the row is locked while each guess is checked), so a burst cannot test more codes than the attempt limit.
- Times come from the database clock. The hourly send cap is a fixed one-hour window (6 codes). If Resend fails, the new code is voided (the previous one is not restored).
- Expired rows are ignored by every query and tidied up opportunistically (about 1 in 20 requests); there is no background job.

### Mock-only behaviour

`OTP_PROVIDER=mock` returns the code in the API response and sends nothing; it is never active in production. A mock code is not proof of email ownership.

### Guardian consent

An email code proves someone controls that inbox, **not** that they are the parent. For minors the database records `consent_status='pending'`, `consent_mode='test'`, `users.guardian_consent=false` in every mode; real consent must come from a dedicated workflow later. The guardian's mobile number is collected and stored but not verified.

## 5b. Login and sessions

Pages: `/login` (sign in), `/dashboard` (protected; shared by all roles for now). Needs migration 002 applied (reads `users.email_verification`) and `SESSION_SECRET` set.

- **Verification:** the email is trimmed/lower-cased like signup, looked up with a parameterised query, and the password is checked with `bcrypt.compare`. Unknown email and wrong password return the same `401` (a dummy hash is compared for unknown emails so timing does not reveal accounts). Passwords over 72 bytes are refused, as at signup.
- **Policy:** only accounts with `email_verification='email'` can sign in; `'mock'` (test OTP) accounts only outside production; `'none'` gets `403 EMAIL_NOT_VERIFIED` (after a correct password).
- **Session:** a signed (HMAC-SHA256) cookie `rv_session` holding only user id, role and expiry; **HttpOnly**, **SameSite=Lax**, **Secure in production**, never in localStorage. "Remember me" = 30-day persistent cookie; otherwise a browser-session cookie valid for 12 h. The role is read from the database on each protected request, never trusted from the client or the cookie.
- **Protection:** `/dashboard` checks the cookie *and* re-reads the user from PostgreSQL (server component), redirecting to `/login` otherwise; `/login` (and `/`) redirect an already signed-in user, server-side, to the website (`SITE_URL`); there is no "already signed in" banner. Sign out is in the website header. Login/logout also reject cross-origin browser requests.
- **Brute force:** 5 failed attempts lock that email for 15 minutes, stored in PostgreSQL (`login_attempts`) so all instances share it. Each attempt is counted *before* the password is checked and cleared when the password is right, so a burst of parallel guesses cannot get extra tries. Someone can still lock a victim out for 15 minutes on purpose.
- **Redirect:** every role goes to `/dashboard` because no role-specific dashboards exist yet.
- **Trade-off:** the token is stateless, so logout only clears the cookie; switch to a sessions table if per-session revocation is needed.

## 5c. Role dashboards

`/dashboard` is a role-based shell (sidebar, mobile menu, Home, role sections, Notifications, Profile & settings, Sign out). All 12 role codes have a definition in `src/lib/dashboardConfig.ts`; an unknown or missing role gets a "no dashboard" page and no content.

- **Authorization:** the role is read from PostgreSQL for the signed-in user (`getDashboardContext()`), never from the URL, query string, cookie claim or local storage. Layouts are not re-run on client navigation, so **every page re-checks**. A section belonging to another role shows "Access denied" (no data); an unknown section is a 404.
- **Real data today:** the user's own account (name, role, member-since, email-verification state), profile completeness from their own role answers, tasks derived from them, and for under-18 students their guardian-consent status (always "pending" in test mode; guardian contact details are never loaded). Every query is scoped to the session user's id.
- **Not real yet:** every role section (projects, mentors, schools, courses, …) is an explicit empty state that names the table/API it needs. "At a glance" tiles show "—". The collapsed "sample data" block uses the example figures from `Roles.html` and is labelled as not live (none exists for AR/FS).
- **Settings API:** `PATCH /api/account/profile` changes only your own name, district, language and role profile answers. Role, email, age category, ids and consents are rejected with 400, and profile answers are validated against the role stored in the database.
- **Missing schema (see the section list in `dashboardConfig.ts`):** schools and school membership/verification, parent–child links, org/district scope for officials, projects/progress/badges, mentoring, courses, events/competitions, kit inventory, bookings, funding, notifications and an activity log.

## 5d. Find a Service: admin upload and school directory search

An administrator uploads a school spreadsheet on the **Find a Service** page; everyone then searches the same stored data.

| Piece | Where |
|---|---|
| Migration `005_service_datasets.sql` (+ `db/rollback/005_down.sql`) | tables `service_datasets` (one row per upload version), `service_dataset_rows`, `upload_audit_log`; a unique index allows only one `active` dataset; trigram indexes (`pg_trgm`, optional) make partial-name search fast |
| `POST /api/services/upload` | **admin only** (401 not signed in, 403 not admin; role read from the database on every call). multipart `file`. Validates, parses, writes a **staged** (invisible) version, returns a preview |
| `POST /api/services/upload/confirm` | **admin only**. `{ "datasetId": "…" }`. In ONE transaction the previous active version becomes `superseded` and this one `active`; any failure rolls back and the old data stays live |
| `GET /api/services/search?q=&location=&page=&pageSize=` | public, `Cache-Control: no-store`, case-insensitive partial match, `pageSize` 1-50 |
| `GET /api/auth/me` | returns only `{ "role": "admin" \| "user" \| null }` (display hint; every admin API re-checks on the server) |
| `scripts/seed-admin.mjs` | makes `ADMIN_EMAIL` the only admin and demotes any other admin to `user` (other roles such as students are untouched) |

**File rules** (enforced on the server): `.xlsx` or `.csv` only (`.xls` is refused with an explanation); extension, MIME type and real content are all checked; max 10 MB, 100,000 rows, 100 columns; CSV must be UTF-8 (or UTF-16 with a BOM). Required: a **School Name** column and a location column (**District** or **Pincode**); otherwise the whole file is rejected and the message names what is missing. Headers are trimmed, case-folded, aliased (e.g. `School`, `Name of School`, `Dist`, `PIN Code`) and de-duplicated; every column is kept. Cells are sanitised: HTML removed, control characters removed, formula-looking text (`= + - @`) is neutralised with a leading apostrophe. Invalid rows (empty school name, bad 6-digit pincode, no location) are listed in the preview and skipped. All SQL is parameterised.

**Setup (local):**

```powershell
npm run db:migrate -- --expect-db robovalley_dev                  # dry run, then add --apply  (use: node --env-file=.env.local scripts/migrate.mjs ...)
npm run seed:admin -- --expect-db robovalley_dev --apply          # the one admin, from ADMIN_EMAIL / ADMIN_PASSWORD
docker compose -f docker-compose.wordpress.yml --env-file .env.local up -d
bash scripts/wp-local-setup.sh                                    # installs Astra + Elementor from wordpress.org, imports the page
npm run dev                                                       # http://localhost:3000   (WordPress: http://localhost:8080)
```

**Environment variable names** (values go only in `.env.local`, never in git): `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (or the existing `ADMINn_EMAIL` / `ADMINn_PASSWORD` pair holding `ai@symbiosystech.com`), `ALLOWED_ORIGINS` (comma-separated browser origins allowed to call the API with cookies, e.g. `https://techytree.in,http://localhost:8080`), `SITE_URL` (where everyone lands after login), and for the Docker WordPress `WP_DB_PASSWORD`, `WP_DB_ROOT_PASSWORD`, `WP_ADMIN_PASSWORD`.

**Production notes.** The WordPress site and this API must be *same-site* (for example `techytree.in` and `app.techytree.in`): the session cookie is `SameSite=Lax`, which browsers do not send on cross-site requests. Set `ALLOWED_ORIGINS` and `SITE_URL` in the host's environment, and set the WordPress option `robovalley_api_base` to the API address (Settings > or `wp option update robovalley_api_base https://app.techytree.in`). While that option is empty, the new features stay off and the site is unchanged.

**Manual test checklist**
1. Sign in at `/login` as the admin: you land on the normal website (not a blank page, no admin dashboard). The header button reads **Admin**, nothing else.
2. Open Find a Service: **Upload Files** is at the right of the page heading.
3. Upload `.xls`, a renamed `.txt`, a file without a School Name column: each is refused with a clear message and nothing changes.
4. Upload a valid `.xlsx`/`.csv`: the preview shows the row count, invalid rows and sample rows. Cancel: nothing changes. Upload again and **Confirm and publish**.
5. Sign out (or open a private window): **no** Upload Files button exists on the page; the School directory shows the same schools. Search by name (any case, part of a word), by district/PIN, both together, and a name that does not exist (friendly "No schools found").
6. As a regular user (any non-admin account): no button; `curl -i -X POST http://localhost:3000/api/services/upload` with that user's cookie gives 403, without a cookie 401.
7. As admin upload a **changed** file and confirm: searches immediately show only the new data (old rows are kept in the database as `superseded` for audit).

## 6. Tests

```bash
npm test             # vitest run (all tests)
npm run test:watch
npx tsc --noEmit     # type-check
```

Tests run against **PGlite** (a real PostgreSQL engine running inside the test process) with the real migrations 001 to 003 applied, plus a **mocked `resend` module**. They never touch `robovalley_auth` and never send a real email: `vitest.config.ts` forces `DATABASE_URL` to an unreachable placeholder and `tests/setup.ts` makes any real `pg` connection throw. The suite includes acceptance tests (`tests/acceptance.test.tsx`), the migration and database-name-check tests, and the dashboard role/isolation suite for all 12 roles.

## 7. Design notes

- `age` (smallint) is left untouched and stored as `NULL`; `adult`/`minor` goes to `age_category`.
- Role-specific answers are stored in `users.profile` (jsonb), validated against the per-role allowlist in `src/lib/roles.ts`.
- The UI is `src/app/join/` (ported from `Flow.html`; `Flow.html` and `Roles.html` are unchanged).
- Passwords: bcrypt cost 12, max 72 bytes. Emails are lower-cased; uniqueness is enforced by the DB.
- Account-enumeration note: OTP requests do not reveal whether an email already has an account; a duplicate is reported at signup (409).

## 8. Not done yet

- Password reset / "Forgot password" (the link is shown as "Coming soon"), re-sending verification emails, per-session revocation, role-specific dashboards (`/dashboard` is a shared placeholder), auto sign-in right after signup, ESLint config (`npm run lint` has no config file).
- A real guardian-consent workflow (parent acting on their own device).
- Per-IP rate limiting for the OTP and signup endpoints, CAPTCHA, Privacy Notice / Terms pages.
- SMS / mobile verification (mobile is collected but unverified); mobile numbers are not unique.
- A `000_base_schema.sql` migration for brand-new databases (the two original tables were created by hand; `tests/helpers/baseSchema.sql` is only a test fixture), and a hosted-database (Neon) trial of the whole flow.
- Per-session revocation (sessions are stateless signed cookies); Resend webhooks (bounces); a verified sending domain for Resend.

## 3b. Which migrations does a database have? (read-only)

```powershell
npm run db:migrate -- --expect-db <database name> --status
```

Reads the database's real schema (no tracking table) and reports every migration as **applied**, **MISSING** or **PARTIAL**, with the feature each one enables and anything it is waiting for. The database itself is put in read-only mode for this command, so it can never change anything, and it cannot be combined with `--apply`. A normal `--apply` now skips migrations that are already applied (`--force` runs one again) and refuses to start one whose prerequisite (for example 005 for 007/009) is missing. The admin **Settings > Database setup** panel shows the same status.

## 3c. Sample data for local development

For a **local** database only (the script refuses any host that is not this computer, and `NODE_ENV=production`). All migrations must be applied first (check with `--status`).

```powershell
npm run seed:sample -- --expect-db <local database name>                      # dry run: shows what it would add
npm run seed:sample -- --expect-db <local database name> --apply              # add it; safe to repeat, nothing is duplicated
npm run seed:sample -- --expect-db <local database name> --apply --with-admin # also give admin@sample.robovalley.test the password SamplePass#2025
npm run seed:sample -- --expect-db <local database name> --reset --apply      # remove ONLY the sample records
```

It adds 24 sample users (students, parents, teachers) and a sample admin, datasets for all six categories (history, one live each, some staged), about 670 login events over 90 days using only the fixed event types and reasons, upload history, and seven real downloadable files (csv, xlsx, pdf, docx, png, jpg, txt). Sample rows are recognisable (e-mail ending `@sample.robovalley.test`; row ids in the reserved range 9,000,000,000,000 and above), which is how `--reset` removes only them. A real live dataset is never replaced. The sample schools also appear in the local Find a Service search until you reset.
