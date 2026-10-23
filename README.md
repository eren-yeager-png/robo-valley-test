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
- **Protection:** `/dashboard` checks the cookie *and* re-reads the user from PostgreSQL (server component), redirecting to `/login` otherwise; `/login` redirects signed-in users to the dashboard. Login/logout also reject cross-origin browser requests.
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
