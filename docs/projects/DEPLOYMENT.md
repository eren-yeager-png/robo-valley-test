# RoboValley Projects: deployment guide

This covers the Projects feature: the **RoboValley Projects** WordPress plugin, the **Projects page**, and the small changes to the **RoboValley app** (the Next.js project in this repository). Nothing here has been deployed. Everything below the line "Verified locally" was run on a local test copy; everything marked **needs staging** can only be checked on a real server.

- [1. What it is](#1-what-it-is)
- [2. Files created and modified](#2-files-created-and-modified)
- [3. Configuration](#3-configuration)
- [4. Deployment order](#4-deployment-order)
- [5. Elementor page](#5-elementor-page)
- [6. LiteSpeed Cache](#6-litespeed-cache)
- [7. Same-site cookies and CORS](#7-same-site-cookies-and-cors)
- [8. Clock sync](#8-clock-sync)
- [9. Backups, database changes, migration](#9-backups-database-changes-migration)
- [10. Rollback](#10-rollback)
- [11. Staging verification checklist](#11-staging-verification-checklist)
- [12. Known limitations](#12-known-limitations)
- [13. Test evidence](#13-test-evidence)

## 1. What it is

**Trust boundary.** Visitors are not WordPress users: sign-in and sign-up live in the RoboValley app (`app.techytree.in`), and the `rv_session` cookie belongs to that app. So WordPress cannot know who is signed in. The design keeps the two halves apart:

| Data | Stored in | Served by | Who sees it |
|---|---|---|---|
| Public: thumbnail, title, short description, technology, difficulty, education levels | WordPress | WordPress REST `GET /wp-json/rvp/v1/projects` (cacheable) and the server-rendered page | everyone |
| Members-only: overview, subjects, skills, components, expected outcome | WordPress (post meta, never in REST) | the **app**, through a signed server-to-server **bridge** | signed-in members only |

- The browser asks the **app** for details (`GET /api/projects/<id>`, with its own session cookie). The app checks the session against its database, then asks WordPress through the bridge, and returns the result with `Cache-Control: no-store`.
- WordPress never receives the visitor's cookie. The bridge is only for servers: it needs a shared secret, refuses any request that carries an `Origin` header (a browser), and sends no CORS headers.
- Subject filtering for members: browser → app (`/api/projects/subject-filter`, returns ids) → browser → WordPress `POST /wp-json/rvp/v1/projects/query` with `include` (ids only) → public cards.
- Projects, and their taxonomies, are **not public** post types: no front-end URL, no archive, no rewrite rules, no REST route, no sitemap entry. Nothing can leak through WordPress's built-in output.

## 2. Files created and modified

### WordPress plugin: `frontend/wordpress/plugins/robovalley-projects/` (all new)

| File | Purpose |
|---|---|
| `robovalley-projects.php` | Bootstrap, version, activation (capabilities + one-time term seeding) |
| `includes/post-type.php`, `taxonomies.php`, `term-meta.php`, `meta.php`, `meta-boxes.php`, `admin-columns.php`, `capabilities.php`, `seed.php` | The Project type, Technology / Education / Subject taxonomies, admin fields, own capability set |
| `includes/catalogue.php`, `rest-catalogue.php`, `rest-query.php` | Public catalogue (GET) and its POST query variant. Public fields only. |
| `includes/bridge.php` | The signed server-to-server bridge (3 read-only routes) |
| `includes/page.php` | Shortcode `[robovalley_projects]`, page flag, asset loading |
| `assets/rvp-projects-page.css`, `assets/rvp-projects-page.js` | The Projects page (loaded only there, versioned) |
| `assets/rvp-admin.css`, `assets/rvp-admin.js` | Admin screens only |
| `uninstall.php` | Removes capabilities and the seed flag; keeps all content |

### Elementor page (new, uniquely named)
`frontend/elementor/rvprojects-page/rvprojects-page.elementor.json` and `rvprojects-page-config.json`

### RoboValley app (Next.js) changes
New: `src/app/api/projects/[id]/route.ts`, `src/app/api/projects/subject-filter/route.ts`, `src/app/api/projects/subject-options/route.ts`, `src/lib/projectsBridge.ts`, `src/lib/projectsGate.ts`, `src/lib/projectsRateLimit.ts`, `src/lib/projectsReturnTo.ts`.
Modified (small, targeted): `src/lib/session.ts` (returnTo validation hook), `src/app/login/page.tsx`, `src/app/login/LoginForm.tsx`, `src/app/join/page.tsx`, `src/app/join/JoinFlow.tsx`, `.env.example` (3 placeholder names).
**No** change to: cookies, session format, `cors.ts`, any other route, any migration.

### Tests and local tools (not deployed)
`tests/rvprojects-*.test.ts(x)` (Vitest), `frontend/tests/robovalley-projects/rvprojects-*` (WP-CLI, HTTP and browser tests), `frontend/dev-tools/robovalley-projects/rvprojects-demo-data.php` and `rvprojects-create-local-page.php` (local only; both refuse to run unless `WP_ENVIRONMENT_TYPE` is `local` or `development`).

## 3. Configuration

### WordPress: `wp-config.php`
Add **above** the line `/* That's all, stop editing! */`:

```php
define( 'RVP_BRIDGE_SECRET', 'PASTE-64-RANDOM-HEX-CHARACTERS-HERE' );
```

- Generate the value: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` (or any password generator: 64 random letters and digits).
- At least **32 characters**. If the constant is missing or shorter, the bridge answers 503 to everything and the app shows "try again later". Nothing is exposed.
- It is never stored in the database and never sent to a browser. Use a different value per environment.

### App environment variables
| Variable | Value | Notes |
|---|---|---|
| `RVP_BRIDGE_URL` | `https://techytree.in` | Address of WordPress **as the app server reaches it**, no trailing slash. Expects the standard `/wp-json` REST prefix (**needs staging** if the site uses plain permalinks). |
| `RVP_BRIDGE_SECRET` | the same value as the constant above | 32+ characters |
| `PROJECTS_RETURN_PATH` | `/projects/` | Path of the Projects page. Only this page, optionally with `?project=<number>`, is accepted as a return address after sign-in. Must match the page slug. If the slug is not `projects`, change it in four places: the page permalink, this variable, `slug` in `rvprojects-page-config.json`, and (only if you set it) the `PROJECTS_RETURN_PATH` of every environment. |
| `ALLOWED_ORIGINS` | existing | Must include `https://techytree.in` (it does by default) |
| `SITE_URL` | existing | Must be `https://techytree.in/` |
| `SESSION_SECRET`, `DATABASE_URL` | existing | unchanged |

### WordPress option (existing)
The page finds the app through the same option the rest of the site uses: `robovalley_api_base` (for example `https://app.techytree.in`), or the `robovalley_api_base` filter. If it is empty, the page still works for browsing, but "View Project" shows "Sign-in is not available right now."

## 4. Deployment order

1. **Back up** (section 9).
2. **WordPress first:** upload and activate the plugin, then add the `wp-config.php` constant. Nothing is visible yet (no page exists) and the bridge is inert until the app calls it.
3. **App second:** set the env vars and redeploy. The new routes call the bridge, so the plugin and constant must already be there.
4. **Then create the Projects page** (section 5) and purge caches (section 6).

Why this order: the app's routes depend on the bridge, and the page depends on the app's routes. In any other order the feature simply fails closed (503 / "try again later", never data), but visitors would see error messages. If you deploy the app first by mistake nothing breaks; members just see "try again later" on project details until the plugin and constant are in.

## 5. Elementor page

1. Pages → Add New → title **Projects**. Do **not** reuse Home or Find a Service.
2. Edit with Elementor. Either import `rvprojects-page.elementor.json` (Templates → Saved Templates → Import, then Add Template → My Templates), or add one **Shortcode** widget containing `[robovalley_projects]` inside a full-width container with no padding.
3. Page settings: **Template: Elementor Full Width**; Astra "Disable Title" on; "Hide Title" on.
4. Permalink slug: **`projects`** (must match `PROJECTS_RETURN_PATH`). **Check first** that no existing page, post, category or redirect already uses `/projects/`: on the local copy there is none, but the live site was not inspected.
5. Page flag (optional safety): custom field `robovalley_projects` = `1`. The shortcode also loads its own assets, so the page works without the flag; the flag just loads them in the normal place in the page head.
6. Publish. Purge caches.

The page's CSS and JS (`rvp-projects-page.*`, versioned with the plugin version) are loaded **only** on this page. The Landing plugin's fonts are reused only if that plugin is active.

## 6. LiteSpeed Cache

All of this is **needs staging**: none of it could be tested without a LiteSpeed server.

- **Public catalogue** `/wp-json/rvp/v1/projects` sends `Cache-Control: public, max-age=60, s-maxage=120` and the tag `rvp_catalogue`. The plugin calls LiteSpeed's tag and purge actions when a project or term changes. Confirm a new or edited project appears within ~2 minutes, and that "Purge All" clears it.
- **Never cache** (add under LiteSpeed Cache → Cache → Excludes → *Do Not Cache URIs*, if REST caching is enabled):
  - `/wp-json/rvp-bridge/`  (the bridge: sends `no-store` and `X-LiteSpeed-Cache-Control: no-cache` itself)
  - `/wp-json/rvp/v1/projects/query`  (the POST query: `no-store`)
- **Cache REST API**: if it is on, confirm the bridge and query routes are not served from cache (see above) and the public catalogue is.
- **The Projects page** contains only public data, so it may be cached for anonymous visitors. Confirm logged-in WordPress admins are not served the visitor copy, and that `X-LiteSpeed-Cache: hit` appears for a second anonymous request.
- **CSS/JS combine, minify, defer, delay**: test the page with each setting. The script is already `defer`. If "Delay JS" is on, exclude `rvp-projects-page` and the inline `window.RVP_PAGE` block, otherwise the filters and windows start late or not at all.
- **Guest Mode / Guest Optimization**: test the page with it on and off.
- **No cookie-based variance is needed**: the page and the catalogue are identical for everyone.
- After deployment: LiteSpeed → Toolbox → **Purge All**, and Elementor → Tools → **Regenerate CSS & Data**.

## 7. Same-site cookies and CORS

The browser calls the app with the visitor's own cookie (`rv_session`, `HttpOnly`, `SameSite=Lax`, `Secure`).

- `techytree.in` and `app.techytree.in` are **same-site** (same registrable domain), so Lax cookies are sent on these `fetch(..., { credentials: 'include' })` calls. They are not third-party cookies. **Verify on staging**; if the two hosts are not same-site, member features cannot work (the page then fails closed to the sign-in prompt).
- The app answers only origins in `ALLOWED_ORIGINS` (exact match, with credentials, never `*`). Verify in the browser's Network tab that a request from the Projects page to `/api/projects/<id>` returns `Access-Control-Allow-Origin: https://techytree.in` and `Access-Control-Allow-Credentials: true`.
- WordPress core adds `Access-Control-Allow-Origin` (echoing any origin) to **every** REST route. The bridge removes it for its own routes; confirm no proxy, CDN or server rule re-adds `Access-Control-*` on `/wp-json/rvp-bridge/`.

## 8. Clock sync

Bridge requests are valid for 60 seconds, measured by WordPress's clock against the app server's clock. Both servers must be NTP-synced to within a few seconds. If they drift apart, every bridge call is rejected (the app shows "try again later"). **Needs staging.**

## 9. Backups, database changes, migration

- **Back up first:** full site files and database (hosting backup or All-in-One WP Migration export), and the app's database if you want a restore point. Do not commit exports.
- **WordPress database changes** (all small, all reversible): the plugin adds a set of project capabilities to the Administrator and Editor roles, seeds 25 taxonomy terms once (10 technologies, 7 education levels, 8 subjects) with display order, and stores an option `rvp_terms_seeded`. At runtime the bridge writes short-lived rows `rvp_bridge_nonce_*` to `wp_options` (hashes only, no autoload, pruned automatically). **No tables are created.**
- **App database changes: none. No migration.**
- **Content:** Projects are added by an admin in wp-admin. The plugin never creates projects. The demo script is local-only.

## 10. Rollback

1. **Page:** unpublish or delete the Projects page (Pages → Trash).
2. **Plugin:** Plugins → deactivate **RoboValley Projects**. The site is back to its previous state. Content (projects, terms) is kept in the database and returns if you reactivate. "Delete" removes the plugin files and its capabilities but still keeps projects and terms.
3. **Constant:** remove the `RVP_BRIDGE_SECRET` line from `wp-config.php`.
4. **App:** revert the app PR and redeploy (the new routes, the three small `login`/`join`/`session` changes and the 3 env placeholders). Without `returnTo` the login and join flows behave exactly as before.
5. Remove the app env vars `RVP_BRIDGE_URL`, `RVP_BRIDGE_SECRET`, `PROJECTS_RETURN_PATH`.
6. Purge caches. To restore everything, use the backup from step 1.

## 11. Staging verification checklist

Mark each with the date and who did it.

**WordPress**
- [ ] Plugin activates with no PHP notices; Projects menu shows All Projects, Add New, Technology Categories, Education Levels, Subjects
- [ ] Seeded terms present with the right order; a technology image can be set
- [ ] An Editor can create a project; an Author cannot see the Projects menu
- [ ] `RVP_BRIDGE_SECRET` present; removing it makes `/api/projects/<id>` answer 503 (then restore)
- [ ] `/wp-sitemap.xml` (and Yoast's sitemap) list no project or taxonomy URL; no `?p=<project id>` URL renders a page

**Page and visitor**
- [ ] `/projects/` loads for a logged-out visitor; assets `rvp-projects-page.css/.js?ver=` load only here (not on Home, Find a Service)
- [ ] View source as a visitor: no overview, skills, components, outcome, subject names, no secret
- [ ] Search, tabs, filters, chips, Clear all, Load more, mobile drawer work at 1280, 820 and 390 px
- [ ] Subject filter shows a lock; clicking it, and "View Project", open "Unlock Project Details"
- [ ] Register Now / Login go to the app with a `returnTo`; after signing in you return to the page and the project opens by itself, and `?project=` disappears from the address bar. From the Subject lock, sign-in returns to the Projects page (no project opens)

**Member**
- [ ] "View Project" opens the details window (overview, subjects, skills, components, outcome)
- [ ] Subject filter works (options appear; results are public cards; "Too many matches, narrow your filters." appears for a huge result)
- [ ] Response headers on `/api/projects/<id>`: `Cache-Control: no-store`; CORS headers as in section 7
- [ ] Sign out, repeat: back to the lock and the prompt

**Caching and infrastructure**
- [ ] LiteSpeed items in section 6; `X-LiteSpeed-Cache` behaves as described
- [ ] Bridge responses carry no `Access-Control-*` header (through the real CDN/proxy)
- [ ] Server clocks within a few seconds (section 8)
- [ ] Same-site cookie works between `techytree.in` and `app.techytree.in` (section 7)
- [ ] Rate limiter behaviour is acceptable on the real hosting (see limitations)

## 12. Known limitations

- **Rate limiting is in memory, per server instance.** On a single server it is exact; on serverless hosting each instance counts separately, so the real limit is "per instance". A shared limiter would need a new database table and migration, which was deliberately not added. Limits: 120 requests/minute per IP, 60/minute per member.
- **Two intermittent pre-existing Vitest tests.** `tests/login-ui.test.tsx` ("submitting an unknown email shows the very same message") and two in `tests/join-ui.test.tsx` fail on some runs, including on untouched `main`. Cause: real bcrypt at cost 12 (about 0.5 s per hash or compare) inside a `waitFor` whose default timeout is 1 s. Not changed in this PR. `tests/admin-charts.test.tsx` cannot load when the `recharts` package is not installed.
- **Where sign-in returns to:** the Projects page itself (no project) from the Subject lock, or the page with `?project=<id>` from "View Project". Nothing else is accepted; anything else falls back to `SITE_URL`.
- **Not verified without staging:** LiteSpeed behaviour, same-site cookies, real CORS through the CDN, clock sync, plain permalinks, the Yoast sitemap.

## 13. Test evidence

All run locally (WordPress 7.1.4 + Astra + Elementor in Docker, the app in Next.js dev mode, Edge headless). **Needs staging** = not run.

| Area | Tests | Result |
|---|---|---|
| Vitest (whole suite) | 45 files, 1243 tests | 1241 passed; the 2 failures are the known intermittent `login-ui` / `join-ui` bcrypt-timing tests (25/25 when re-run on their own); `admin-charts` cannot load (`recharts`); baseline before this work: 908 tests, 905 passed (3 intermittent failures) |
| New Vitest (returnTo, bridge client, routes, UI flow) | 4 files, 335 tests | all passed |
| Plugin: admin and saving (WP-CLI) | 39 | all passed |
| Plugin: public catalogue (WP-CLI) | 105 | all passed |
| Plugin: POST query (WP-CLI) | 71 | all passed |
| Plugin: bridge (WP-CLI) | 81 | all passed |
| Bridge over HTTP (no CORS headers, Origin refused) | 32, plus 6 + 6 for secret missing / too short | all passed |
| Public leak scan (195 URLs, markers in every restricted field) | 44 | all passed |
| Page leak scan (logged-out source, shipped JS/CSS/PHP) | 30 | all passed |
| App ↔ WordPress end to end | 64 (plus 12 × 3 fail-closed modes, last run before the returnTo change) | all passed |
| wp-admin click-through (real browser) | 21 (last run before the returnTo change) | all passed |
| Projects page in a real browser (visitor, member, 1280/820/390, keyboard, reduced motion, no-JS, forced 401/503/network/truncated, Subject lock returns to the page) | 82 | all passed |
| LiteSpeed, same-site cookies, CDN CORS, clock sync, plain permalinks | — | **needs staging** |
