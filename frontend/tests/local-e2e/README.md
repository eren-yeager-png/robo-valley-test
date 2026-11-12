# Local end-to-end browser checks (Edge over the DevTools protocol)

Real-browser checks for the Find a Service page, the Contribute path on WordPress, and the admin school-data upload, run against a
**throw-away local setup**. Same approach as `../find-a-service/*.js` (no Playwright, no new dependency). Nothing here touches production
or reads `.env` / `.env.local`.

These scripts are **not** part of `npm test`: they need Microsoft Edge, Docker, a local database, a local WordPress and the app running.
`npm test` (Vitest) is the automated suite.

## What is real and what is mocked

| Part | Real or mocked |
|---|---|
| WordPress (Astra + Elementor), the Find a Service page and its widgets, the `rv-contribution-v2` plugin | real (local Docker) |
| The app (`next dev`), its API, sign-in, cookies, rate limits, the PostgreSQL database and migrations | real (local throw-away database) |
| Uploaded school files (`.xlsx` built with the repo's `exceljs`, and `.csv`) | real files through the real upload route and screen |
| OpenStreetMap Nominatim (used only for a PIN that has no stored position) | **mocked** with canned answers (`find-a-service.cjs`) |
| Map tiles | real network, or blank when offline (the checks do not depend on them) |
| Google Maps | **not used**: the page only builds outbound "Directions" links; the script checks the link text, never opens Google |
| Browser geolocation | **does not exist** in the current widget (search is by PIN code, district or state only), so there is nothing to test |

## Set-up (one time per run; tear it down afterwards)

All secrets are random, kept in one folder outside the repository (`E2E_DIR`), and never printed.

1. A local PostgreSQL database and role with a random password; load `db/base_schema_local.sql` and run
   `node scripts/migrate.mjs --expect-db <name> --apply`.
2. Create three accounts and one submitted contribution: `E2E_DIR=<dir> DATABASE_URL=<url> node frontend/tests/local-e2e/seed-accounts.cjs <repo root> <dir>`
   (needs `<dir>/pw-admin.txt`, `pw-mod.txt`, `pw-member.txt`; creates `audit-admin@`, `audit-mod@`, `audit-member@example.com`).
   For the multi-sector checks also `INSERT INTO sectors (slug, name, sort_order) VALUES ('education','Education',20),('healthcare','Healthcare',30);`.
3. Start the app on port 3012 with `ALLOWED_ORIGINS=http://localhost:3012,http://localhost:8091`, `SITE_URL=http://localhost:8091/`,
   `OTP_PROVIDER=mock`, a random `SESSION_SECRET`.
4. A local WordPress on port 8091 (see `docker-compose.wordpress.yml`; use your own container names, ports and volumes so you never touch a
   running development site), with the `robovalley-landing` and `rv-contribution-v2` plugins active and in `wp-config.php`:
   `RV_CONTRIBUTION_V2` true, `RV_CONTRIBUTION_APP_URL` `http://localhost:3012`, `RV_CONTRIBUTE_PUBLIC` true. Option `robovalley_api_base` =
   `http://localhost:3012`. Pages: `find-a-service` (imported with `scripts/wp-import-page.php`), `contribute-now`, and
   `robots-by-sector` with a child page `agriculture-dairy`.
5. Put the app's school data in with `admin-upload-api.cjs` (it also checks the upload rules), then add positions for the PINs:
   `INSERT INTO pincode_locations (pincode,lat,lng,place,source) VALUES ('520010',16.4996,80.6565,'Benz Circle','geonames'), ('520002',16.5170,80.6190,'Governorpet','geonames'), ('522001',16.3067,80.4365,'Guntur','geonames'), ('522002',16.3120,80.4430,'Brodipet','geonames'), ('530001',17.6868,83.2185,'Visakhapatnam','geonames');`
   (531111 is left without a position on purpose, to exercise the geocoder path).

## Run (from the repository root)

```
export E2E_DIR=<the folder with pw-*.txt>
node frontend/tests/local-e2e/admin-upload-api.cjs          # upload rules over HTTP: wrong columns, empty, over 4 MB, duplicates, invalid PINs
node frontend/tests/local-e2e/find-a-service.cjs            # keyword, category, PIN, district, empty/error states, 1280 + 390 px
node frontend/tests/local-e2e/contribute-wordpress.cjs      # visitor -> Contribute -> sign in -> same sectors -> submit (two sectors)
node frontend/tests/local-e2e/moderation-after-contribute.cjs  # moderator verifies, cannot approve; admin approves; both sector counts move
node frontend/tests/local-e2e/admin-upload-screen.cjs       # the admin upload page with a real .xlsx, preview, confirm, 1280 + 390 px
node frontend/tests/local-e2e/no-script-submit.cjs          # sign-in form submitted before its script runs must not put the password in the address
```

The first run of `admin-upload-api.cjs`, `contribute-wordpress.cjs` and `admin-upload-screen.cjs` changes the database (it uploads and submits),
so run them once per fresh database; a second run reports "identical, no changes" and duplicate-title refusals instead of the first-run results.
Screenshots go to `$E2E_DIR/shots`.

## Tear down

Stop the app, `docker compose ... down -v` for the WordPress stack, drop the database and role, delete `E2E_DIR`.
