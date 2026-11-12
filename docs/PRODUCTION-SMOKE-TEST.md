# Production smoke test (read-only)

A short check you can run after a deploy to see that the public site is up and the doors that must be closed are closed.
It is **read-only**: it only sends `GET` requests, one at a time, with a pause between them. It never signs in, never sends a
cookie, never submits or uploads anything and is not a load test.

Run it only when the owner has approved it for that day. Nothing here runs automatically.

## Run

```
# 1. See exactly what would be requested. Sends nothing.
node scripts/prod-smoke.mjs --dry-run --app https://<app address> --site https://<website address>

# 2. Run it (the --production flag confirms you mean a real site; without it only localhost is accepted)
node scripts/prod-smoke.mjs --production --app https://<app address> --site https://<website address>
```

Exit code `0` means every check passed, `1` means at least one failed (each failure says why), `2` means a bad argument.
`--site` is optional; leave it out to check only the app.

## What it checks (23 requests)

| # | Check | Passes when |
|---|---|---|
| 1 | Public website pages load: `/`, `/find-a-service/`, `/contribute-now/`, `/robots-by-sector/` | HTTP 200 |
| 2 | App pages `/login` and `/join` load | HTTP 200 |
| 3 | Sector counts load: `GET /api/contributions/sectors` | `success: true`, a non-empty list, each sector has a slug and a whole-number count |
| 4 | Find a Service data answers: `/api/services/categories` and a PIN search | HTTP 200, `success: true` |
| 5 | `GET /api/db-test` tells a stranger only success or failure | the body has exactly `success` and `message`, `Cache-Control: no-store`, no database name |
| 6 | Seven admin and moderation URLs send a signed-out visitor to `/login` | a redirect whose target is `/login` |
| 7 | Five private API routes refuse a signed-out request | HTTP 401 or 403 with `Cache-Control: no-store` |
| 8 | `GET /api/auth/me` shows no personal data when signed out | no e-mail or name in the answer |

## What it deliberately does not check

* **Anything that needs a sign-in** (member, moderator, admin pages and actions). Those need real accounts, which this script never uses.
  Checking them is a manual step for a person with the right account.
* **Routes that only accept POST** (upload, review decisions, Make Moderator). Any request to them is a write attempt, so none is sent.
  Their sign-in and role checks are covered by the automated suite (`tests/portal-workflow.test.ts`, `tests/services-upload.test.ts`).
* **Speed or capacity.** One request at a time, about 0.4 s apart.
* **Google Maps.** The Find a Service page only builds outbound "Directions" links; there is no Maps key or Maps request to test.

## If a check fails

| Failure | What it means | First thing to look at |
|---|---|---|
| a public page is not 200 | the site or the app is down, or a page was unpublished | the host's status page, the latest deploy |
| sector counts: "no sectors" | the app cannot reach its database, or migrations are missing | `/api/db-test`, then the read-only migration status, run by the owner: `node --env-file=<file with the production DATABASE_URL> scripts/migrate.mjs --expect-db <database name> --status` |
| `/api/db-test` shows extra fields | an old build is live (before the database name was removed) | which commit is deployed |
| an admin URL is not a redirect | **serious**: a page that should require sign-in does not | stop and tell the developers at once |
| a private API route is not 401/403 | **serious**: the route answered a stranger | stop and tell the developers at once |
